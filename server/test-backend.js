const BASE = 'http://localhost:3000';
let okCount = 0, failCount = 0;

const santos = { cookie: null };

function req(path, opts = {}, who = santos) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (who.cookie) headers['Cookie'] = who.cookie;
  return fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
    .then(async (r) => {
      const setCookie = r.headers.get('set-cookie');
      if (setCookie) who.cookie = setCookie.split(';')[0];
      let data = null;
      try { data = await r.json(); } catch (e) { data = await r.text(); }
      return { status: r.status, data };
    });
}

function check(name, cond, extra = '') {
  if (cond) { okCount++; console.log('  PASS:', name, extra); }
  else { failCount++; console.log('  FAIL:', name, extra); }
}

(async () => {
  console.log('0. OTP required for signup');
  let r = await req('/api/auth/register', {
    method: 'POST',
    body: { first_name: 'No', last_name: 'Otp', username: 'no_otp', email: 'no-otp@chasebank.test', phone: '08066666666', password: 'secret123', confirm_password: 'secret123', transfer_pin: '1111', confirm_transfer_pin: '1111' }
  });
  check('register without OTP rejected', r.status === 400 && /OTP/.test(r.data.error), JSON.stringify(r.data));
  r = await req('/api/auth/send-otp', { method: 'POST', body: { phone: '123' } });
  check('send-otp bad phone rejected', r.status === 400);
  r = await req('/api/auth/send-otp', { method: 'POST', body: { phone: '08012345678' } });
  check('send-otp delivers 6-digit demo code', r.status === 200 && /^\d{6}$/.test(r.data.demo_otp) && /SMS/.test(r.data.delivery), JSON.stringify(r.data));
  const santosOtp = r.data.demo_otp;
  r = await req('/api/auth/verify-otp', { method: 'POST', body: { phone: '08012345678', otp: '000000' } });
  check('wrong OTP rejected', r.status === 400 && /Incorrect/.test(r.data.error));
  r = await req('/api/auth/verify-otp', { method: 'POST', body: { phone: '08012345678', otp: '12' } });
  check('malformed OTP rejected', r.status === 400);
  r = await req('/api/auth/verify-otp', { method: 'POST', body: { phone: '08012345678', otp: santosOtp } });
  check('correct OTP verified', r.status === 200 && r.data.verified === true);

  console.log('1. Register SANTOS (first/last + username, issued 52 account)');
  r = await req('/api/auth/register', {
    method: 'POST',
    body: { first_name: 'SANTOS', last_name: 'AKPAN', username: 'santos', email: 'santos@chasebank.test', phone: '08012345678', password: 'secret123', confirm_password: 'secret123', transfer_pin: '4321', confirm_transfer_pin: '4321' }
  });
  check('register', r.status === 201, JSON.stringify(r.data));
  check('account number issued, starts with 52', r.status === 201 && /^52\d{8}$/.test(r.data.account_number), r.data.account_number);
  const santosAccount = r.data.account_number;

  console.log('2. Demo entity TUNDE exists (seeded with 52 account + username)');
  const tunde = { cookie: null };
  r = await req('/api/auth/login', { method: 'POST', body: { identifier: 'tunde', password: 'pass4567' } }, tunde);
  check('login demo TUNDE by username', r.status === 200 && r.data.account_number === '5200000001', JSON.stringify(r.data));

  console.log('2.5 OTP for existing number rejected');
  r = await req('/api/auth/send-otp', { method: 'POST', body: { phone: '08012345678' } });
  check('send-otp existing account 409', r.status === 409);

  console.log('3. SANTOS account');
  await req('/api/auth/login', { method: 'POST', body: { identifier: 'santos', password: 'secret123' } }, santos);
  r = await req('/api/account', {}, santos);
  check('balance = 50000 welcome bonus', r.status === 200 && r.data.balance === 50000, 'balance=' + r.data.balance);
  check('username on account', r.data.username === 'santos');
  check('phone != account number', r.data.phone !== r.data.account_number);
  check('account number matches issued', r.data.account_number === santosAccount);

  console.log('4. Validation checks');
  r = await req('/api/auth/register', { method: 'POST', body: { first_name: 'x', last_name: 'Y', username: 'bad1', email: 'x@y.z', phone: '08055555555', password: 'aaaaaa', confirm_password: 'aaaaaa', transfer_pin: '2222', confirm_transfer_pin: '2222' } });
  check('short name rejected', r.status === 400);
  r = await req('/api/auth/register', { method: 'POST', body: { first_name: 'Mismatch', last_name: 'Test', username: 'mismatch', email: 'mismatch@chasebank.test', phone: '08099999999', password: 'secret123', confirm_password: 'wrong123', transfer_pin: '4321', confirm_transfer_pin: '4321' } });
  check('password mismatch rejected', r.status === 400 && /do not match/.test(r.data.error));
  r = await req('/api/auth/register', { method: 'POST', body: { first_name: 'Bad', last_name: 'Pin', username: 'bad_pin', email: 'bad@chasebank.test', phone: '08088888888', password: 'secret123', confirm_password: 'secret123', transfer_pin: '43', confirm_transfer_pin: '43' } });
  check('bad pin rejected', r.status === 400, String(r.data.error));
  r = await req('/api/auth/register', { method: 'POST', body: { first_name: 'Twins', last_name: 'User', username: 'santos', email: 'new@chasebank.test', phone: '08077777777', password: 'secret123', confirm_password: 'secret123', transfer_pin: '4321', confirm_transfer_pin: '4321' } });
  check('duplicate username rejected', r.status === 409, String(r.data.error));
  check('tells user to change username', r.status === 409 && /choose a different username to continue/i.test(r.data.error), r.data.error);
  r = await req('/api/auth/register', { method: 'POST', body: { first_name: 'Dup', last_name: 'Mail', username: 'dup_mail', email: 'santos@chasebank.test', phone: '08011111111', password: 'secret123', confirm_password: 'secret123', transfer_pin: '4321', confirm_transfer_pin: '4321' } });
  check('duplicate email rejected', r.status === 409);

  console.log('5. Transfer to TUNDE by account number');
  r = await req('/api/transfer', { method: 'POST', body: { recipient: '5200000001', amount: 2500, pin: '4321', description: 'Lunch money' } }, santos);
  check('transfer success', r.status === 200, JSON.stringify(r.data));
  check('new balance returned', r.data.balance === 47500);

  r = await req('/api/account', {}, santos);
  check('balance debited to 47500', r.status === 200 && r.data.balance === 47500, 'balance=' + r.data.balance);

  console.log('6. TUNDE received credit');
  r = await req('/api/account', {}, tunde);
  check('tunde balance = 55000 (52500 seeded + 2500)', r.status === 200 && r.data.balance === 55000, 'balance=' + r.data.balance + ' status=' + r.status);

  console.log('7. Wrong pin');
  r = await req('/api/transfer', { method: 'POST', body: { recipient: '5200000001', amount: 100, pin: '0000' } }, santos);
  check('wrong pin rejected', r.status === 401);

  console.log('8. Self transfer blocked');
  r = await req('/api/transfer', { method: 'POST', body: { recipient: santosAccount, amount: 100, pin: '4321' } }, santos);
  check('self transfer rejected', r.status === 400);

  console.log('9. Insufficient funds');
  r = await req('/api/withdraw', { method: 'POST', body: { amount: 999999, pin: '4321' } }, santos);
  check('insufficient rejected', r.status === 400);

  console.log('10. Withdraw');
  r = await req('/api/withdraw', { method: 'POST', body: { amount: 5000, pin: '4321' } }, santos);
  check('withdraw success', r.status === 200, JSON.stringify(r.data));

  r = await req('/api/account', {}, santos);
  check('balance = 42500', r.status === 200 && r.data.balance === 42500, 'balance=' + r.data.balance);

  console.log('11. Transactions');
  r = await req('/api/transactions', {}, santos);
  check('has 3 transactions', r.status === 200 && r.data.length === 3, 'count=' + r.data.length);
  check('latest is withdrawal', r.data[0].category === 'WITHDRAWAL');
  check('transfer entry exists', r.data.some(t => t.category === 'TRANSFER' && t.type === 'debit' && t.amount === 2500));

  console.log('12. Notifications');
  r = await req('/api/notifications', {}, santos);
  check('notifications exist', r.status === 200 && r.data.unread >= 2, 'unread=' + r.data.unread);

  console.log('13. Recipient lookup by account number');
  r = await req('/api/pay/recipient?account=5200000001', {}, santos);
  check('recipient found', r.status === 200 && r.data.full_name === 'TUNDE BALOGUN' && r.data.account_number === '5200000001');
  r = await req('/api/pay/recipient?account=5299999999', {}, santos);
  check('unknown recipient 404', r.status === 404);
  r = await req('/api/pay/recipient?account=' + santosAccount, {}, santos);
  check('own account rejected', r.status === 400);

  console.log('14. Customer care');
  r = await req('/api/customer-care', { method: 'POST', body: { subject: 'Card issue', message: 'My card got blocked, please help me unblock it.' } }, santos);
  check('customer care', r.status === 201);
  r = await req('/api/customer-care', { method: 'POST', body: { subject: 'hi', message: 'short' } }, santos);
  check('short message rejected', r.status === 400);

  console.log('15. Logout + me 401');
  await req('/api/auth/logout', { method: 'POST' }, santos);
  r = await req('/api/auth/me', {}, santos);
  check('me returns 401 after logout', r.status === 401);

  console.log('16. Login wrong password / by phone / by username');
  r = await req('/api/auth/login', { method: 'POST', body: { identifier: 'santos', password: 'wrongpass' } }, santos);
  check('wrong password rejected', r.status === 401);
  r = await req('/api/auth/login', { method: 'POST', body: { identifier: '08012345678', password: 'secret123' } }, santos);
  check('login by phone', r.status === 200);
  r = await req('/api/auth/login', { method: 'POST', body: { identifier: 'santos', password: 'secret123' } }, santos);
  check('login by username', r.status === 200);

  console.log('');
  console.log(`RESULT: ${okCount} passed, ${failCount} failed`);
  process.exit(failCount > 0 ? 1 : 0);
})();