// CHASE BANK ??? End-to-end browser test (headless Chrome)
// Usage: 1) server must be running 2) DB should be fresh -> "node server/test-e2e.js"
const puppeteer = require('puppeteer-core');
const { totpAt, currentCounter } = require('./totp');

const BASE = 'http://localhost:3000';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  PASS:', name, extra); }
  else { fail++; console.log('  FAIL:', name, extra); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Verify server + ensure second user (TUNDE) exists for transfers
  const post = (path, body) => fetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  let tu = await post('/api/auth/send-otp', { phone: '07011112222' });
  if (tu.status === 200) {
    await post('/api/auth/verify-otp', { phone: '07011112222', otp: tu.data.demo_otp });
  }
const reg = await post('/api/auth/register', {
    first_name: 'TUNDE', last_name: 'BALOGUN', username: 'tunde', email: 'tunde@chasebank.test', phone: '07011112222', password: 'pass4567', confirm_password: 'pass4567', transfer_pin: '1111', confirm_transfer_pin: '1111'
  }).then((r) => r.status);
  console.log('TUNDE register status:', reg, reg === 409 ? '(already exists ??? ok)' : '');

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1366, height: 900 }, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  // Grant geolocation so the transfer location gate resolves (simulates "location ON")
  try {
    const bcdp = await browser.target().createCDPSession();
    await bcdp.send('Browser.grantPermissions', { origin: BASE, permissions: ['geolocation', 'clipboardReadWrite'] });
  } catch (e) { console.log('  [warn] grantPermissions:', e.message); }
  const page = await browser.newPage();
  try {
    const pcdp = await page.createCDPSession();
    await pcdp.send('Emulation.setGeolocationOverride', { latitude: 6.5244, longitude: 3.3792, accuracy: 25 });
  } catch (e) { console.log('  [warn] setGeolocation:', e.message); }
  page.setDefaultNavigationTimeout(40000);
  page.setDefaultTimeout(20000);
const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      if (/Failed to load resource:.*status of (400|401|404|409)/.test(t)) return;
      errors.push('console: ' + t);
    }
  });

  const wait = (sel, opts = {}) => page.waitForSelector(sel, { visible: true, timeout: 12000, ...opts });
  const waitGone = (sel) => page.waitForSelector(sel, { hidden: true, timeout: 12000 });
  const txt = (sel) => page.$eval(sel, (el) => el.textContent).catch(() => '');
  const bodyText = () => page.evaluate(() => document.body.innerText);
  const setVal = async (sel, val) => {
    await page.$eval(sel, (el, v) => {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, val);
  };

  console.log('1. Landing page');
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await wait('.hero');
  check('brand visible', await page.$('.brand') !== null);
  check('hero headline', (await txt('h1')).includes('Banking that moves'));
  check('footer has Developed by SANTOS', /Developed by SANTOS/.test(await txt('.footer-bottom')));
  check('social links', (await page.$$('.footer .socials a')).length >= 4);

  console.log('2. Open account via hero CTA');
  await page.click('.hero-cta .btn-primary');
  await wait('#signupForm');
  check('signup form shown', true);

  console.log('3. Password eye toggles on signup');
  const eyes = await page.$$('[data-eye]');
  check('4 eye buttons (pw, confirm, pin, confirm pin)', eyes.length === 4);
  await page.type('#suPassword', 'superSecret');
  const pwType = await page.$eval('#suPassword', (el) => el.type);
  check('password masked initially', pwType === 'password');
  await page.click('#suPassword + .eye-btn');
  const pwType2 = await page.$eval('#suPassword', (el) => el.type);
  check('password revealed on eye click', pwType2 === 'text');
  await page.click('#suPassword + .eye-btn');
  check('password masked again', (await page.$eval('#suPassword', (el) => el.type)) === 'password');

  console.log('4. Signup validation');
  await page.click('#suBtn');
  await wait('#signupError.show');
check('empty submit shows error', /first name/i.test(await txt('#signupError')));

  console.log('5. Phone OTP verification + signup');
  await setVal('#suFirst', 'UGO');
  await setVal('#suLast', 'EMEKA');
  await setVal('#suUsername', 'ugo');
  await setVal('#suEmail', 'ugo@chasebank.test');
  await setVal('#suPhone', '08033334444');
  await setVal('#suPassword', 'chase123');
  await setVal('#suConfirm', 'chase123');
  await setVal('#suPin', '2468');
  await setVal('#suConfirmPin', '2468');

  // submitting before OTP is blocked
  await page.click('#suBtn');
  await wait('#signupError.show');
  check('submit without OTP blocked', /OTP first/i.test(await txt('#signupError')));

  // send code
  await page.click('#sendOtpBtn');
  await wait('#otpBox');
  check('OTP box appears after send', await page.$('#otpBox') !== null);
  check('demo OTP shown in demo note', /^\d{6}$/.test((await txt('#demoOtpCode')).trim()));
  const demoOtp = (await txt('#demoOtpCode')).trim();

  // wrong code rejected
  for (let i = 0; i < 6; i++) await page.type('.otp-digit:nth-child(' + (i + 1) + ')', '0');
  await page.click('#verifyOtpBtn');
  await wait('#otpError.show');
  check('wrong OTP rejected', /Incorrect code/i.test(await txt('#otpError')));

  // correct code verifies
  for (let i = 0; i < 6; i++) {
    await page.$eval('.otp-digit:nth-child(' + (i + 1) + ')', (el, v) => { el.value = v; }, demoOtp[i]);
  }
  await page.click('#verifyOtpBtn');
  await wait('#phoneVerifiedLine');
  check('phone verified indicator shown', await page.$('#phoneVerifiedLine') !== null);
  check('phone locked after verify', (await page.$eval('#suPhone', (el) => el.disabled)) === true);

  await page.click('#suBtn');
  try {
    await wait('.balance-card', { timeout: 20000 });
  } catch (e) {
    console.log('  [debug] URL:', page.url());
    console.log('  [debug] signupError:', await txt('#signupError'));
    console.log('  [debug] toasts:', await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent.trim()).join(' | ')));
    console.log('  [debug] still on signup:', await page.$('#signupForm') !== null);
    console.log('  [debug] body snippet:', (await page.$eval('body', el => el.innerText.slice(0, 200))).replace(/\n/g, ' | '));
    throw e;
  }
