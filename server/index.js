const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const db = require('./db');
const { generateSecret, verifyTotp, otpauthUrl, newBackupCodes, hashBackupCode } = require('./totp');

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const SESSION_DAYS = 7;
const COOKIE_MAX_AGE = SESSION_DAYS * 24 * 60 * 60 * 1000;

function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
}

function newReference() {
  const t = Date.now().toString().slice(-8);
  return `CB${t}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function now() {
  return new Date().toISOString();
}

function cleanPhone(phone) {
  return String(phone).trim().replace(/\s+/g, '');
}

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_SEND_COOLDOWN_MS = 30 * 1000;
const OTP_MAX_SENDS = 5;
const OTP_MAX_ATTEMPTS = 5;
const otpStore = new Map();

const PENDING2FA_TTL_MS = 5 * 60 * 1000;
const PENDING2FA_MAX_ATTEMPTS = 5;
const pending2FA = new Map();

function newPending2FA(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  pending2FA.set(token, { userId, attempts: 0, expires: Date.now() + PENDING2FA_TTL_MS });
  return token;
}

function consumeBackupCode(user, code) {
  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!normalized || !user.twofa_secret || !user.twofa_codes) return false;
  let codes = [];
  try { codes = JSON.parse(user.twofa_codes) || []; } catch (e) { /* corrupted list */ }
  const hash = hashBackupCode(user.twofa_secret, normalized);
  const idx = codes.indexOf(hash);
  if (idx === -1) return false;
  codes.splice(idx, 1);
  db.prepare('UPDATE users SET twofa_codes = ? WHERE id = ?').run(JSON.stringify(codes), user.id);
  return true;
}

function twofaPasses(user, code) {
  if (!user.twofa_secret) return false;
  if (verifyTotp(user.twofa_secret, code)) return true;
  return consumeBackupCode(user, code);
}

function newOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

app.post('/api/auth/send-otp', (req, res) => {
  const phoneClean = cleanPhone(req.body && req.body.phone);
  if (!/^\d{10,12}$/.test(phoneClean)) return res.status(400).json({ error: 'Enter a valid phone number (10-12 digits)' });

  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phoneClean);
  if (existing) return res.status(409).json({ error: 'An account already exists with this phone number' });

  const rec = otpStore.get(phoneClean);
  if (rec && Date.now() - (rec.lastSent || 0) < OTP_SEND_COOLDOWN_MS) {
    return res.status(429).json({ error: 'Please wait a moment before requesting another code' });
  }
  if ((rec && rec.sends || 0) >= OTP_MAX_SENDS) {
    return res.status(429).json({ error: 'Too many codes requested. Try again later.' });
  }

  const code = newOtp();
  otpStore.set(phoneClean, {
    code,
    expires: Date.now() + OTP_TTL_MS,
    attempts: 0,
    sends: (rec && rec.sends || 0) + 1,
    lastSent: Date.now(),
    verified: false,
    verifiedAt: null
  });
  // Simulated SMS/WhatsApp delivery (demo mode — swap this block for a real provider later)
  console.log(`[OTP] Simulated SMS/WhatsApp to ${phoneClean}: Your Chase Bank verification code is ${code}`);
  res.json({
    message: 'Verification code sent',
    demo_otp: code,
    expires_in: Math.round(OTP_TTL_MS / 1000),
    delivery: 'SMS / WhatsApp (simulated for this demo)'
  });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const phoneClean = cleanPhone(req.body && req.body.phone);
  const code = String((req.body && req.body.otp) || '').trim();
  if (!/^\d{10,12}$/.test(phoneClean)) return res.status(400).json({ error: 'Enter a valid phone number' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code' });

  const rec = otpStore.get(phoneClean);
  if (!rec || rec.expires <= Date.now()) return res.status(410).json({ error: 'This code has expired. Request a new one.' });
  if (rec.verified) return res.json({ message: 'Phone number already verified', verified: true });
  if (rec.attempts >= OTP_MAX_ATTEMPTS) {
    otpStore.delete(phoneClean);
    return res.status(429).json({ error: 'Too many wrong attempts. Request a new code.' });
  }
  if (rec.code !== code) {
    rec.attempts += 1;
    return res.status(400).json({ error: 'Incorrect code. Please try again.' });
  }
  rec.verified = true;
  rec.verifiedAt = Date.now();
  res.json({ message: 'Phone number verified', verified: true });
});

function sanitizeAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + COOKIE_MAX_AGE).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, now(), expires);
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getSessionUser(req) {
  const token = req.cookiesToken;
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ? AND u.blocked = 0
  `).get(token, now());
  return row || null;
}

