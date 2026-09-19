const { JSDOM, VirtualConsole } = require('jsdom');
const BASE = 'http://localhost:3000';

let ok = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { ok++; console.log('  PASS:', name, extra); }
  else { fail++; console.log('  FAIL:', name, extra); }
}

// Cookie-aware fetch so sessions work across requests (like a real browser)
function makeCookieFetch(jar) {
  return (url, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (jar.current) headers['Cookie'] = jar.current;
    const reqUrl = url.startsWith('http') ? url : BASE + url;
    return fetch(reqUrl, { ...opts, headers }).then((res) => {
      const sc = res.headers.get('set-cookie');
      if (sc) jar.current = sc.split(';')[0];
      return res;
    });
  };
}

async function loadApp() {
  let html = await (await fetch(BASE + '/')).text();
  html = html.replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '');
  const jar = { current: '' };
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => console.log('  [jsdomError]', e.message));
  vc.on('error', (...a) => console.log('  [console.error]', a.join(' ')));
  const dom = new JSDOM(html, {
    url: BASE + '/',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = makeCookieFetch(jar);
      window.scrollTo = () => {};
    }
  });
  await new Promise((r) => setTimeout(r, 1500));
  return dom;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('1. Load landing page');
  const dom = await loadApp();
  const doc = dom.window.document;
  check('brand rendered', !!doc.querySelector('.brand'));
  check('hero rendered', !!doc.querySelector('.hero'));
  check('features section', !!doc.querySelectorAll('.feat-card').length);
  check('steps section', !!doc.querySelectorAll('.step').length);
  check('footer with Developed by SANTOS', doc.body.innerHTML.includes('Developed by')) && check('dev-credit SANTOS', !!doc.querySelector('.dev-credit') && doc.querySelector('.dev-credit').textContent === 'SANTOS');
  check('social links present', doc.querySelectorAll('.socials a').length >= 4, 'count=' + doc.querySelectorAll('.socials a').length);

  console.log('2. Navigate to signup via hash');
  dom.window.location.hash = '#/signup';
  await sleep(600);
  check('signup form shown', !!doc.querySelector('#signupForm'));
  check('password eye toggles present', doc.querySelectorAll('[data-eye]').length, 'eyes=' + doc.querySelectorAll('[data-eye]').length);

  console.log('3. Eye toggle on password');
  const eyeBtn = doc.querySelector('[data-eye]');
  const pwInput = eyeBtn.previousElementSibling;
  check('password hidden initially', pwInput.type === 'password');
  eyeBtn.click();
  check('password revealed after toggle', pwInput.type === 'text');
  eyeBtn.click();
  check('password hidden again', pwInput.type === 'password');

  console.log('4. Signup validation (empty submit)');
  const form = doc.querySelector('#signupForm');
  doc.querySelector('#suBtn').click();
  await sleep(200);
  check('validation error shown', doc.querySelector('#signupError').classList.contains('show'));

  console.log('5. Password strength meter');
  const pw = doc.querySelector('#suPassword');
  pw.value = 'StrongPass1!';
  pw.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await sleep(100);
  check('strength indicator updated', doc.querySelector('#suStrength').style.width !== '0%');

  console.log('6. Fill and submit signup (first/last + username + UI OTP)');
  doc.querySelector('#suFirst').value = 'FEMI';
  doc.querySelector('#suLast').value = 'OKOYE';
  doc.querySelector('#suUsername').value = 'femi';
  doc.querySelector('#suEmail').value = 'femi@chasebank.test';
  doc.querySelector('#suPhone').value = '08044445555';
  pw.value = 'chase123';
  doc.querySelector('#suConfirm').value = 'chase123';
  doc.querySelector('#suPin').value = '7788';
  doc.querySelector('#suConfirmPin').value = '7788';
  doc.querySelector('#sendOtpBtn').click();
  await sleep(800);
  const demoCode = doc.querySelector('#demoOtpCode')?.textContent || '';
  check('demo OTP code shown in UI', /^\d{6}$/.test(demoCode), demoCode);
  const otpDigits = doc.querySelectorAll('.otp-digit');
  demoCode.split('').forEach((d, i) => { otpDigits[i].value = d; otpDigits[i].dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  doc.querySelector('#verifyOtpBtn').click();
  await sleep(800);
  check('phone verified line shown', !doc.querySelector('#phoneVerifiedLine').hidden);
  doc.querySelector('#suBtn').click();
  await sleep(1500);
  check('navigated to dashboard after signup', dom.window.location.hash.includes('dashboard'), dom.window.location.hash);
  check('balance card rendered', !!doc.querySelector('.balance-card'));
  check('balance shows 50000', doc.body.innerHTML.includes('$50,000.00'));
  check('transaction list shows welcome bonus', doc.body.innerHTML.includes('WELCOME_BONUS') || doc.body.innerHTML.includes('Chase Bank'));
  check('avatar shows initials', doc.querySelector('.avatar')?.textContent === 'FO');

  // DEBUG: dump actual app state
  {
    const app = doc.querySelector('#app');
    console.log('  [debug] hash =', dom.window.location.hash);
    console.log('  [debug] #app length =', app ? app.innerHTML.length : 'NO #app');
    console.log('  [debug] #app first 200 =', app ? app.innerHTML.slice(0, 200).replace(/\n/g, ' ') : '');
    console.log('  [debug] balance-card occurrences in app =', app ? (app.innerHTML.match(/balance-card/g) || []).length : 0);
    console.log('  [debug] WELCOME_BONUS occurrences =', (doc.body.innerHTML.match(/WELCOME_BONUS/g) || []).length);
    console.log('  [debug] body length =', doc.body.innerHTML.length);
  }

  console.log('7. Balance eye toggle');
  const balToggle = doc.querySelector('#toggleBalance');
  check('balance visible initially', !(doc.querySelector('#balanceAmount').className.includes('blurred')));
  balToggle.click();
  await sleep(50);
  check('balance blurred after toggle', doc.querySelector('#balanceAmount').className.includes('blurred'));
  balToggle.click();
  check('balance visible after toggle back', !(doc.querySelector('#balanceAmount').className.includes('blurred')));

  console.log('8. Quick action + bottom nav on mobile viewport');
  check('quick action Send present', !!doc.querySelector('.qa-send'));
  check('bottom nav exists (responsive)', !!doc.querySelector('.bottom-nav'));

  console.log('9. Navigate to send page');
  dom.window.location.hash = '#/send';
  await sleep(600);
  check('send form shown', !!doc.querySelector('#sendForm'));

  console.log('10. Recipient lookup on send page');
  doc.querySelector('#sendPhone').value = '5200000001';
  doc.querySelector('#sendPhone').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await sleep(800);
  check('recipient card appears', !!doc.querySelector('.recipient-card'), doc.querySelector('.recipient-card')?.textContent || '');

  console.log('11. Fill amount + submit send, opens PIN modal');
  doc.querySelector('#sendAmount').value = '3000';
  doc.querySelector('#sendDesc').value = 'Test transfer';
  doc.querySelector('#sendForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(600);
  check('PIN modal opened', !!doc.querySelector('.modal-overlay'));
  check('PIN boxes count = 4', doc.querySelectorAll('.pin-box').length === 4);

  console.log('12. Type PIN 7788');
  const boxes = doc.querySelectorAll('.pin-box');
  boxes[0].value = '7'; boxes[0].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  boxes[1].value = '7'; boxes[1].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  boxes[2].value = '8'; boxes[2].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  boxes[3].value = '8'; boxes[3].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await sleep(200);
  const confirmBtn = doc.querySelector('#pinConfirm');
  check('confirm enabled with 4 digits', !confirmBtn.disabled);

  console.log('13. Wrong pin first');
  await sleep(300);
  // clear and retry wrong pin
  const errline = doc.querySelector('.form-error.server');
  // wrong pin: re-type 1111
  const b2 = doc.querySelectorAll('.pin-box');
  b2[0].value = '1'; b2[0].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  b2[1].value = '1'; b2[1].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  b2[2].value = '1'; b2[2].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  b2[3].value = '1'; b2[3].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await sleep(200);
  doc.querySelector('#pinConfirm').click();
  await sleep(700);
  check('wrong pin error shown', errline.classList.contains('show'));

  console.log('14. Correct pin: transfer succeeds with animation');
  const b3 = doc.querySelectorAll('.pin-box');
  b3[0].value = '7'; b3[0].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  b3[1].value = '7'; b3[1].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  b3[2].value = '8'; b3[2].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  b3[3].value = '8'; b3[3].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await sleep(200);
  doc.querySelector('#pinConfirm').click();
  await sleep(800);
  check('money animation modal shown', !!doc.querySelector('.plane-scene') || !!doc.querySelector('#successWrap'));

  console.log('15. After animation completes, dashboard shows updated balance');
  await sleep(2200);
  const doneBtn = doc.querySelector('#doneBtn');
  check('done button appears', !!doneBtn);
  doc.querySelector('#doneBtn').click();
  await sleep(900);
  check('navigated back to dashboard', dom.window.location.hash.includes('dashboard'));
  check('balance debited to 47000', doc.body.innerHTML.includes('$47,000.00'));

  console.log('16. Notifications page');
  dom.window.location.hash = '#/notifications';
  await sleep(600);
  check('notifications rendered', doc.querySelectorAll('.notif-item').length >= 1);
  check('unread badge present', doc.querySelectorAll('.notif-item.unread').length >= 1);

  console.log('17. Customer care page');
  dom.window.location.hash = '#/care';
  await sleep(600);
  check('care form shown', !!doc.querySelector('#careForm'));
  doc.querySelector('#careSubject').value = 'Test issue';
  doc.querySelector('#careMessage').value = 'This is a longer test message to satisfy validation.';
  doc.querySelector('#careBtn').click();
  await sleep(500);
  check('care message accepted', !doc.querySelector('#careError').classList.contains('show'));

  console.log('18. Me page');
  dom.window.location.hash = '#/me';
  await sleep(600);
  check('profile rendered', !!doc.querySelector('.profile-hero'));
  check('account number shown', /52\d{8}/.test(doc.body.innerHTML));
  check('username shown', doc.body.innerHTML.includes('@femi'));
  check('logout button present', !!doc.querySelector('#logoutBtn'));

  console.log('18b. Copy account number');
  const copyBtns = doc.querySelectorAll('.copy-btn');
  check('copy button rendered', copyBtns.length >= 1, 'n=' + copyBtns.length);
  let copied = null;
  doc.defaultView.document.execCommand = (cmd) => {
    if (cmd === 'copy') { const ta = doc.querySelector('textarea'); copied = ta ? ta.value : null; return true; }
    return false;
  };
  copyBtns[0].click();
  await sleep(150);
  check('click copies account number to clipboard', /^52\d{8}$/.test(copied || ''), String(copied));
  check('copy success toast shown', doc.body.innerHTML.includes('copied'));

  console.log('19. Login flow');
  doc.querySelector('#logoutBtn').click();
  await sleep(500);
  doc.querySelector('#logoutConfirm')?.click();
  await sleep(700);
  check('redirected to landing after logout', !dom.window.location.hash.includes('me') || !doc.querySelector('.profile-hero'));
  dom.window.location.hash = '#/login';
  await sleep(600);
  check('login form shown', !!doc.querySelector('#loginForm'));
  doc.querySelector('#loginIdentifier').value = 'femi';
  doc.querySelector('#loginPassword').value = 'chase123';
  doc.querySelector('#loginBtn').click();
  await sleep(1200);
  check('login navigates to dashboard', dom.window.location.hash.includes('dashboard'));

  console.log('20. Withdraw flow');
  dom.window.location.hash = '#/withdraw';
  await sleep(600);
  check('withdraw form shown', !!doc.querySelector('#withdrawForm'));
  doc.querySelector('#wdAmount').value = '2000';
  doc.querySelector('#withdrawForm').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(600);
  check('withdraw PIN modal opened', !!doc.querySelector('.modal-overlay'));
  const wb = doc.querySelectorAll('.pin-box');
  wb[0].value = '7'; wb[0].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  wb[1].value = '7'; wb[1].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  wb[2].value = '8'; wb[2].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  wb[3].value = '8'; wb[3].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await sleep(200);
  doc.querySelector('#pinConfirm').click();
  await sleep(800);
  check('withdraw animation shown', !!doc.querySelector('#successWrap') || !!doc.querySelector('.plane-scene'));
  await sleep(2300);
  doc.querySelector('#doneBtn')?.click();
  await sleep(900);
  check('balance after withdraw = 45000', doc.body.innerHTML.includes('$45,000.00'));

  console.log('');
  console.log(`FRONTEND RESULT: ${ok} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH:', e.message); process.exit(1); });