check('landed on dashboard', page.url().includes('dashboard'));
  check('welcome bonus balance $50,000.00', (await txt('.amount')).includes('50,000.00'));
  check('copy button on balance card', (await page.$$('.balance-card .copy-btn')).length >= 1);

  console.log('6. Transaction history + welcome bonus');
  const txText = await txt('.tx-list');
  check('recent transactions list', await page.$('.tx-item') !== null);
  check('welcome bonus entry', /WELCOME_BONUS|Chase Bank/i.test(txText));

  console.log('7. Balance eye toggle');
  const before = await page.$eval('#balanceAmount', (el) => el.className);
  check('balance visible initially', !before.includes('blurred'));
  await page.click('#toggleBalance');
  const after = await page.$eval('#balanceAmount', (el) => el.className);
  check('balance blurred/hidden after toggle', after.includes('blurred'));
  await page.click('#toggleBalance');
  check('balance restored', !(await page.$eval('#balanceAmount', (el) => el.className)).includes('blurred'));

  console.log('8. Quick action icons present');
  for (const sel of ['.qa-send', '.qa-withdraw', '.qa-care', '.qa-me']) {
    check('quick action: ' + sel, await page.$(sel) !== null);
  }

  console.log('9. Send money flow');
  await page.goto(BASE + '/#/send', { waitUntil: 'networkidle2' });
  await wait('#sendForm');
  await setVal('#sendPhone', '5200000001');
  await wait('.recipient-card', { timeout: 15000 });
  check('recipient card appears (TUNDE)', (await txt('.recipient-card')).includes('TUNDE'));
  await setVal('#sendAmount', '2500');
  await setVal('#sendDesc', 'Lunch money');
  await page.click('#sendBtn');
  await wait('.modal-overlay');
  check('PIN modal opened', true);
  check('4 PIN boxes', (await page.$$('.pin-box')).length === 4);

  console.log('9b. No location gate — PIN entry is available immediately');
  check('no location gate shown', await page.$('#locGate') === null);
  check('PIN boxes enabled immediately', (await page.$$eval('.pin-box', (els) => els.every((b) => !b.disabled))) === true);
  check('confirm disabled until 4 digits', await page.$eval('#pinConfirm', (el) => el.disabled) === true);

  console.log('10. Wrong pin rejected');
  await page.type('.pin-box:nth-child(1)', '1');
  await page.type('.pin-box:nth-child(2)', '1');
  await page.type('.pin-box:nth-child(3)', '1');
  await page.type('.pin-box:nth-child(4)', '1');
  await sleep(100);
  await page.click('#pinConfirm');
  await wait('.form-error.server.show');
  check('wrong pin error shown', /Incorrect transfer pin/i.test(await txt('.form-error.server')));

  console.log('11. Correct pin -> money animation');
  const pBoxes = await page.$$('.pin-box');
  for (const [i, v] of [[0, '2'], [1, '4'], [2, '6'], [3, '8']]) {
    await page.type('.pin-box:nth-child(' + (i + 1) + ')', v);
  }
  await sleep(100);
  await page.click('#pinConfirm');
  try {
    await wait('.plane-scene', { timeout: 20000 });
  } catch (e) {
    console.log('  [debug] overlays on page:', await page.evaluate(() => [...document.querySelectorAll('.modal-overlay')].map(o => o.id + (o.innerHTML.slice(0, 80))).join(' || ')));
    console.log('  [debug] toasts:', await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent.trim()).join(' | ')));
    console.log('  [debug] body snippet:', (await page.$eval('body', el => el.innerText.slice(0, 300))).replace(/\n/g, ' | '));
    throw e;
  }
  check('paper-plane animation played', true);
  await wait('#doneBtn', { timeout: 15000 });
  check('success check shown', await page.$('.success-ring') !== null);
  check('success message', /Transfer Successful/i.test(await txt('.modal-title')));
  await page.click('#doneBtn');
  await wait('.balance-card');
  check('balance debited to $47,500.00', (await txt('.amount')).includes('47,500.00'));

  console.log('12. Withdraw flow');
  await page.goto(BASE + '/#/withdraw', { waitUntil: 'networkidle2' });
  await wait('#withdrawForm');
  await page.click('#wdQuick [data-quick="5000"]');
  check('quick amount filled', (await page.$eval('#wdAmount', (el) => el.value)) === '5000');
