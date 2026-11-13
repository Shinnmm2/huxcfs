const fs = require('node:fs');
const path = require('node:path');

async function createStorage({ databasePath, database }) {
  if (database) return createPostgresStorage(database);
  const { DatabaseSync } = require('node:sqlite');
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS guests (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, image TEXT NOT NULL, max_players INTEGER NOT NULL, owner_hash TEXT NOT NULL REFERENCES guests(token_hash), created_at INTEGER NOT NULL, visibility TEXT NOT NULL DEFAULT 'private');`);
  if (!db.prepare('PRAGMA table_info(servers)').all().some(column => column.name === 'visibility')) db.exec("ALTER TABLE servers ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'");
  return {
    close: () => db.close(),
    health: () => db.prepare('SELECT 1').get(),
    getGuest: tokenHash => db.prepare('SELECT name, username FROM guests WHERE token_hash = ?').get(tokenHash),
    createGuest: tokenHash => db.prepare('INSERT INTO guests (token_hash) VALUES (?)').run(tokenHash),
    updateGuest: (name, username, tokenHash) => db.prepare('UPDATE guests SET name = ?, username = ? WHERE token_hash = ?').run(name, username, tokenHash),
    listServers: () => db.prepare("SELECT id, name, image, max_players, visibility FROM servers WHERE visibility = 'public' ORDER BY created_at DESC, id DESC").all(),
    listMine: tokenHash => db.prepare('SELECT id, name, image, max_players, visibility FROM servers WHERE owner_hash = ? ORDER BY created_at DESC, id DESC').all(tokenHash),
    getServer: id => db.prepare('SELECT id, name, image, max_players, visibility FROM servers WHERE id = ?').get(id),
    createServer: (server, tokenHash) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const count = db.prepare('SELECT COUNT(*) AS count FROM servers WHERE owner_hash = ?').get(tokenHash).count;
        if (count >= 10) { db.exec('ROLLBACK'); return false; }
        db.prepare('INSERT INTO servers (id, name, image, max_players, owner_hash, created_at, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)').run(server.id, server.name, server.image, server.max, tokenHash, Date.now(), server.visibility);
        db.exec('COMMIT'); return true;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    deleteServer: (id, tokenHash) => db.prepare('DELETE FROM servers WHERE id = ? AND owner_hash = ?').run(id, tokenHash).changes > 0,
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
    } finally { await client.query('SELECT pg_advisory_unlock(1880567201)'); }
  } catch (error) { client.release(); await pool.end(); throw error; }
  client.release();
  return {
    close: () => pool.end(),
    health: () => pool.query('SELECT 1'),
    getGuest: async tokenHash => (await pool.query('SELECT name, username FROM guests WHERE token_hash = $1', [tokenHash])).rows[0],
    createGuest: tokenHash => pool.query('INSERT INTO guests (token_hash) VALUES ($1)', [tokenHash]),
    updateGuest: (name, username, tokenHash) => pool.query('UPDATE guests SET name = $1, username = $2 WHERE token_hash = $3', [name, username, tokenHash]),
    listServers: async () => (await pool.query("SELECT id, name, image, max_players, visibility FROM servers WHERE visibility = 'public' ORDER BY created_at DESC, id DESC")).rows,
    listMine: async tokenHash => (await pool.query('SELECT id, name, image, max_players, visibility FROM servers WHERE owner_hash = $1 ORDER BY created_at DESC, id DESC', [tokenHash])).rows,
    getServer: async id => (await pool.query('SELECT id, name, image, max_players, visibility FROM servers WHERE id = $1', [id])).rows[0],
    createServer: async (server, tokenHash) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT token_hash FROM guests WHERE token_hash = $1 FOR UPDATE', [tokenHash]);
        const count = Number((await client.query('SELECT COUNT(*) AS count FROM servers WHERE owner_hash = $1', [tokenHash])).rows[0].count);
        if (count >= 10) { await client.query('ROLLBACK'); return false; }
        await client.query('INSERT INTO servers (id, name, image, max_players, owner_hash, created_at, visibility) VALUES ($1, $2, $3, $4, $5, $6, $7)', [server.id, server.name, server.image, server.max, tokenHash, Date.now(), server.visibility]);
        await client.query('COMMIT'); return true;
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    deleteServer: async (id, tokenHash) => (await pool.query('DELETE FROM servers WHERE id = $1 AND owner_hash = $2', [id, tokenHash])).rowCount > 0,
  };
}

module.exports = { createStorage };
