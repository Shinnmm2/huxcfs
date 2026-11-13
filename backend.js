const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { createStorage } = require('./storage');

async function createBackend({ databasePath, database, allowedOrigins = [] }) {
  const store = await createStorage({ databasePath, database });
  const hash = token => createHash('sha256').update(token).digest('hex');
  const guest = async req => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
    if (!match) return null;
    const tokenHash = hash(match[1]);
    const row = await store.getGuest(tokenHash);
    return row ? { tokenHash, ...row } : null;
  };
  const shape = row => ({ id: row.id, name: row.name, image: row.image, map: row.image === 'slap' ? 'Slap Royale' : 'Cuarentena Chill', kind: 'community', count: null, max: row.max_players, visibility: row.visibility });
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
  const readBody = async req => {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 16384) throw Object.assign(new Error('Request too large'), { status: 413 });
    }
    try { const value = JSON.parse(body || '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
    catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  };
  return {
    close() { return store.close(); },
    async handle(req, res, url) {
      if (!url.pathname.startsWith('/api/')) return false;
      const origin = req.headers.origin;
      if (origin) {
        let sameHost = false;
        try { sameHost = new URL(origin).host === req.headers.host; } catch (_) {}
        if (!sameHost && !allowedOrigins.includes(origin)) { json(res, 403, { error: 'Origin not allowed' }); return true; }
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
      try {
        if (req.method === 'GET' && url.pathname === '/api/health') {
          try { await store.health(); json(res, 200, { status: 'ok' }); } catch (_) { json(res, 503, { error: 'Database unavailable' }); }
          return true;
        }
        if (req.method === 'GET' && url.pathname === '/api/config') { json(res, 200, { service: 'condo-api', gameConnection: false }); return true; }
        if (req.method === 'POST' && url.pathname === '/api/guests') {
          await readBody(req);
          const token = randomBytes(32).toString('base64url');
          await store.createGuest(hash(token));
          json(res, 201, { token }); return true;
        }
        if (req.method === 'GET' && url.pathname === '/api/servers') {
          const rows = await store.listServers();
          json(res, 200, { servers: rows.map(shape) }); return true;
        }
        const actor = await guest(req);
        if (req.method === 'GET' && url.pathname === '/api/profile') {
          if (!actor) { json(res, 401, { error: 'Guest session required' }); return true; }
          json(res, 200, { name: actor.name, username: actor.username }); return true;
        }
        if (req.method === 'PUT' && url.pathname === '/api/profile') {
          if (!actor) { json(res, 401, { error: 'Guest session required' }); return true; }
          const body = await readBody(req);
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          const username = typeof body.username === 'string' ? body.username.trim() : '';
          if (name.length < 2 || name.length > 24 || username.length > 24) { json(res, 400, { error: 'Enter a display name of 2–24 characters and a username of up to 24 characters.' }); return true; }
          await store.updateGuest(name, username, actor.tokenHash);
          json(res, 200, { name, username }); return true;
        }
        if (req.method === 'GET' && url.pathname === '/api/servers/mine') {
          if (!actor) { json(res, 401, { error: 'Guest session required' }); return true; }
          const rows = await store.listMine(actor.tokenHash);
          json(res, 200, { servers: rows.map(shape) }); return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/servers') {
          if (!actor) { json(res, 401, { error: 'Guest session required' }); return true; }
          const body = await readBody(req);
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          if (name.length < 2 || name.length > 32 || !['cc', 'slap'].includes(body.image) || ![10, 20, 40, 50].includes(body.max) || !['public', 'private'].includes(body.visibility)) { json(res, 400, { error: 'Invalid server name, map, or capacity.' }); return true; }
          const id = 'private-' + randomUUID();
          const created = await store.createServer({ id, name, image: body.image, max: body.max, visibility: body.visibility }, actor.tokenHash);
          if (!created) { json(res, 409, { error: 'A guest can create up to 10 servers.' }); return true; }
          json(res, 201, { server: shape({ id, name, image: body.image, max_players: body.max, visibility: body.visibility }) }); return true;
        }
        const match = /^\/api\/servers\/(private-[0-9a-f-]{36})$/.exec(url.pathname);
        if (match && req.method === 'GET') {
          const row = await store.getServer(match[1]);
          if (!row) { json(res, 404, { error: 'Server not found' }); return true; }
          json(res, 200, { server: shape(row) }); return true;
        }
        if (match && req.method === 'DELETE') {
          if (!actor) { json(res, 401, { error: 'Guest session required' }); return true; }
          const deleted = await store.deleteServer(match[1], actor.tokenHash);
          if (!deleted) { json(res, 404, { error: 'Server not found' }); return true; }
          json(res, 200, { success: true }); return true;
        }
        json(res, 404, { error: 'Not found' });
      } catch (error) {
        if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Server error' });
      }
      return true;
    },
  };
}
module.exports = { createBackend };