await page.click('#wdBtn');
  await wait('.modal-overlay');
  check('no location gate on withdraw either', await page.$('#locCheck') === null);
  for (const [i, v] of [[0, '2'], [1, '4'], [2, '6'], [3, '8']]) {
    await page.type('.pin-box:nth-child(' + (i + 1) + ')', v);
  }
  await sleep(100);
  await page.click('#pinConfirm');
  await wait('.plane-scene');
  await wait('#doneBtn', { timeout: 15000 });
  check('withdrawal success', /Withdrawal Successful/i.test(await txt('.modal-title')));
  await page.click('#doneBtn');
  await wait('.balance-card');
  check('balance after withdraw $42,500.00', (await txt('.amount')).includes('42,500.00'));

  console.log('13. Notifications');
  await page.goto(BASE + '/#/notifications', { waitUntil: 'networkidle2' });
  await wait('.notif-item');
  const notifs = await page.$$('.notif-item');
  check('at least 3 notifications', notifs.length >= 3);
  check('unread markers present', (await page.$$('.notif-item.unread')).length >= 1);
if (await page.$('#readAllBtn')) {
    await page.click('#readAllBtn');
    await page.waitForFunction(() => document.querySelectorAll('.notif-item.unread').length === 0, { timeout: 8000, polling: 100 }).catch(() => {});
    check('mark all read works', (await page.$$('.notif-item.unread')).length === 0);
  }

  console.log('14. Customer care');
  await page.goto(BASE + '/#/care', { waitUntil: 'networkidle2' });
  await wait('#careForm');
  await setVal('#careSubject', 'Card issue');
  await setVal('#careMessage', 'My card got blocked and I need it unblocked as soon as possible please.');
  await page.click('#careBtn');
  await wait('.toast.success');
  check('care message submitted', /respond within 24 hours/i.test(await bodyText()));
  check('care contact cards (call/email/social)', (await page.$$('.care-card')).length >= 3);

  console.log('15. Profile page');
  await page.goto(BASE + '/#/me', { waitUntil: 'networkidle2' });
  await wait('.profile-hero');
check('name shown', (await txt('.profile-hero h2')).includes('EMEKA'));
  check('username shown', /@ugo/.test(await txt('body')));
  check('account number starts with 52', /52\d{8}/.test(await txt('body')));
  check('logout button', await page.$('#logoutBtn') !== null);

