const path = require('node:path');

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const isTurso = Boolean(TURSO_URL);

let db;
if (isTurso) {
  // Embedded replica: a local libSQL file that keeps SQLite semantics locally
  // while syncing committed frames to the Turso cloud database every second.
  // Runtime data therefore survives restart, redeploys, and instance recycles
  // (unlike a bare SQLite file on Render's ephemeral disk).
  const Database = require('libsql');
  const replicaPath = process.env.CHASE_BANK_DB || path.join(__dirname, '..', 'data', 'turso-replica.db');
  db = new Database(replicaPath, {
    syncUrl: TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
    syncPeriod: 1
  });
  try {
    db.sync();
  } catch (err) {
    console.error('Initial Turso sync failed (continuing with local replica):', err.message);
  }
  db.exec('PRAGMA foreign_keys = ON;');

  // The embedded replica multiplexes reads and writes across separate SQLite
  // connections, so explicit BEGIN/COMMIT transactions are unreliable here: a
  // SELECT inside a transaction, or foreign-key validation against a row
  // inserted in the same transaction, can silently end the transaction and turn
  // COMMIT into "cannot commit - no transaction is active". The stable mode for
  // a replica is autocommit (every run() is its own committed frame, kept
  // read-your-writes by syncPeriod). BEGIN/COMMIT/ROLLBACK are therefore no-ops
  // and transaction() executes its callback statement-by-statement in autocommit,
  // so the same server code works on local SQLite and on Turso.
  const execOrig = db.exec.bind(db);
  db.exec = (sql) => {
    const head = String(sql).trim().split(/\s+/)[0].toUpperCase();
    if (head === 'BEGIN' || head === 'COMMIT' || head === 'ROLLBACK') return undefined;
    return execOrig(sql);
  };
  db.transaction = (fn) => {
    const runAuto = (...args) => fn(...args);
    runAuto.default = runAuto;
    runAuto.deferred = runAuto;
    runAuto.immediate = runAuto;
    runAuto.exclusive = runAuto;
    runAuto.database = db;
    return runAuto;
  };

  // Flush pending local writes to Turso before the process shuts down
  // (Render can terminate free instances at any time).
  const onExit = () => {
    try {
      db.sync();
    } catch (_) { /* ignore */ }
  };
  process.on('SIGTERM', onExit);
  process.on('SIGINT', onExit);
} else {
  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = process.env.CHASE_BANK_DB || path.join(__dirname, '..', 'data', 'chasebank.db');
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  // Local SQLite supports real transactions per migration call.
  const txnLocal = (fn) => {
    const run = (...args) => {
      db.exec('BEGIN');
      try {
        const out = fn(...args);
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    };
    run.default = run;
    run.deferred = run;
    run.immediate = run;
    run.exclusive = run;
    run.database = db;
    return run;
  };
  db.transaction = txnLocal;
}

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  username      TEXT,
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

// Ensure every user has a default account (covers databases made before the multi-account feature).
const accountCount = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
if (accountCount === 0) {
  const users = db.prepare('SELECT id, account_number, balance, created_at FROM users').all();
  const seed = db.prepare('INSERT INTO accounts (user_id, account_number, label, balance, is_default, created_at) VALUES (?, ?, ?, ?, 1, ?)');
  db.transaction(() => {
    for (const u of users) seed.run(u.id, u.account_number, 'Main account', u.balance, u.created_at);
  })();
}

// Migrations for databases created before the multi-account / avatar feature.
if (!columnExists('transactions', 'account_id')) {
  db.exec('ALTER TABLE transactions ADD COLUMN account_id INTEGER');
  const rows = db.prepare('SELECT t.id AS tid, a.id AS aid FROM transactions t JOIN accounts a ON a.user_id = t.user_id AND a.is_default = 1').all();
  const upd = db.prepare('UPDATE transactions SET account_id = ? WHERE id = ?');
  db.transaction(() => {
    for (const r of rows) upd.run(r.aid, r.tid);
  })();
}

if (!columnExists('users', 'avatar')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
}

// Migrations for the account-identity feature: a unique username chosen at signup,
// first/last names, and site-issued account numbers starting with "52".
if (!columnExists('users', 'username')) {
  db.exec('ALTER TABLE users ADD COLUMN username TEXT');
}
if (!columnExists('users', 'first_name')) {
  db.exec('ALTER TABLE users ADD COLUMN first_name TEXT');
  db.exec('ALTER TABLE users ADD COLUMN last_name TEXT');
}

// Backfill usernames and first/last names for databases created before this feature.
const idRows = db.prepare('SELECT id, full_name, email, username, first_name FROM users').all();
const usedUsernames = new Set();
const updIdentity = db.prepare('UPDATE users SET username = ?, first_name = ?, last_name = ? WHERE id = ?');
db.transaction(() => {
  for (const r of idRows) {
    let username = String(r.username || '').trim().toLowerCase();
    if (!username) {
      const base = String(r.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'user';
      username = base;
      let i = 1;
      while (usedUsernames.has(username)) username = base + i++;
    }
    usedUsernames.add(username);
    let first = String(r.first_name || '').trim();
    let last = '';
    if (!first) {
      const parts = String(r.full_name || '').trim().split(/\s+/).filter(Boolean);
      first = parts.shift() || 'User';
      last = parts.join(' ');
    }
    updIdentity.run(username, first, last, r.id);
  }
})();
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');

// Reassign legacy account numbers (previously the phone number) to site-issued
// "52"-prefixed numbers.
const legacyAccs = db
  .prepare("SELECT u.id AS uid, a.id AS aid FROM users u JOIN accounts a ON a.user_id = u.id WHERE substr(u.account_number, 1, 2) != '52'")
  .all();
if (legacyAccs.length) {
  const takenAcct = new Set(
    db.prepare('SELECT account_number FROM users UNION SELECT account_number FROM accounts').all().map((r) => r.account_number)
  );
  const next52 = () => {
    let n;
    do { n = '52' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0'); } while (takenAcct.has(n));
    takenAcct.add(n);
    return n;
  };
  const updU = db.prepare('UPDATE users SET account_number = ? WHERE id = ?');
  const updA = db.prepare('UPDATE accounts SET account_number = ? WHERE id = ?');
  db.transaction(() => {
    for (const r of legacyAccs) {
      const n = next52();
      updU.run(n, r.uid);
      updA.run(n, r.aid);
    }
  })();
}

// Seed the demo users on empty databases (fresh local clones or a brand-new Turso DB).
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const demo = [
    {
      full_name: 'TUNDE BALOGUN',
      first_name: 'TUNDE',
      last_name: 'BALOGUN',
      username: 'tunde',
      email: 'tunde@chasebank.test',
      phone: '07011112222',
      account_number: '5200000001',
      password_hash: '$2b$10$oSNqEuprY2740ltxHetZ/OKFv6m9ftRaUc2srWpNehmY/Oq2GJOP2',
      transfer_pin: '$2b$10$RVwjsdxODl17xar8i9CZwucljt3V55.N3r3MF3kcsFZ3kQcaWVON2',
      balance: 52500,
      created_at: '2026-09-16T02:47:05.297Z'
    },
    {
      full_name: 'ADAEZE OBI',
      first_name: 'ADAEZE',
      last_name: 'OBI',
      username: 'adaeze',
      email: 'adaeze@chasebank.test',
      phone: '08123456789',
      account_number: '5200000002',
      password_hash: '$2b$10$9VEpmT3BfKYFJaobbQDLJOOoTmXRZ69.cj0YOuh.aT.ZxGI4KcmEa',
      transfer_pin: '$2b$10$40lN9aMJtHDWSNiVWCpIhOYlKyaemWu6vw9YW.ADvM6qc3KrybfRW',
      balance: 47500,
      created_at: '2026-09-16T02:47:18.526Z'
    }
  ];
  const txRows = [
    { user_id: 1, account_no: '5200000001', type: 'credit', category: 'WELCOME_BONUS', amount: 50000, counterparty: 'CHASE BANK', description: 'Welcome bonus for opening an account', reference: 'CB26825329ECB1', balance_after: 50000, created_at: '2026-09-16T02:47:05.330Z' },
    { user_id: 2, account_no: '5200000002', type: 'credit', category: 'WELCOME_BONUS', amount: 50000, counterparty: 'CHASE BANK', description: 'Welcome bonus for opening an account', reference: 'CB268385518E02', balance_after: 50000, created_at: '2026-09-16T02:47:18.551Z' },
    { user_id: 2, account_no: '5200000002', type: 'debit', category: 'TRANSFER', amount: 2500, counterparty: 'SENT TO TUNDE BALOGUN (5200000001)', description: 'Lunch money', reference: 'CB26840910993C', balance_after: 47500, created_at: '2026-09-16T02:47:20.910Z' },
    { user_id: 1, account_no: '5200000001', type: 'credit', category: 'TRANSFER', amount: 2500, counterparty: 'FROM ADAEZE OBI (5200000002)', description: 'Lunch money', reference: 'CB26840910993C', balance_after: 52500, created_at: '2026-09-16T02:47:20.910Z' }
  ];
  const notifRows = [
    { user_id: 1, message: 'Welcome to Chase Bank! A $50,000 welcome bonus has been credited to your account.', type: 'welcome', created_at: '2026-09-16T02:47:05.355Z' },
    { user_id: 2, message: 'Welcome to Chase Bank! A $50,000 welcome bonus has been credited to your account.', type: 'welcome', created_at: '2026-09-16T02:47:18.601Z' },
    { user_id: 2, message: 'You sent $2,500 to TUNDE BALOGUN (5200000001).', type: 'debit', created_at: '2026-09-16T02:47:20.974Z' },
    { user_id: 1, message: 'You received $2,500 from ADAEZE OBI (5200000002).', type: 'credit', created_at: '2026-09-16T02:47:20.974Z' }
  ];
  const insUser = db.prepare('INSERT INTO users (full_name, first_name, last_name, username, email, phone, account_number, password_hash, transfer_pin, balance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insAccount = db.prepare('INSERT INTO accounts (user_id, account_number, label, balance, is_default, created_at) VALUES (?, ?, ?, ?, 1, ?)');
  const insTx = db.prepare('INSERT INTO transactions (user_id, type, category, amount, counterparty, description, reference, balance_after, account_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insNotif = db.prepare('INSERT INTO notifications (user_id, message, type, created_at) VALUES (?, ?, ?, ?)');

  db.transaction(() => {
    for (const u of demo) {
      const userResult = insUser.run(u.full_name, u.first_name, u.last_name, u.username, u.email, u.phone, u.account_number, u.password_hash, u.transfer_pin, u.balance, u.created_at);
      const userId = Number(userResult.lastInsertRowid);
      const accountResult = insAccount.run(userId, u.account_number, 'Main account', u.balance, u.created_at);
      const accountId = Number(accountResult.lastInsertRowid);
      for (const t of txRows) {
        if (t.user_id !== userId) continue;
        insTx.run(t.user_id, t.type, t.category, t.amount, t.counterparty, t.description, t.reference, t.balance_after, accountId, t.created_at);
      }
      for (const n of notifRows) {
        if (n.user_id !== userId) continue;
        insNotif.run(n.user_id, n.message, n.type, n.created_at);
      }
    }
  })();

  if (isTurso) {
    try {
      db.sync();
    } catch (err) {
      console.error('Seed sync to Turso failed (will retry in background):', err.message);
    }
  }
}

module.exports = db;
