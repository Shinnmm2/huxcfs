const fs = require('node:fs');
const path = require('node:path');
const { sqliteAuth, initPostgresAuth, postgresAuth } = require('./auth-storage');

async function createStorage({ databasePath, database }) {
  if (database) return createPostgresStorage(database);
  const { DatabaseSync } = require('node:sqlite');
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS guests (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, image TEXT NOT NULL, max_players INTEGER NOT NULL, owner_hash TEXT NOT NULL REFERENCES guests(token_hash), created_at INTEGER NOT NULL, visibility TEXT NOT NULL DEFAULT 'private');`);
  if (!db.prepare('PRAGMA table_info(servers)').all().some(column => column.name === 'visibility')) db.exec("ALTER TABLE servers ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'");
  if (!db.prepare('PRAGMA table_info(servers)').all().some(column => column.name === 'place_id')) db.exec('ALTER TABLE servers ADD COLUMN place_id TEXT');
  const auth = sqliteAuth(db);
  return {
    ...auth,
    close: () => db.close(),
    health: () => db.prepare('SELECT 1').get(),
    createGuest: tokenHash => db.prepare('INSERT INTO guests (token_hash) VALUES (?)').run(tokenHash),
    updateGuest: (name, username, tokenHash) => db.prepare('UPDATE guests SET name = ?, username = ? WHERE token_hash = ?').run(name, username, auth.resolveOwner(tokenHash)),
    listServers: () => db.prepare("SELECT id, name, image, max_players, visibility, place_id FROM servers WHERE visibility = 'public' ORDER BY created_at DESC, id DESC").all(),
    listMine: tokenHash => db.prepare('SELECT id, name, image, max_players, visibility, place_id FROM servers WHERE owner_hash = ? ORDER BY created_at DESC, id DESC').all(auth.resolveOwner(tokenHash)),
    getServer: id => db.prepare('SELECT id, name, image, max_players, visibility, place_id FROM servers WHERE id = ?').get(id),
    createServer: (server, tokenHash) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        tokenHash = auth.resolveOwner(tokenHash);
        const count = db.prepare('SELECT COUNT(*) AS count FROM servers WHERE owner_hash = ?').get(tokenHash).count;
        if (count >= 10) { db.exec('ROLLBACK'); return false; }
        db.prepare('INSERT INTO servers (id, name, image, max_players, owner_hash, created_at, visibility, place_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(server.id, server.name, server.image, server.max, tokenHash, Date.now(), server.visibility, server.placeId || null);
        db.exec('COMMIT'); return true;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    updateServerPlace: (id, tokenHash, placeId) => db.prepare('UPDATE servers SET place_id = ? WHERE id = ? AND owner_hash = ?').run(placeId, id, auth.resolveOwner(tokenHash)).changes > 0,
    deleteServer: (id, tokenHash) => db.prepare('DELETE FROM servers WHERE id = ? AND owner_hash = ?').run(id, auth.resolveOwner(tokenHash)).changes > 0,
  };
}

async function createPostgresStorage(config) {
  const { Pool } = require('pg');
  const pool = new Pool(config);
  const client = await pool.connect();
  try {
    // Prevent concurrent first-start schema creation from racing across Edge instances.
    await client.query('SELECT pg_advisory_lock(1880567201)');
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS guests (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, image TEXT NOT NULL, max_players INTEGER NOT NULL, owner_hash TEXT NOT NULL REFERENCES guests(token_hash), created_at BIGINT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private');`);
      await client.query('ALTER TABLE servers ADD COLUMN IF NOT EXISTS place_id TEXT');
      await initPostgresAuth(client);
    } finally { await client.query('SELECT pg_advisory_unlock(1880567201)'); }
  } catch (error) { client.release(); await pool.end(); throw error; }
  client.release();
  async function withOwner(sessionHash, operation) {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT token_hash FROM guests WHERE token_hash = $1 FOR UPDATE', [sessionHash]);
      const ownerHash = (await connection.query('SELECT COALESCE((SELECT owner_hash FROM session_links WHERE session_hash = $1), token_hash) AS owner_hash FROM guests WHERE token_hash = $1', [sessionHash])).rows[0]?.owner_hash;
      if (!ownerHash) throw new Error('Guest session not found');
      if (ownerHash !== sessionHash) await connection.query('SELECT token_hash FROM guests WHERE token_hash = $1 FOR UPDATE', [ownerHash]);
      const result = await operation(connection, ownerHash);
      await connection.query('COMMIT'); return result;
    } catch (error) { await connection.query('ROLLBACK'); throw error; } finally { connection.release(); }
  }
  return {
    ...postgresAuth(pool),
    close: () => pool.end(),
    health: () => pool.query('SELECT 1'),
    createGuest: tokenHash => pool.query('INSERT INTO guests (token_hash) VALUES ($1)', [tokenHash]),
    updateGuest: (name, username, tokenHash) => withOwner(tokenHash, (client, ownerHash) => client.query('UPDATE guests SET name = $1, username = $2 WHERE token_hash = $3', [name, username, ownerHash])),
    listServers: async () => (await pool.query("SELECT id, name, image, max_players, visibility, place_id FROM servers WHERE visibility = 'public' ORDER BY created_at DESC, id DESC")).rows,
    listMine: async tokenHash => (await pool.query('SELECT id, name, image, max_players, visibility, place_id FROM servers WHERE owner_hash = COALESCE((SELECT owner_hash FROM session_links WHERE session_hash = $1), $1) ORDER BY created_at DESC, id DESC', [tokenHash])).rows,
    getServer: async id => (await pool.query('SELECT id, name, image, max_players, visibility, place_id FROM servers WHERE id = $1', [id])).rows[0],
    createServer: async (server, tokenHash) => {
      return withOwner(tokenHash, async (client, ownerHash) => {
        const count = Number((await client.query('SELECT COUNT(*) AS count FROM servers WHERE owner_hash = $1', [ownerHash])).rows[0].count);
        if (count >= 10) return false;
        await client.query('INSERT INTO servers (id, name, image, max_players, owner_hash, created_at, visibility, place_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [server.id, server.name, server.image, server.max, ownerHash, Date.now(), server.visibility, server.placeId || null]);
        return true;
      });
    },
    updateServerPlace: (id, tokenHash, placeId) => withOwner(tokenHash, async (client, ownerHash) => (await client.query('UPDATE servers SET place_id = $1 WHERE id = $2 AND owner_hash = $3', [placeId, id, ownerHash])).rowCount > 0),
    deleteServer: (id, tokenHash) => withOwner(tokenHash, async (client, ownerHash) => (await client.query('DELETE FROM servers WHERE id = $1 AND owner_hash = $2', [id, ownerHash])).rowCount > 0),
  };
}

module.exports = { createStorage };