console.log('15b. Copy account number');
  await page.click('.profile-field .copy-btn');
  await sleep(500);
  const clip = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return null; } });
  check('clipboard holds account number', /^52\d{8}$/.test(clip || ''), String(clip));
  check('copy success toast shown', /copied/i.test(await bodyText()));

  console.log('16. Logout & login');
  await page.click('#logoutBtn');
  await wait('.modal-overlay');
  await page.waitForFunction(() => [...document.querySelectorAll('.modal')].some(m => /Are you sure you want to log out/i.test(m.textContent || '')), { timeout: 12000 });
  check('logout confirmation prompt shown', /Are you sure you want to log out/i.test(await txt('.modal-desc')));
  await page.click('#logoutCancel');
  await waitGone('.modal-overlay');
  check('cancel keeps you logged in', (await page.$('.profile-hero')) !== null);
  await page.click('#logoutBtn');
  await wait('.modal-overlay');
  await page.click('#logoutConfirm');
  await page.waitForFunction(() => location.hash === '' || location.hash === '#/', { timeout: 8000 });
  check('logout completes after confirm', true);
  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle2' });
  await wait('#loginForm');
  // eye toggle on login too
  await page.type('#loginPassword', 'hunter2');
  check('login password masked', (await page.$eval('#loginPassword', (el) => el.type)) === 'password');
  await page.click('#loginPassword + .eye-btn');
  check('login password revealed', (await page.$eval('#loginPassword', (el) => el.type)) === 'text');
  // wrong creds
await setVal('#loginIdentifier', '08033334444');
  await page.click('#loginPassword + .eye-btn');
  await setVal('#loginPassword', 'wrongpass');
  await page.click('#loginBtn');
  await wait('#loginError.show');
  check('wrong password rejected', /Incorrect password/i.test(await txt('#loginError')));
  // correct creds (by username)
  await page.click('#loginPassword + .eye-btn');
  await setVal('#loginPassword', 'chase123');
  await setVal('#loginIdentifier', 'ugo');
  await page.click('#loginBtn');
  await wait('.balance-card', { timeout: 20000 });
  await waitGone('.toast-stack .toast'); // wait for the "welcome back" toast to clear so it can't intercept the topbar icon
  check('re-login succeeds', page.url().includes('dashboard'));

  console.log('17. Topbar logout icon + confirmation');
  check('logout icon in topbar', await page.$('#logoutIcon') !== null);
await page.click('#logoutIcon');
  await wait('.modal-overlay');
  await page.waitForFunction(() => [...document.querySelectorAll('.modal')].some(m => /Are you sure you want to log out/i.test(m.textContent || '')), { timeout: 12000 });
  check('logout icon opens confirmation', /Are you sure you want to log out/i.test(await txt('.modal-desc')));
  await page.click('#logoutCancel');
  await waitGone('.modal-overlay');
  check('cancel stays signed in', (await page.$('#logoutIcon')) !== null);
  await page.click('#logoutIcon');
  await wait('.modal-overlay');
  await page.click('#logoutConfirm');
  await page.waitForFunction(() => location.hash === '' || location.hash === '#/', { timeout: 8000 });
  check('topbar logout signs out', (await page.$('#logoutIcon')) === null && /AMERICA'S TRUSTED DIGITAL BANK/i.test(await bodyText()));
  // re-login for the remaining authed steps
  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle2' });
  await wait('#loginForm');
await setVal('#loginIdentifier', '08033334444');
  await setVal('#loginPassword', 'chase123');
  await page.click('#loginBtn');
  await wait('.balance-card', { timeout: 20000 });

  console.log('18. Full history page');
  await page.goto(BASE + '/#/history', { waitUntil: 'networkidle2' });
  await wait('.tx-item');
  check('history has entries', (await page.$$('.tx-item')).length >= 3);
  check('each row has a receipt button', (await page.$$('.tx-item .tx-receipt')).length >= 3);

  console.log('19. Receipts: modal + image + PDF download');
  const client = await page.createCDPSession();
  await client.send('Page.enable');
  const dlRecs = new Map();
  client.on('Page.downloadWillBegin', (p) => {
    dlRecs.set(p.guid, { filename: p.suggestedFilename, url: p.url, bytes: null });
  });
  const sniffDownload = async (ext, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const rec = [...dlRecs.values()].find((d) => d.filename.endsWith(ext) && !d.bytes);
      if (rec && rec.url) {
        try {
          rec.bytes = Buffer.from(await page.evaluate(async (u) => {
            const r = await fetch(u);
            const ab = await r.arrayBuffer();
            return Array.from(new Uint8Array(ab));
          }, rec.url));
        } catch (e) { /* retry */ }
      }
      const done = [...dlRecs.values()].find((d) => d.filename.endsWith(ext) && d.bytes && d.bytes.length);
      if (done) return done.bytes;
      await sleep(200);
    }
    return null;
  };
  await page.$eval('.tx-item .tx-receipt', (el) => el.click());
  await wait('.modal-receipt');
  check('receipt modal opens', await page.$('.modal-receipt') !== null);
  check('receipt modal shows amount', /\$[\d,]+\.\d{2}/.test(await txt('.rc-amount')));
  check('receipt shows reference + counterparty', /Reference/i.test(await txt('.rc-body')) && /Counterparty/i.test(await txt('.rc-body')));
  await page.click('#rcPng');
  const pngBytes = await sniffDownload('png');
  check('receipt PNG downloaded', !!pngBytes);
  if (pngBytes) check('PNG header valid', pngBytes[0] === 0x89 && pngBytes[1] === 0x50 && pngBytes[2] === 0x4E && pngBytes[3] === 0x47 && pngBytes.length > 1000);
  await page.click('#rcPdf');
  const pdfBytes = await sniffDownload('pdf');
  check('receipt PDF downloaded', !!pdfBytes);
  if (pdfBytes) {
    const s = pdfBytes.toString('latin1');
    check('PDF header + trailer valid', s.startsWith('%PDF') && s.includes('%%EOF') && s.includes('Chase Bank'));
  }