function adminOnly(req) {
  const user = getSessionUser(req);
  if (!user) return { status: 401, error: 'Not authenticated' };
  if (!user.is_admin) return { status: 403, error: 'Admins only' };
  return { user };
}

function userAccounts(userId) {
  return db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY is_default DESC, id ASC').all(userId);
}

function userTotalBalance(userId) {
  const row = db.prepare('SELECT COALESCE(SUM(balance), 0) AS total FROM accounts WHERE user_id = ?').get(userId);
  return Math.round((Number(row.total) || 0) * 100) / 100;
}

function syncUserBalance(userId) {
  const total = userTotalBalance(userId);
  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(total, userId);
  return total;
}

function defaultAccount(userId) {
  return db.prepare('SELECT * FROM accounts WHERE user_id = ? AND is_default = 1').get(userId);
}

function sourceAccount(userId, accountId) {
  if (accountId != null) {
    const acct = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(Number(accountId), userId);
    if (!acct) return null;
    return acct;
  }
  return defaultAccount(userId);
}

function newAccountNumber() {
  for (let i = 0; i < 20; i++) {
    const n = '52' + String(crypto.randomInt(0, 100000000)).padStart(8, '0');
    if (!db.prepare('SELECT 1 FROM accounts WHERE account_number = ? UNION ALL SELECT 1 FROM users WHERE account_number = ?').get(n, n)) return n;
  }
  return '52' + String(Date.now()).slice(-8);
}

