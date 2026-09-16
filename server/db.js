const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.join(__dirname, '..', 'data', 'chasebank.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL UNIQUE,
  account_number TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  transfer_pin  TEXT NOT NULL,
  balance       REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  type          TEXT NOT NULL,
  category      TEXT NOT NULL,
  amount        REAL NOT NULL,
  counterparty  TEXT,
  description   TEXT,
  reference     TEXT NOT NULL,
  balance_after REAL NOT NULL,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  message    TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'info',
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  subject    TEXT NOT NULL,
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS accounts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  account_number TEXT NOT NULL UNIQUE,
  label          TEXT NOT NULL DEFAULT 'Main account',
  balance        REAL NOT NULL DEFAULT 0,
  is_default     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

function tableExists(name) {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined;
}

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

// Migrations for databases created before the multi-account / avatar feature.
if (!tableExists('accounts')) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      account_number TEXT NOT NULL UNIQUE,
      label          TEXT NOT NULL DEFAULT 'Main account',
      balance        REAL NOT NULL DEFAULT 0,
      is_default     INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
}

const accountCount = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
if (accountCount === 0) {
  const users = db.prepare('SELECT id, account_number, balance, created_at FROM users').all();
  const seed = db.prepare('INSERT INTO accounts (user_id, account_number, label, balance, is_default, created_at) VALUES (?, ?, ?, ?, 1, ?)');
  db.exec('BEGIN');
  try {
    for (const u of users) seed.run(u.id, u.account_number, 'Main account', u.balance, u.created_at);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

if (!columnExists('transactions', 'account_id')) {
  db.exec('ALTER TABLE transactions ADD COLUMN account_id INTEGER');
  const rows = db.prepare('SELECT t.id AS tid, a.id AS aid FROM transactions t JOIN accounts a ON a.user_id = t.user_id AND a.is_default = 1').all();
  const upd = db.prepare('UPDATE transactions SET account_id = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const r of rows) upd.run(r.aid, r.tid);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

if (!columnExists('users', 'avatar')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
}

module.exports = db;