await page.click('#rcClose');
  await waitGone('.modal-receipt');
  check('receipt modal closes', true);

  console.log('19. Two-factor authentication (authenticator)');
  await page.goto(BASE + '/#/me', { waitUntil: 'networkidle2' });
  await wait('.profile-hero');
  await wait('#setup2faBtn');
  check('2FA: turn-on button on profile', true);
  await page.click('#setup2faBtn');
  await wait('#twofaQr');
  check('2FA: setup modal opens with QR', await page.$('#twofaQr') !== null);
  const secretUgo = (await txt('#twofaSecret')).trim();
  check('2FA: base32 secret displayed', /^[A-Z2-7]{32}$/.test(secretUgo));
  check('2FA: QR is a PNG data URL', (await page.$eval('#twofaQr', (el) => el.src)).startsWith('data:image/png;base64,'));
  await setVal('#setup2faCode', '000000');
  await page.click('#setup2faEnable');
  await wait('#setup2faError.show');
  check('2FA: wrong code rejected in UI', /Incorrect code/i.test(await txt('#setup2faError')));
  const codeUgo = () => totpAt(secretUgo, currentCounter());
  await setVal('#setup2faCode', codeUgo());
  await page.click('#setup2faEnable');
  await wait('#bcDone', { timeout: 15000 });
  const codesShown = await page.$$eval('.backup-codes code', (els) => els.map((e) => e.textContent.trim()));
  check('2FA: 10 backup codes shown', codesShown.length === 10);
  check('2FA: backup code format valid', codesShown.every((c) => /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)));
  await page.click('#bcDone');
  await waitGone('.modal-overlay');
  await wait('#viewBackupBtn');
  check('2FA: profile reflects enabled state', await page.$('#disable2faBtn') !== null);

  console.log('20. Dashboard banner absent + two-step login');
  await page.goto(BASE + '/#/dashboard', { waitUntil: 'networkidle2' });
  await wait('.balance-card');
  check('2FA: advice banner hidden once enabled', await page.$('.banner-2fa') === null);
  await page.click('#logoutIcon');
  await wait('.modal-overlay');
  await page.click('#logoutConfirm');
  await page.waitForFunction(() => location.hash === '' || location.hash === '#/', { timeout: 8000 });
  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle2' });
  await wait('#loginForm');
  await setVal('#loginIdentifier', 'ugo');
  await setVal('#loginPassword', 'chase123');
  await page.click('#loginBtn');
  await wait('#twofaCode');
  check('2FA: two-step login hides password form', (await page.$eval('#loginForm', (el) => el.hidden)) === true);
  await page.click('#twofaBack');
  await waitGone('#twofaStep');
  check('2FA: back link returns to password login', true);
  await setVal('#loginIdentifier', 'ugo');
  await setVal('#loginPassword', 'chase123');
  await page.click('#loginBtn');
  await wait('#twofaStep');
  await setVal('#twofaCode', codeUgo());
  await page.click('#twofaBtn');
  await wait('.balance-card', { timeout: 20000 });
  check('2FA: login with authenticator code succeeds', page.url().includes('dashboard'));

  console.log('');
  console.log('Page errors captured:', errors.length ? errors : 'none');
  console.log(`E2E RESULT: ${ok} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail > 0 || errors.length > 0 ? 1 : 0);
})().catch((e) => { console.error('E2E CRASH:', e.message); process.exit(1); });