function insertTransaction({ userId, type, category, amount, counterparty, description, reference, balanceAfter, accountId }) {
  db.prepare(`
    INSERT INTO transactions (user_id, type, category, amount, counterparty, description, reference, balance_after, account_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, type, category, amount, counterparty, description, reference, balanceAfter, accountId, now());
}

function pushNotification(userId, message, type) {
  db.prepare('INSERT INTO notifications (user_id, message, type, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, message, type, now());
}

function setAuthCookie(res, token) {
  res.cookie('chase_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE
  });
}

app.use((req, res, next) => {
  req.cookiesToken = req.headers.cookie
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('chase_session='))
    ?.split('=')[1];
  next();
});

app.get('/api/auth/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({
    id: user.id,
    full_name: user.full_name,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    account_number: user.account_number,
    balance: userTotalBalance(user.id),
    avatar: user.avatar || null,
    twofa_enabled: !!user.twofa_enabled,
    twofa_setup: !!(user.twofa_secret && !user.twofa_enabled),
    is_admin: !!user.is_admin,
    blocked: !!user.blocked,
    created_at: user.created_at,
    accounts: userAccounts(user.id)
  });
});

app.post('/api/auth/register', (req, res) => {
  const { first_name, last_name, username, email, phone, password, confirm_password, transfer_pin, confirm_transfer_pin } = req.body || {};

  const first = String(first_name || '').trim();
  const last = String(last_name || '').trim();
  const name = `${first} ${last}`.replace(/\s+/g, ' ').trim().toUpperCase();
  const handle = String(username || '').trim().toLowerCase();
  const mail = String(email || '').trim().toLowerCase();
  const phoneClean = cleanPhone(phone);
  const pin = String(transfer_pin || '').trim();

  if (!first || !last) return res.status(400).json({ error: 'Enter both your first name and last name' });
  if (!/^[A-Za-z]{2,30}$/.test(first) || !/^[A-Za-z]{2,30}$/.test(last)) {
    return res.status(400).json({ error: 'First and last name must contain only letters (2-30 characters)' });
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(handle)) return res.status(400).json({ error: 'Username must be 3-20 characters using letters, numbers or underscores' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return res.status(400).json({ error: 'A valid email is required' });
  if (!/^\d{10,12}$/.test(phoneClean)) return res.status(400).json({ error: 'Phone number must be 10-12 digits' });
  if (String(password || '').length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (password !== confirm_password) return res.status(400).json({ error: 'Passwords do not match' });
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'Transfer pin must be exactly 4 digits' });
  if (pin !== String(confirm_transfer_pin || '').trim()) return res.status(400).json({ error: 'Transfer pins do not match' });
  if (pin === String(password)) return res.status(400).json({ error: 'Transfer pin must differ from your password' });

  const existing = db.prepare('SELECT id, email, phone, username FROM users WHERE email = ? OR phone = ? OR username = ?').get(mail, phoneClean, handle);
  if (existing) {
    if (existing.email === mail) return res.status(409).json({ error: 'An account already exists with this email address. Try signing in instead.', field: 'email' });
    if (existing.phone === phoneClean) return res.status(409).json({ error: 'An account already exists with this phone number. Try signing in instead.', field: 'phone' });
    return res.status(409).json({ error: 'That username is already taken. Choose a different username to continue.', field: 'username' });
  }

  const otpRec = otpStore.get(phoneClean);
  if (!otpRec || !otpRec.verified || Date.now() - (otpRec.verifiedAt || 0) > OTP_TTL_MS) {
    return res.status(400).json({ error: 'Please verify your phone number with the OTP first' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const pinHash = bcrypt.hashSync(pin, 10);
  const accountNumber = newAccountNumber();

  const info = db.prepare(`
    INSERT INTO users (full_name, first_name, last_name, username, email, phone, account_number, password_hash, transfer_pin, balance, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 50000, ?)
  `).run(name, first, last, handle, mail, phoneClean, accountNumber, passwordHash, pinHash, now());

  const userId = Number(info.lastInsertRowid);

  const accInfo = db.prepare(`
    INSERT INTO accounts (user_id, account_number, label, balance, is_default, created_at)
    VALUES (?, ?, 'Main account', 50000, 1, ?)
  `).run(userId, accountNumber, now());
  const defaultAccountId = Number(accInfo.lastInsertRowid);

  insertTransaction({
    userId,
    type: 'credit',
    category: 'WELCOME_BONUS',
    amount: 50000,
    counterparty: 'CHASE BANK',
    description: 'Welcome bonus for opening an account',
    reference: newReference(),
    balanceAfter: 50000,
    accountId: defaultAccountId
  });

  pushNotification(userId, 'Welcome to Chase Bank! A $50,000 welcome bonus has been credited to your account.', 'welcome');

  const token = createSession(userId);
  setAuthCookie(res, token);
  otpStore.delete(phoneClean);

  res.status(201).json({ message: 'Account created successfully', account_number: accountNumber });
});

app.post('/api/auth/login', (req, res) => {
  const { identifier, password } = req.body || {};
  const id = String(identifier || '').trim();

  if (!id) return res.status(400).json({ error: 'Enter your username or phone number' });
  if (!password) return res.status(400).json({ error: 'Password is required' });

  const user = /^\d{10,12}$/.test(id)
    ? db.prepare('SELECT * FROM users WHERE phone = ?').get(id)
    : db.prepare('SELECT * FROM users WHERE username = ?').get(id.toLowerCase());
  if (!user) return res.status(401).json({ error: 'No account found with this username or phone number' });

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  if (user.blocked) {
    return res.status(403).json({ error: 'This account has been blocked. Please contact support.' });
  }

  if (user.twofa_enabled) {
    const token = newPending2FA(user.id);
    return res.json({ message: 'Two-factor authentication required', twofa_required: true, token });
  }

  const token = createSession(user.id);
  setAuthCookie(res, token);

  res.json({ message: 'Login successful', account_number: user.account_number });
});

app.post('/api/auth/2fa/verify', (req, res) => {
  const { token, code } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Sign-in token missing' });
  const pending = pending2FA.get(token);
  if (!pending || pending.expires <= Date.now()) {
    pending2FA.delete(token);
    return res.status(410).json({ error: 'This sign-in request has expired. Sign in again.' });
  }
  if (pending.attempts >= PENDING2FA_MAX_ATTEMPTS) {
    pending2FA.delete(token);
    return res.status(429).json({ error: 'Too many attempts. Sign in again.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(pending.userId);
  if (!user) return res.status(401).json({ error: 'Account not found' });
  if (user.blocked) {
    pending2FA.delete(token);
    return res.status(403).json({ error: 'This account has been blocked. Please contact support.' });
  }
  if (!twofaPasses(user, code)) {
    pending.attempts += 1;
    return res.status(401).json({ error: 'Incorrect authentication code' });
  }
  pending2FA.delete(token);
  const session = createSession(user.id);
  setAuthCookie(res, session);
  res.json({ message: 'Login successful', account_number: user.account_number });
});

app.post('/api/auth/2fa/setup', async (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (user.twofa_enabled) return res.status(400).json({ error: 'Two-factor authentication is already enabled' });
  const secret = generateSecret();
  db.prepare('UPDATE users SET twofa_secret = ? WHERE id = ?').run(secret, user.id);
  const label = String(user.username || user.email || 'user');
  const otpauth = otpauthUrl(secret, label);
  let qr = null;
  try { qr = await QRCode.toDataURL(otpauth, { width: 260, margin: 1, errorCorrectionLevel: 'M' }); } catch (e) { /* QR generation failed — secret + link still usable */ }
  res.json({ secret, otpauth, qr });
});

app.post('/api/auth/2fa/enable', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (user.twofa_enabled) return res.status(400).json({ error: 'Two-factor authentication is already enabled' });
  if (!user.twofa_secret) return res.status(400).json({ error: 'Start the 2FA setup first' });
  const { code } = req.body || {};
  if (!verifyTotp(user.twofa_secret, code)) {
    return res.status(400).json({ error: 'Incorrect code. Enter the 6-digit code from your authenticator app.' });
  }
  const codes = newBackupCodes();
  const hashes = codes.map((c) => hashBackupCode(user.twofa_secret, c));
  db.prepare('UPDATE users SET twofa_enabled = 1, twofa_codes = ? WHERE id = ?').run(JSON.stringify(hashes), user.id);
  res.status(201).json({ message: 'Two-factor authentication enabled', backup_codes: codes });
});

app.post('/api/auth/2fa/backup-codes', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (!user.twofa_secret || !user.twofa_enabled) return res.status(400).json({ error: 'Enable two-factor authentication first' });
  const { code } = req.body || {};
  if (!twofaPasses(user, code)) return res.status(401).json({ error: 'Incorrect authentication code' });
  const codes = newBackupCodes();
  const hashes = codes.map((c) => hashBackupCode(user.twofa_secret, c));
  db.prepare('UPDATE users SET twofa_codes = ? WHERE id = ?').run(JSON.stringify(hashes), user.id);
  res.json({ backup_codes: codes });
});

app.post('/api/auth/2fa/disable', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (!user.twofa_enabled) return res.status(400).json({ error: 'Two-factor authentication is not enabled' });
  const { code } = req.body || {};
  if (!twofaPasses(user, code)) return res.status(401).json({ error: 'Incorrect authentication code' });
  db.prepare('UPDATE users SET twofa_secret = NULL, twofa_enabled = 0, twofa_codes = NULL WHERE id = ?').run(user.id);
  res.json({ message: 'Two-factor authentication disabled' });
});

/* ---------------- Admin panel ---------------- */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function adminUsersQuery() {
  return `
    SELECT u.id, u.full_name, u.first_name, u.last_name, u.username, u.email, u.phone, u.account_number,
           u.balance, u.twofa_enabled, u.is_admin, u.blocked, u.created_at,
           (SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) AS accounts_count,
           (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id) AS tx_count
    FROM users u
  `;
}

app.get('/api/admin/overview', (req, res) => {
  const guard = adminOnly(req);
  if (guard.error) return res.status(guard.status).json({ error: guard.error });
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const admins = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get().c;
  const blocked = db.prepare('SELECT COUNT(*) AS c FROM users WHERE blocked = 1').get().c;
  const accounts = db.prepare('SELECT COUNT(*) AS c FROM accounts').get().c;
  const totalBalance = round2(db.prepare('SELECT COALESCE(SUM(balance), 0) AS t FROM accounts').get().t);
  const moneyIn = round2(db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM transactions WHERE type = 'credit'").get().t);
  const withdrawals = round2(db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM transactions WHERE type = 'debit' AND category = 'WITHDRAWAL'").get().t);
  const transfers = round2(db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM transactions WHERE category = 'TRANSFER'").get().t);
  const transactions = db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c;
  res.json({ users, admins, blocked, accounts, total_balance: totalBalance, money_in: moneyIn, withdrawals, transfers, transactions });
});

app.get('/api/admin/users', (req, res) => {
  const guard = adminOnly(req);
  if (guard.error) return res.status(guard.status).json({ error: guard.error });
  const q = String(req.query.q || '').trim();
  let rows;
  if (q) {
    const like = '%' + q + '%';
    rows = db.prepare(adminUsersQuery() + 'WHERE u.full_name LIKE ? OR u.username LIKE ? OR u.phone LIKE ? OR u.email LIKE ? OR u.account_number LIKE ? ORDER BY u.id ASC')
      .all(like, like, like, like, like);
  } else {
    rows = db.prepare(adminUsersQuery() + 'ORDER BY u.id ASC').all();
  }
  res.json(rows.map((u) => ({
    ...u,
    balance: round2(u.balance),
    twofa_enabled: !!u.twofa_enabled,
    is_admin: !!u.is_admin,
    blocked: !!u.blocked
  })));
});

app.get('/api/admin/transactions', (req, res) => {
  const guard = adminOnly(req);
  if (guard.error) return res.status(guard.status).json({ error: guard.error });
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const base = `
    SELECT t.*, u.full_name AS user_name, u.username AS user_username
    FROM transactions t JOIN users u ON u.id = t.user_id
  `;
  let rows;
  if (q) {
    const like = '%' + q + '%';
    rows = db.prepare(base + 'WHERE u.full_name LIKE ? OR u.username LIKE ? OR t.reference LIKE ? OR COALESCE(t.counterparty, \'\') LIKE ? OR CAST(t.amount AS TEXT) LIKE ? ORDER BY t.id DESC LIMIT ?')
      .all(like, like, like, like, like, limit);
  } else {
    rows = db.prepare(base + 'ORDER BY t.id DESC LIMIT ?').all(limit);
  }
  res.json(rows.map((t) => ({ ...t, amount: round2(t.amount), balance_after: round2(t.balance_after) })));
});

app.post('/api/admin/users/:id/block', (req, res) => {
  const guard = adminOnly(req);
  if (guard.error) return res.status(guard.status).json({ error: guard.error });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === guard.user.id) return res.status(400).json({ error: 'You cannot block your own account' });
  if (target.is_admin) return res.status(400).json({ error: 'Cannot block an administrator' });
  db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').run(target.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  res.json({ message: 'Account blocked', blocked: true, id: target.id });
});

app.post('/api/admin/users/:id/unblock', (req, res) => {
  const guard = adminOnly(req);
  if (guard.error) return res.status(guard.status).json({ error: guard.error });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET blocked = 0 WHERE id = ?').run(target.id);
  res.json({ message: 'Account unblocked', blocked: false, id: target.id });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(req.cookiesToken);
  res.clearCookie('chase_session');
  res.json({ message: 'Logged out' });
});

app.get('/api/account', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({
    full_name: user.full_name,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    account_number: user.account_number,
    balance: userTotalBalance(user.id),
    avatar: user.avatar || null,
    twofa_enabled: !!user.twofa_enabled,
    twofa_setup: !!(user.twofa_secret && !user.twofa_enabled),
    is_admin: !!user.is_admin,
    blocked: !!user.blocked,
    created_at: user.created_at,
    accounts: userAccounts(user.id)
  });
});

app.get('/api/transactions', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const rows = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(user.id);
  res.json(rows);
});

app.post('/api/transfer', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { recipient, amount, pin, description, account_id } = req.body || {};
  const accNum = String(recipient || '').trim().replace(/\s+/g, '');
  const amt = sanitizeAmount(amount);

  if (!/^52\d{8}$/.test(accNum)) return res.status(400).json({ error: 'Enter a valid recipient account number (starts with 52)' });
  if (amt === null) return res.status(400).json({ error: 'Enter a valid amount' });
  if (!/^\d{4}$/.test(String(pin || ''))) return res.status(400).json({ error: 'Enter your 4-digit transfer pin' });
  if (!bcrypt.compareSync(String(pin), user.transfer_pin)) return res.status(401).json({ error: 'Incorrect transfer pin' });

  const from = sourceAccount(user.id, account_id);
  if (!from) return res.status(400).json({ error: 'Select a valid source account' });
  if (amt > from.balance) return res.status(400).json({ error: 'Insufficient balance for this transfer' });

  const to = db.prepare('SELECT * FROM accounts WHERE account_number = ?').get(accNum);
  if (!to) return res.status(404).json({ error: 'No Chase Bank account found with this account number' });

  const desc = String(description || '').trim() || 'Bank transfer';

  if (to.user_id === user.id) {
    if (to.id === from.id) return res.status(400).json({ error: 'Transfer to your own account is already in that account' });

    db.exec('BEGIN');
    try {
      const newFrom = Math.round((from.balance - amt) * 100) / 100;
      const newTo = Math.round((to.balance + amt) * 100) / 100;
      db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(newFrom, from.id);
      db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(newTo, to.id);

      const ref = newReference();
      insertTransaction({ userId: user.id, type: 'debit', category: 'TRANSFER', amount: amt, counterparty: `MOVED TO ${to.label.toUpperCase()} (${to.account_number})`, description: desc, reference: ref, balanceAfter: newFrom, accountId: from.id });
      insertTransaction({ userId: user.id, type: 'credit', category: 'TRANSFER', amount: amt, counterparty: `FROM ${from.label.toUpperCase()} (${from.account_number})`, description: desc, reference: ref, balanceAfter: newTo, accountId: to.id });

      pushNotification(user.id, `You moved $${amt.toLocaleString()} from ${from.label} to ${to.label}.`, 'debit');

      const total = syncUserBalance(user.id);
      db.exec('COMMIT');
      return res.json({ message: 'Transfer successful', reference: ref, balance: total });
    } catch (err) {
      db.exec('ROLLBACK');
      console.error(err);
      return res.status(500).json({ error: 'Transfer failed. Please try again.' });
    }
  }

  const recipientUser = db.prepare('SELECT * FROM users WHERE id = ?').get(to.user_id);
  if (!recipientUser) return res.status(500).json({ error: 'Recipient account unavailable' });

  db.exec('BEGIN');
  try {
    const newFrom = Math.round((from.balance - amt) * 100) / 100;
    const newTo = Math.round((to.balance + amt) * 100) / 100;
    db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(newFrom, from.id);
    db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(newTo, to.id);

    const ref = newReference();
    insertTransaction({ userId: user.id, type: 'debit', category: 'TRANSFER', amount: amt, counterparty: `SENT TO ${recipientUser.full_name.toUpperCase()} (${accNum})`, description: desc, reference: ref, balanceAfter: newFrom, accountId: from.id });
    insertTransaction({ userId: recipientUser.id, type: 'credit', category: 'TRANSFER', amount: amt, counterparty: `FROM ${user.full_name.toUpperCase()} (${user.account_number})`, description: desc, reference: ref, balanceAfter: newTo, accountId: to.id });

    pushNotification(user.id, `You sent $${amt.toLocaleString()} to ${recipientUser.full_name} (${accNum}).`, 'debit');
    pushNotification(recipientUser.id, `You received $${amt.toLocaleString()} from ${user.full_name} (${user.account_number}).`, 'credit');

    const total = syncUserBalance(user.id);
    syncUserBalance(recipientUser.id);
    db.exec('COMMIT');
    res.json({ message: 'Transfer successful', reference: ref, balance: total });
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Transfer failed. Please try again.' });
  }
});

app.post('/api/withdraw', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { amount, pin, account_id } = req.body || {};
  const amt = sanitizeAmount(amount);

  if (amt === null) return res.status(400).json({ error: 'Enter a valid amount' });
  if (!/^\d{4}$/.test(String(pin || ''))) return res.status(400).json({ error: 'Enter your 4-digit transfer pin' });
  if (!bcrypt.compareSync(String(pin), user.transfer_pin)) return res.status(401).json({ error: 'Incorrect transfer pin' });

  const from = sourceAccount(user.id, account_id);
  if (!from) return res.status(400).json({ error: 'Select a valid source account' });
  if (amt > from.balance) return res.status(400).json({ error: 'Insufficient balance for this withdrawal' });

  const newBalance = Math.round((from.balance - amt) * 100) / 100;
  db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(newBalance, from.id);

  const ref = newReference();
  insertTransaction({ userId: user.id, type: 'debit', category: 'WITHDRAWAL', amount: amt, counterparty: 'CASH', description: 'Cash withdrawal', reference: ref, balanceAfter: newBalance, accountId: from.id });

  pushNotification(user.id, `You withdrawn $${amt.toLocaleString()} in cash.`, 'debit');

  const total = syncUserBalance(user.id);
  res.json({ message: 'Withdrawal successful', reference: ref, balance: total });
});

app.get('/api/accounts', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(userAccounts(user.id));
});

app.post('/api/accounts', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { label } = req.body || {};
  const count = db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE user_id = ?').get(user.id).c;
  if (count >= 10) return res.status(400).json({ error: 'Maximum of 10 accounts reached' });

  const name = String(label || '').trim().slice(0, 30) || `Account ${count}`;
  const accountNumber = newAccountNumber();

  const info = db.prepare(`
    INSERT INTO accounts (user_id, account_number, label, balance, is_default, created_at)
    VALUES (?, ?, ?, 0, 0, ?)
  `).run(user.id, accountNumber, name, now());

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(info.lastInsertRowid));
  pushNotification(user.id, `You opened a new account "${name}" (${accountNumber}). It starts at $0.`, 'info');

  res.status(201).json({ message: 'Account opened successfully', account, accounts: userAccounts(user.id) });
});

app.post('/api/accounts/move', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { from_account_id, to_account_id, amount, pin } = req.body || {};
  const from = sourceAccount(user.id, from_account_id);
  const to = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(to_account_id, user.id);
  const amt = sanitizeAmount(amount);

  if (!from || from_account_id == null) return res.status(400).json({ error: 'Select a valid source account' });
  if (!to) return res.status(400).json({ error: 'Select a valid destination account' });
  if (from.id === to.id) return res.status(400).json({ error: 'Choose two different accounts' });
  if (amt === null) return res.status(400).json({ error: 'Enter a valid amount' });
  if (!/^\d{4}$/.test(String(pin || ''))) return res.status(400).json({ error: 'Enter your 4-digit transfer pin' });
  if (!bcrypt.compareSync(String(pin), user.transfer_pin)) return res.status(401).json({ error: 'Incorrect transfer pin' });
  if (amt > from.balance) return res.status(400).json({ error: 'Insufficient balance in the source account' });

  db.exec('BEGIN');
  try {
    const newFrom = Math.round((from.balance - amt) * 100) / 100;
    const newTo = Math.round((to.balance + amt) * 100) / 100;
    db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(newFrom, from.id);
    db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(newTo, to.id);

    const ref = newReference();
    insertTransaction({ userId: user.id, type: 'debit', category: 'TRANSFER', amount: amt, counterparty: `MOVED TO ${to.label.toUpperCase()} (${to.account_number})`, description: 'Internal transfer', reference: ref, balanceAfter: newFrom, accountId: from.id });
    insertTransaction({ userId: user.id, type: 'credit', category: 'TRANSFER', amount: amt, counterparty: `FROM ${from.label.toUpperCase()} (${from.account_number})`, description: 'Internal transfer', reference: ref, balanceAfter: newTo, accountId: to.id });

    pushNotification(user.id, `You moved $${amt.toLocaleString()} from ${from.label} to ${to.label}.`, 'debit');

    const total = syncUserBalance(user.id);
    db.exec('COMMIT');
    res.json({ message: 'Transfer successful', reference: ref, balance: total });
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Transfer failed. Please try again.' });
  }
});

app.post('/api/profile/avatar', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const dataUrl = String((req.body && req.body.avatar) || '');
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) {
    return res.status(400).json({ error: 'Invalid image. Use a PNG, JPEG or WebP picture.' });
  }
  if (Buffer.byteLength(dataUrl, 'utf8') > 400 * 1024) {
    return res.status(400).json({ error: 'Image is too large (max 300 KB)' });
  }

  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(dataUrl, user.id);
  res.json({ message: 'Profile picture updated', avatar: dataUrl });
});

app.get('/api/notifications', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.id);
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id);
  res.json({ notifications: rows, unread: unread.c });
});

app.put('/api/notifications/readall', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user.id);
  res.json({ message: 'All notifications marked as read' });
});

app.post('/api/customer-care', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const subject = String(req.body?.subject || '').trim();
  const message = String(req.body?.message || '').trim();

  if (!subject || subject.length < 3) return res.status(400).json({ error: 'Please provide a subject' });
  if (!message || message.length < 10) return res.status(400).json({ error: 'Please describe your issue (at least 10 characters)' });

  db.prepare('INSERT INTO messages (user_id, subject, message, created_at) VALUES (?, ?, ?, ?)')
    .run(user.id, subject, message, now());

  res.status(201).json({ message: 'Your message has been sent. Our team will respond within 24 hours.' });
});

app.get('/api/pay/recipient', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const accNum = String(req.query.account || '').trim();
  if (!/^52\d{8}$/.test(accNum)) return res.status(400).json({ error: 'Enter a valid recipient account number (starts with 52)' });
  const account = db.prepare('SELECT a.*, u.full_name, u.phone, u.username FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.account_number = ?').get(accNum);
  if (!account) return res.status(404).json({ error: 'No Chase Bank account found with this account number' });
  if (account.user_id === user.id) return res.status(400).json({ error: 'This is your own account number' });
  res.json({ full_name: account.full_name, phone: account.phone, username: account.username, account_number: account.account_number });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Chase Bank running at http://localhost:${PORT}`);
});