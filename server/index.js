const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();

app.use(express.json());
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
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, now());
  return row || null;
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
    email: user.email,
    phone: user.phone,
    account_number: user.account_number,
    balance: user.balance,
    created_at: user.created_at
  });
});

app.post('/api/auth/register', (req, res) => {
  const { full_name, email, phone, password, confirm_password, transfer_pin, confirm_transfer_pin } = req.body || {};

  const name = String(full_name || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  const phoneClean = cleanPhone(phone);
  const pin = String(transfer_pin || '').trim();

  if (!name) return res.status(400).json({ error: 'Full name is required' });
  if (name.length < 3) return res.status(400).json({ error: 'Name must be at least 3 characters' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return res.status(400).json({ error: 'A valid email is required' });
  if (!/^\d{10,12}$/.test(phoneClean)) return res.status(400).json({ error: 'Phone number must be 10-12 digits' });
  if (String(password || '').length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (password !== confirm_password) return res.status(400).json({ error: 'Passwords do not match' });
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'Transfer pin must be exactly 4 digits' });
  if (pin !== String(confirm_transfer_pin || '').trim()) return res.status(400).json({ error: 'Transfer pins do not match' });
  if (pin === String(password)) return res.status(400).json({ error: 'Transfer pin must differ from your password' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ? OR phone = ?').get(mail, phoneClean);
  if (existing) return res.status(409).json({ error: 'An account already exists with this email or phone number' });

  const otpRec = otpStore.get(phoneClean);
  if (!otpRec || !otpRec.verified || Date.now() - (otpRec.verifiedAt || 0) > OTP_TTL_MS) {
    return res.status(400).json({ error: 'Please verify your phone number with the OTP first' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const pinHash = bcrypt.hashSync(pin, 10);

  const info = db.prepare(`
    INSERT INTO users (full_name, email, phone, account_number, password_hash, transfer_pin, balance, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 50000, ?)
  `).run(name, mail, phoneClean, phoneClean, passwordHash, pinHash, now());

  const userId = Number(info.lastInsertRowid);

  db.prepare(`
    INSERT INTO transactions (user_id, type, category, amount, counterparty, description, reference, balance_after, created_at)
    VALUES (?, 'credit', 'WELCOME_BONUS', 50000, 'CHASE BANK', 'Welcome bonus for opening an account', ?, 50000, ?)
  `).run(userId, newReference(), now());

  db.prepare(`
    INSERT INTO notifications (user_id, message, type, created_at)
    VALUES (?, ?, 'welcome', ?)
  `).run(userId, 'Welcome to Chase Bank! A $50,000 welcome bonus has been credited to your account.', now());

  const token = createSession(userId);
  setAuthCookie(res, token);
  otpStore.delete(phoneClean);

  res.status(201).json({ message: 'Account created successfully', account_number: phoneClean });
});

app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body || {};
  const phoneClean = cleanPhone(phone);

  if (!/^\d{10,12}$/.test(phoneClean)) return res.status(400).json({ error: 'Enter a valid phone number' });
  if (!password) return res.status(400).json({ error: 'Password is required' });

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phoneClean);
  if (!user) return res.status(401).json({ error: 'No account found with this phone number' });

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const token = createSession(user.id);
  setAuthCookie(res, token);

  res.json({ message: 'Login successful', account_number: user.account_number });
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
    email: user.email,
    phone: user.phone,
    account_number: user.account_number,
    balance: user.balance,
    created_at: user.created_at
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

  const { recipient, amount, pin, description } = req.body || {};
  const recipientPhone = cleanPhone(recipient);
  const amt = sanitizeAmount(amount);

  if (!/^\d{10,12}$/.test(recipientPhone)) return res.status(400).json({ error: 'Enter a valid recipient phone number' });
  if (amt === null) return res.status(400).json({ error: 'Enter a valid amount' });
  if (!/^\d{4}$/.test(String(pin || ''))) return res.status(400).json({ error: 'Enter your 4-digit transfer pin' });
  if (!bcrypt.compareSync(String(pin), user.transfer_pin)) return res.status(401).json({ error: 'Incorrect transfer pin' });

  if (recipientPhone === user.phone) return res.status(400).json({ error: 'You cannot transfer money to your own account' });

  const recipientUser = db.prepare('SELECT * FROM users WHERE phone = ?').get(recipientPhone);
  if (!recipientUser) return res.status(404).json({ error: 'No Chase Bank account found with this phone number' });

  if (amt > user.balance) return res.status(400).json({ error: 'Insufficient balance for this transfer' });

  const desc = String(description || '').trim() || 'Bank transfer';

  db.exec('BEGIN');

  try {
    const newBalance = Math.round((user.balance - amt) * 100) / 100;
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, user.id);

    const newRecipientBalance = Math.round((recipientUser.balance + amt) * 100) / 100;
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newRecipientBalance, recipientUser.id);

    const ref = newReference();
    db.prepare(`
      INSERT INTO transactions (user_id, type, category, amount, counterparty, description, reference, balance_after, created_at)
      VALUES (?, 'debit', 'TRANSFER', ?, ?, ?, ?, ?, ?)
    `).run(user.id, amt, `SENT TO ${recipientUser.full_name.toUpperCase()} (${recipientPhone})`, desc, ref, newBalance, now());

    db.prepare(`
      INSERT INTO transactions (user_id, type, category, amount, counterparty, description, reference, balance_after, created_at)
      VALUES (?, 'credit', 'TRANSFER', ?, ?, ?, ?, ?, ?)
    `).run(recipientUser.id, amt, `FROM ${user.full_name.toUpperCase()} (${user.phone})`, desc, ref, newRecipientBalance, now());

    db.prepare(`
      INSERT INTO notifications (user_id, message, type, created_at)
      VALUES (?, ?, 'debit', ?)
    `).run(user.id, `You sent $${amt.toLocaleString()} to ${recipientUser.full_name} (${recipientPhone}).`, now());

    db.prepare(`
      INSERT INTO notifications (user_id, message, type, created_at)
      VALUES (?, ?, 'credit', ?)
    `).run(recipientUser.id, `You received $${amt.toLocaleString()} from ${user.full_name} (${user.phone}).`, now());

    db.exec('COMMIT');
    res.json({ message: 'Transfer successful', reference: ref, balance: newBalance });
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Transfer failed. Please try again.' });
  }
});

app.post('/api/withdraw', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { amount, pin } = req.body || {};
  const amt = sanitizeAmount(amount);

  if (amt === null) return res.status(400).json({ error: 'Enter a valid amount' });
  if (!/^\d{4}$/.test(String(pin || ''))) return res.status(400).json({ error: 'Enter your 4-digit transfer pin' });
  if (!bcrypt.compareSync(String(pin), user.transfer_pin)) return res.status(401).json({ error: 'Incorrect transfer pin' });
  if (amt > user.balance) return res.status(400).json({ error: 'Insufficient balance for this withdrawal' });

  const newBalance = Math.round((user.balance - amt) * 100) / 100;
  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, user.id);

  const ref = newReference();
  db.prepare(`
    INSERT INTO transactions (user_id, type, category, amount, counterparty, description, reference, balance_after, created_at)
    VALUES (?, 'debit', 'WITHDRAWAL', ?, 'CASH', 'Cash withdrawal', ?, ?, ?)
  `).run(user.id, amt, ref, newBalance, now());

  db.prepare(`
    INSERT INTO notifications (user_id, message, type, created_at)
    VALUES (?, ?, 'debit', ?)
  `).run(user.id, `You withdrawn $${amt.toLocaleString()} in cash.`, now());

  res.json({ message: 'Withdrawal successful', reference: ref, balance: newBalance });
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
  const phone = cleanPhone(req.query.phone || '');
  if (!/^\d{10,12}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number' });
  const recipient = db.prepare('SELECT full_name, phone, account_number FROM users WHERE phone = ?').get(phone);
  if (!recipient) return res.status(404).json({ error: 'No Chase Bank account found with this phone number' });
  if (recipient.phone === user.phone) return res.status(400).json({ error: 'This is your own phone number' });
  res.json(recipient);
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