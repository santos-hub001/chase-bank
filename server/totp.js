const crypto = require('node:crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 0xff); }
  }
  return Buffer.from(out);
}

// RFC 6238 — HMAC-SHA1, 30s period, 6 digits.
function totpAt(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter), 0);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(bin % 1000000).padStart(6, '0');
}

function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function currentCounter(step = 30) {
  return Math.floor(Date.now() / 1000 / step);
}

function verifyTotp(secret, code, window = 1, step = 30) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const base = currentCounter(step);
  for (let i = -window; i <= window; i++) {
    const cur = totpAt(secret, base + i);
    if (crypto.timingSafeEqual(Buffer.from(cur), Buffer.from(c))) return true;
  }
  return false;
}

function otpauthUrl(secret, accountName, issuer = 'Chase Bank') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// Backup codes: 3 groups of 4 unambiguous chars (no 0/O/1/I).
function newBackupCodes(count = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes = [];
  for (let i = 0; i < count; i++) {
    let s = '';
    for (let k = 0; k < 12; k++) s += chars[crypto.randomInt(0, chars.length)];
    codes.push(`${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`);
  }
  return codes;
}

function hashBackupCode(secret, code) {
  return crypto.createHash('sha256').update(`${secret}:${String(code).toUpperCase().replace(/[^A-Z0-9-]/g, '')}`).digest('hex');
}

module.exports = { generateSecret, verifyTotp, totpAt, currentCounter, otpauthUrl, newBackupCodes, hashBackupCode, base32Encode };