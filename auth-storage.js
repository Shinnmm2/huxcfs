const schema = `
  CREATE TABLE IF NOT EXISTS session_links (session_hash TEXT PRIMARY KEY REFERENCES guests(token_hash), owner_hash TEXT NOT NULL REFERENCES guests(token_hash));
  CREATE TABLE IF NOT EXISTS verified_accounts (owner_hash TEXT PRIMARY KEY REFERENCES guests(token_hash), roblox_id TEXT UNIQUE NOT NULL, roblox_username TEXT NOT NULL, recovery_hash TEXT UNIQUE NOT NULL);
  CREATE TABLE IF NOT EXISTS auth_challenges (challenge_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES guests(token_hash), roblox_id TEXT NOT NULL, roblox_username TEXT NOT NULL, phrase TEXT NOT NULL, expires_at BIGINT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);`;
const conflict = () => Object.assign(new Error('This session is already linked to a different Roblox account.'), { status: 409 });

function sqliteAuth(db) {
  db.exec(schema);
  const resolveOwner = hash => db.prepare('SELECT COALESCE((SELECT owner_hash FROM session_links WHERE session_hash = ?), token_hash) AS owner_hash FROM guests WHERE token_hash = ?').get(hash, hash)?.owner_hash;
  const account = owner => db.prepare('SELECT * FROM verified_accounts WHERE owner_hash = ?').get(owner);
  function link(sessionHash, target) {
    const source = resolveOwner(sessionHash);
    if (!source) return false;
    const existing = account(source);
    if (existing && existing.owner_hash !== target) throw conflict();
    if (source !== target) {
      db.prepare('UPDATE servers SET owner_hash = ? WHERE owner_hash = ?').run(target, source);
      db.prepare('UPDATE session_links SET owner_hash = ? WHERE owner_hash = ?').run(target, source);
      db.prepare('INSERT INTO session_links (session_hash, owner_hash) VALUES (?, ?) ON CONFLICT(session_hash) DO UPDATE SET owner_hash = excluded.owner_hash').run(source, target);
    }
    return true;
  }
  return {
    resolveOwner,
    getGuest: hash => db.prepare(`SELECT g.name, g.username, g.token_hash AS owner_hash, v.roblox_id, v.roblox_username FROM guests g LEFT JOIN verified_accounts v ON v.owner_hash = g.token_hash WHERE g.token_hash = COALESCE((SELECT owner_hash FROM session_links WHERE session_hash = ?), ?)`).get(hash, hash),
    createChallenge: c => {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM auth_challenges WHERE expires_at <= ? OR session_hash = ?').run(c.now, c.sessionHash);
        db.prepare('INSERT INTO auth_challenges (challenge_hash, session_hash, roblox_id, roblox_username, phrase, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(c.hash, c.sessionHash, c.id, c.username, c.phrase, c.expiresAt);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    attemptChallenge: (hash, sessionHash, now) => db.prepare('UPDATE auth_challenges SET attempts = attempts + 1 WHERE challenge_hash = ? AND session_hash = ? AND expires_at > ? AND attempts < 5 RETURNING *').get(hash, sessionHash, now),
    completeChallenge: c => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const challenge = db.prepare('DELETE FROM auth_challenges WHERE challenge_hash = ? AND session_hash = ? AND expires_at > ? RETURNING *').get(c.hash, c.sessionHash, c.now);
        if (!challenge) { db.exec('ROLLBACK'); return null; }
        const source = resolveOwner(c.sessionHash);
        if (!source) { db.exec('ROLLBACK'); return null; }
        const current = account(source);
        if (current && current.roblox_id !== challenge.roblox_id) throw conflict();
        let target = db.prepare('SELECT * FROM verified_accounts WHERE roblox_id = ?').get(challenge.roblox_id);
        let created = false;
        if (!target) {
          db.prepare('INSERT INTO verified_accounts (owner_hash, roblox_id, roblox_username, recovery_hash) VALUES (?, ?, ?, ?)').run(source, challenge.roblox_id, challenge.roblox_username, c.recoveryHash);
          target = { owner_hash: source }; created = true;
        } else {
          db.prepare('UPDATE verified_accounts SET roblox_username = ? WHERE roblox_id = ?').run(challenge.roblox_username, challenge.roblox_id);
          link(c.sessionHash, target.owner_hash);
        }
        db.exec('COMMIT'); return { created, username: challenge.roblox_username };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    recover: c => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const target = db.prepare('SELECT * FROM verified_accounts WHERE recovery_hash = ?').get(c.oldHash);
        if (!target) { db.exec('ROLLBACK'); return null; }
        if (!link(c.sessionHash, target.owner_hash)) { db.exec('ROLLBACK'); return null; }
        db.prepare('UPDATE verified_accounts SET recovery_hash = ? WHERE owner_hash = ?').run(c.newHash, target.owner_hash);
        db.exec('COMMIT'); return { username: target.roblox_username };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}

async function initPostgresAuth(client) { await client.query(schema); }
function postgresAuth(pool) {
  async function owner(client, hash) {
    return (await client.query('SELECT COALESCE((SELECT owner_hash FROM session_links WHERE session_hash = $1), token_hash) AS owner_hash FROM guests WHERE token_hash = $1', [hash])).rows[0]?.owner_hash;
  }
  async function link(client, sessionHash, target) {
    await client.query('SELECT token_hash FROM guests WHERE token_hash = $1 FOR UPDATE', [sessionHash]);
    const source = await owner(client, sessionHash);
    if (!source) return false;
    await client.query('SELECT token_hash FROM guests WHERE token_hash = $1 FOR UPDATE', [source]);
    const current = (await client.query('SELECT owner_hash FROM verified_accounts WHERE owner_hash = $1', [source])).rows[0];
    if (current && current.owner_hash !== target) throw conflict();
    if (source !== target) {
      await client.query('UPDATE servers SET owner_hash = $1 WHERE owner_hash = $2', [target, source]);
      await client.query('UPDATE session_links SET owner_hash = $1 WHERE owner_hash = $2', [target, source]);
      await client.query('INSERT INTO session_links (session_hash, owner_hash) VALUES ($1, $2) ON CONFLICT(session_hash) DO UPDATE SET owner_hash = excluded.owner_hash', [source, target]);
    }
    return true;
  }
  return {
    getGuest: async hash => (await pool.query(`SELECT g.name, g.username, g.token_hash AS owner_hash, v.roblox_id, v.roblox_username FROM guests g LEFT JOIN verified_accounts v ON v.owner_hash = g.token_hash WHERE g.token_hash = COALESCE((SELECT owner_hash FROM session_links WHERE session_hash = $1), $1)`, [hash])).rows[0],
    createChallenge: async c => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT token_hash FROM guests WHERE token_hash = $1 FOR UPDATE', [c.sessionHash]);
        await client.query('DELETE FROM auth_challenges WHERE expires_at <= $1 OR session_hash = $2', [c.now, c.sessionHash]);
        await client.query('INSERT INTO auth_challenges (challenge_hash, session_hash, roblox_id, roblox_username, phrase, expires_at) VALUES ($1, $2, $3, $4, $5, $6)', [c.hash, c.sessionHash, c.id, c.username, c.phrase, c.expiresAt]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    attemptChallenge: async (hash, sessionHash, now) => (await pool.query('UPDATE auth_challenges SET attempts = attempts + 1 WHERE challenge_hash = $1 AND session_hash = $2 AND expires_at > $3 AND attempts < 5 RETURNING *', [hash, sessionHash, now])).rows[0],
    completeChallenge: async c => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT token_hash FROM guests WHERE token_hash = $1 FOR UPDATE', [c.sessionHash]);
        const challenge = (await client.query('DELETE FROM auth_challenges WHERE challenge_hash = $1 AND session_hash = $2 AND expires_at > $3 RETURNING *', [c.hash, c.sessionHash, c.now])).rows[0];
        if (!challenge) { await client.query('ROLLBACK'); return null; }
        await client.query("SELECT pg_advisory_xact_lock(hashtext('roblox:' || $1))", [challenge.roblox_id]);
        const source = await owner(client, c.sessionHash);
        if (!source) { await client.query('ROLLBACK'); return null; }
        await client.query('SELECT token_hash FROM guests WHERE token_hash = $1 FOR UPDATE', [source]);
        const current = (await client.query('SELECT roblox_id FROM verified_accounts WHERE owner_hash = $1', [source])).rows[0];
        if (current && current.roblox_id !== challenge.roblox_id) throw conflict();
        const target = (await client.query('SELECT owner_hash FROM verified_accounts WHERE roblox_id = $1 FOR UPDATE', [challenge.roblox_id])).rows[0];
        let created = false;
        if (!target) { await client.query('INSERT INTO verified_accounts (owner_hash, roblox_id, roblox_username, recovery_hash) VALUES ($1, $2, $3, $4)', [source, challenge.roblox_id, challenge.roblox_username, c.recoveryHash]); created = true; }
        else { await client.query('UPDATE verified_accounts SET roblox_username = $1 WHERE roblox_id = $2', [challenge.roblox_username, challenge.roblox_id]); await link(client, c.sessionHash, target.owner_hash); }
        await client.query('COMMIT'); return { created, username: challenge.roblox_username };
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    recover: async c => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT token_hash FROM guests WHERE token_hash = $1 FOR UPDATE', [c.sessionHash]);
        const initial = (await client.query('SELECT roblox_id FROM verified_accounts WHERE recovery_hash = $1', [c.oldHash])).rows[0];
        if (!initial) { await client.query('ROLLBACK'); return null; }
        await client.query("SELECT pg_advisory_xact_lock(hashtext('roblox:' || $1))", [initial.roblox_id]);
        const target = (await client.query('SELECT * FROM verified_accounts WHERE recovery_hash = $1 FOR UPDATE', [c.oldHash])).rows[0];
        if (!target) { await client.query('ROLLBACK'); return null; }
        if (!(await link(client, c.sessionHash, target.owner_hash))) { await client.query('ROLLBACK'); return null; }
        await client.query('UPDATE verified_accounts SET recovery_hash = $1 WHERE owner_hash = $2', [c.newHash, target.owner_hash]);
        await client.query('COMMIT'); return { username: target.roblox_username };
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
  };
}
module.exports = { sqliteAuth, initPostgresAuth, postgresAuth };
