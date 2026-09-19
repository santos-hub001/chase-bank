// CHASE BANK — Application core (SPA router + views)
// Developed by SANTOS

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const State = {
  user: null,
  balanceHidden: false,
  unread: 0,
  txs: []
};
let otpCountdownTimer = null;

/* ---------------- Theme (dark / light) ---------------- */
const Theme = {
  KEY: 'chase-theme',
  get() {
    const saved = localStorage.getItem(this.KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },
  apply() {
    document.documentElement.setAttribute('data-theme', this.get());
    this.syncToggle();
  },
  toggle() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem(this.KEY, next);
    document.documentElement.setAttribute('data-theme', next);
    this.syncToggle();
  },
  isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  },
  syncToggle() {
    $$('.theme-toggle .t-icon').forEach((el) => { el.innerHTML = this.isDark() ? Icons.sun : Icons.moon; });
  }
};

const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtShortMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US');

function fmtDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400 && now.getDate() === d.getDate()) return 'Today, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 172800) return 'Yesterday, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const initials = (name) => (name || 'U')
  .split(' ')
  .filter(Boolean)
  .slice(0, 2)
  .map((w) => w[0].toUpperCase())
  .join('');

function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/* ---------------- Avatar ---------------- */
function avatarContent(user) {
  if (user && user.avatar) return `<img src="${user.avatar}" alt="${escapeAttr(user.full_name || 'User')}">`;
  return initials(user && user.full_name);
}

/* ---------------- Multiple accounts ---------------- */
function maskAccount(num) {
  const s = String(num || '');
  return s.length > 8 ? s.slice(0, 4) + ' •••• ' + s.slice(-4) : s;
}

function accountRow(a, i) {
  return `
  <div class="account-row" style="animation:fadeSlide .35s ease both; animation-delay:${i * 60}ms">
    <div class="acc-ic">${a.is_default ? Icons.star : Icons.wallet}</div>
    <div class="acc-meta">
      <div class="acc-name">${escapeXml(a.label)} ${a.is_default ? '<span class="acc-badge">MAIN</span>' : ''}</div>
      <div class="acc-sub">ACCT ${maskAccount(a.account_number)}</div>
    </div>
    <div class="acc-bal">${fmtMoney(a.balance)}</div>
    ${a.is_default ? '' : `<button type="button" class="btn btn-soft btn-sm acc-move" data-move-from="${a.id}" data-move-label="${escapeAttr(a.label)}">${Icons.send} Move Money</button>`}
  </div>`;
}

function accountOptions(accounts, selectedId, label) {
  return accounts.map((a) => {
    const sel = a.id === selectedId ? ' selected' : '';
    const extra = a.is_default ? ' — MAIN' : '';
    return `<option value="${a.id}"${sel}>${escapeXml(a.label)}${extra} — ${fmtShortMoney(a.balance)}</option>`;
  }).join('');
}

/* ---------------- Toast ---------------- */
function toast(message, type = 'info') {
  let stack = $('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const icons = { success: Icons.check, error: Icons.alert, info: Icons.bell };
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = icons[type] + '<span></span>';
  t.querySelector('span').textContent = message;
  stack.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 400);
  }, 3200);
}

/* ---------------- Nav / shell ---------------- */
function renderTopbar() {
  const isAuthed = !!State.user;
  const unreadBadge = State.unread > 0 ? `<span class="notif-dot"></span>` : '';
  return `
  <header class="topbar">
    <div class="topbar-inner">
      <a href="#/" class="brand">
        <img src="Logo/Chase logo.png" alt="Chase Bank">
        <span class="brand-name">Chase Bank</span>
      </a>
      <nav class="topbar-nav">
        <a href="#/" data-nav="home"><span>Home</span></a>
        ${isAuthed ? `
          <a href="#/dashboard" data-nav="dashboard"><span>Dashboard</span></a>
          <a href="#/send" data-nav="send"><span>Send</span></a>
          <a href="#/notifications" data-nav="notifications">${Icons.bell}${unreadBadge}<span style="position:relative;display:inline-flex;align-items:center;">&nbsp;Alerts</span></a>
          <a href="#/me" data-nav="me"><span>Me</span></a>
        ` : `
          <a href="#/login" data-nav="login"><span>Login</span></a>
          <a href="#/signup" data-nav="signup"><span>Open Account</span></a>
        `}
        <button type="button" class="theme-toggle" id="themeToggle" data-theme-toggle title="Toggle dark / light theme" aria-label="Toggle theme"><span class="t-icon">${Icons.moon}</span></button>
        ${isAuthed ? `<button type="button" class="topbar-icon" id="logoutIcon" title="Log out" aria-label="Log out">${Icons.logout}</button>` : ''}
      </nav>
    </div>
  </header>`;
}

function renderBottomNav() {
  if (!State.user) return '';
  const unreadBadge = State.unread > 0 ? '<span class="notif-dot" style="position:absolute;top:4px;right:14px;"></span>' : '';
  return `
  <nav class="bottom-nav">
    <ul>
      <li><a href="#/dashboard" data-nav="dashboard">${Icons.home}<span>Home</span></a></li>
      <li><a href="#/send" data-nav="send">${Icons.send}<span>Send</span></a></li>
      <li><a href="#/notifications" data-nav="notifications" style="position:relative;">${Icons.bell}${unreadBadge}<span>Alerts</span></a></li>
      <li><a href="#/me" data-nav="me">${Icons.user}<span>Me</span></a></li>
    </ul>
  </nav>`;
}

function setActiveNav() {
  const hash = location.hash.replace('#/', '') || 'home';
  const key = routeOf(hash);
  $$('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === key);
  });
}

function routeOf(hash) {
  const h = String(hash || '').replace(/^#/, '').replace(/^\//, '').split('?')[0];
  const map = { '': 'home', login: 'login', signup: 'signup', dashboard: 'dashboard', my: 'dashboard', send: 'send', withdraw: 'withdraw', notifications: 'notifications', care: 'care', me: 'me', history: 'history' };
  return map[h] || h;
}

/* ---------------- Router ---------------- */
const appEl = () => $('#app');

function navigate(hash) {
  const clean = String(hash || '').replace(/^[#/]+/, '');
  location.hash = clean ? '/' + clean : '/';
}

async function router() {
  const root = appEl();
  const route = routeOf(location.hash);

  if (['dashboard', 'send', 'withdraw', 'notifications', 'care', 'me', 'history'].includes(route)) {
    try {
      State.user = await API.me();
    } catch (e) {
      State.user = null;
      toast('Please log in to continue', 'error');
      navigate('login');
      return;
    }
  }

  if (['login', 'signup'].includes(route) && State.user) {
    navigate('dashboard');
    return;
  }

  let html = '';
  switch (route) {
    case 'login': html = viewLogin(); break;
    case 'signup': html = viewSignup(); break;
    case 'dashboard': html = await viewDashboard(); break;
    case 'send': html = await viewSend(); break;
    case 'withdraw': html = await viewWithdraw(); break;
    case 'notifications': html = await viewNotifications(); break;
    case 'care': html = viewCare(); break;
    case 'me': html = await viewMe(); break;
    case 'history': html = await viewHistory(); break;
    default: html = viewLanding(); break;
  }

  root.className = 'view';
  root.innerHTML = html;
  setActiveNav();
  window.scrollTo({ top: 0 });

  bindRouteEvents(route);
}

/* ---------------- View: Landing ---------------- */
function viewLanding() {
  const socials = socialIcons();
  return `
  ${renderTopbar()}
  <section class="hero">
    <div class="hero-inner">
      <div>
        <div class="hero-badge"><span class="dot"></span> AMERICA'S TRUSTED DIGITAL BANK</div>
        <h1>Banking that moves as <span class="grad">fast as you</span></h1>
        <p>Send money to any Chase Bank account instantly using just their account number. Secure, simple and always available.</p>
        <div class="hero-cta">
          <button class="btn btn-primary btn-lg" onclick="location.hash='#/signup'">${Icons.user} Open an Account</button>
          <button class="btn btn-outline btn-lg" onclick="location.hash='#/login'">${Icons.lock} Login</button>
        </div>
      </div>
      <div class="hero-card">
        <div class="hc-top">
          ${Icons.creditCard}
          <div class="hc-chip"></div>
        </div>
        <div class="hc-bal">
          <div class="lbl">AVAILABLE BALANCE</div>
          <div class="amt">$50,000.00</div>
        </div>
        <div class="hc-acc">
          <span>SANTOS AKPAN</span>
          <span>52•• •••• •••</span>
        </div>
        <div class="hero-stats">
          <div class="hs"><b>500k+</b><span>Customers</span></div>
          <div class="hs"><b>$8.2B</b><span>Processed daily</span></div>
          <div class="hs"><b>99.9%</b><span>Uptime</span></div>
        </div>
      </div>
    </div>
  </section>

  <section class="features">
    <div class="sec-title">
      <h2>Everything you need, nothing you don't</h2>
      <p>Modern banking built around the way you actually manage money.</p>
    </div>
    <div class="feat-grid">
      <div class="card card-hover feat-card fc-blue">
        <div class="f-icon">${Icons.send}</div>
        <h3>Instant Transfers</h3>
        <p>Send money to any Chase account in seconds using just an account number — every account number starts with 52.</p>
      </div>
      <div class="card card-hover feat-card fc-green">
        <div class="f-icon">${Icons.shield}</div>
        <h3>Secure by Design</h3>
        <p>Every transfer is protected by your private 4-digit PIN and industry-standard password encryption.</p>
      </div>
      <div class="card card-hover feat-card fc-gold">
        <div class="f-icon">${Icons.wallet}</div>
        <h3>Total Control</h3>
        <p>Watch your balance, review every transaction and withdraw cash whenever you need it — all in one place.</p>
      </div>
      <div class="card card-hover feat-card fc-red">
        <div class="f-icon">${Icons.headset}</div>
        <h3>Customer Care</h3>
        <p>Real help whenever you need it. Reach our support team through the app, phone or social media.</p>
      </div>
    </div>
  </section>

  <section class="steps">
    <div class="steps-inner">
      <h2>Open your account in 3 simple steps</h2>
      <div class="step-grid">
        <div class="step">
          <div class="num">1</div>
          <h3>Create your account</h3>
          <p>Enter your first and last name, pick a unique username and verify your phone. We issue you an account number that starts with 52.</p>
        </div>
        <div class="step">
          <div class="num">2</div>
          <h3>Choose your PIN</h3>
          <p>Set your password and confirm your 4-digit transfer PIN that protects every outgoing transaction.</p>
        </div>
        <div class="step">
          <div class="num">3</div>
          <h3>Start banking</h3>
          <p>Receive a $50,000 welcome bonus and start sending money instantly to any Chase account.</p>
        </div>
      </div>
    </div>
  </section>

  <div class="cta-band">
    <h2>Ready to bank smarter?</h2>
    <p>Join over 500,000 Americans banking with Chase Bank today.</p>
    <button class="btn btn-primary btn-lg" onclick="location.hash='#/signup'">${Icons.sparkles} Get Started — It's Free</button>
  </div>

  ${renderFooterLanding()}
  ${renderBottomNav()}`;
}

function socialIcons(size) {
  return `
    <a href="https://facebook.com" target="_blank" rel="noopener" title="Facebook">${Icons.facebook}</a>
    <a href="https://x.com" target="_blank" rel="noopener" title="X (Twitter)">${Icons.xSocial}</a>
    <a href="https://whatsapp.com" target="_blank" rel="noopener" title="WhatsApp">${Icons.whatsapp}</a>
    <a href="https://instagram.com" target="_blank" rel="noopener" title="Instagram">${Icons.instagram}</a>
    <a href="https://linkedin.com" target="_blank" rel="noopener" title="LinkedIn">${Icons.linkedin}</a>
  `;
}

function renderFooterLanding() {
  return `
  <footer class="footer">
    <div class="footer-inner">
      <div>
        <a href="#/" class="brand"><img src="Logo/Chase logo.png" alt="Chase Bank"><span class="brand-name">Chase Bank</span></a>
        <p class="f-desc">A modern digital bank built for speed and simplicity. Every account gets a unique account number starting with 52 — banking has never been easier.</p>
      </div>
      <div>
        <h4>Banking</h4>
        <ul>
          <li><a href="#/login">Login</a></li>
          <li><a href="#/signup">Open Account</a></li>
          <li><a href="#/dashboard">Dashboard</a></li>
          <li><a href="#/send">Send Money</a></li>
        </ul>
      </div>
      <div>
        <h4>Support</h4>
        <ul>
          <li><a href="#/care">Customer Care</a></li>
          <li><a href="tel:+2348000000000">Phone: 0800 000 0000</a></li>
          <li><a href="mailto:support@chasebank.com">support@chasebank.com</a></li>
          <li><a href="#/notifications">Notifications</a></li>
        </ul>
      </div>
      <div>
        <h4>Follow us</h4>
        <div class="socials">${socialIcons()}</div>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 Chase Bank. All rights reserved.</span>
      <span>Developed by <span class="dev-credit">SANTOS</span></span>
    </div>
  </footer>`;
}

/* ---------------- Shared auth layout ---------------- */
function authLayout(title, subtitle, formHtml) {
  return `
  ${renderTopbar()}
  <div class="auth-wrap">
    <div class="auth-aside">
      <a href="#/" class="brand"><img src="Logo/Chase logo.png" alt="Chase Bank"><span class="brand-name">Chase Bank</span></a>
      <div class="auth-quote">
        <h2>Money moving at the speed of life.</h2>
        <p>Open an account in minutes and start sending money anywhere, anytime. Log in with your unique username and share your account number to receive payments.</p>
      </div>
      <div class="auth-foot">
        <span>Secure banking · SSL Protected · NDPR Compliant</span>
        <div class="socials">${socialIcons()}</div>
      </div>
    </div>
    <div class="auth-main">
      <div class="auth-box">
        <div class="auth-mobile-brand"><img src="Logo/Chase logo.png" alt="Chase Bank"><span>Chase Bank</span></div>
        <h1>${title}</h1>
        <p class="sub">${subtitle}</p>
        ${formHtml}
      </div>
    </div>
  </div>
  ${renderBottomNav()}`;
}

function eyeButton() {
  return `<button type="button" class="eye-btn" data-eye aria-label="Toggle visibility">${Icons.eye}</button>`;
}

/* ---------------- View: Login ---------------- */
function viewLogin() {
  return authLayout(
    'Welcome back',
    'Log in with your username or phone number and password.',
    `
    <div class="form-error" id="loginError"></div>
    <form id="loginForm">
      <div class="form-group">
        <label class="label" for="loginIdentifier">Username or Phone Number</label>
        <div class="input-wrap">
          <input class="input" type="text" id="loginIdentifier" placeholder="e.g. adaeze or 08123456789" autocomplete="username">
        </div>
      </div>
      <div class="form-group">
        <label class="label" for="loginPassword">Password</label>
        <div class="input-wrap">
          <input class="input input-pad" type="password" id="loginPassword" placeholder="Enter your password" autocomplete="current-password">
          ${eyeButton()}
        </div>
      </div>
      <button class="btn btn-primary btn-block btn-lg" type="submit" id="loginBtn">${Icons.lock} Login</button>
    </form>
    <div class="auth-switch">New to Chase Bank? <a href="#/signup">Create an account</a></div>
    `
  );
}

/* ---------------- View: Signup ---------------- */
function viewSignup() {
  return authLayout(
    'Create your account',
    'Pick a unique username — we issue your account number, which starts with "52".',
    `
    <div class="form-error" id="signupError"></div>
    <form id="signupForm">
      <div class="form-row">
        <div class="form-group">
          <label class="label" for="suFirst">First Name</label>
          <div class="input-wrap">
            <input class="input" type="text" id="suFirst" placeholder="e.g. SANTOS" autocomplete="given-name">
          </div>
        </div>
        <div class="form-group">
          <label class="label" for="suLast">Last Name</label>
          <div class="input-wrap">
            <input class="input" type="text" id="suLast" placeholder="e.g. AKPAN" autocomplete="family-name">
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="label" for="suUsername">Username</label>
        <div class="input-wrap">
          <input class="input" type="text" id="suUsername" placeholder="e.g. santos_akpan" autocomplete="username">
        </div>
        <div class="pass-hint" id="suUsernameHint">Choose a unique username — it is how you log in.</div>
      </div>
      <div class="form-group">
        <label class="label" for="suEmail">Email Address</label>
        <div class="input-wrap">
          <input class="input" type="email" id="suEmail" placeholder="you@example.com" autocomplete="email">
        </div>
      </div>
      <div class="form-group">
        <label class="label" for="suPhone">Phone Number <span class="text-muted">(for verification only)</span></label>
        <div class="input-wrap">
          <input class="input" type="tel" id="suPhone" inputmode="numeric" placeholder="e.g. 08012345678" autocomplete="tel" maxlength="12">
        </div>
        <div class="otp-bar">
          <button type="button" class="btn btn-outline btn-sm" id="sendOtpBtn">${Icons.sms} Send Code</button>
          <span class="otp-status" id="otpStatus"></span>
        </div>
        <div class="otp-box" id="otpBox" hidden>
          <div class="otp-inputs" id="otpInputs">
            ${[0, 1, 2, 3, 4, 5].map((i) => `<input class="otp-digit" type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="OTP digit ${i + 1}">`).join('')}
          </div>
          <div class="otp-actions">
            <button type="button" class="btn btn-navy btn-sm" id="verifyOtpBtn">${Icons.shield} Verify Code</button>
            <button type="button" class="btn btn-ghost btn-sm" id="resendOtpBtn" disabled>Resend in <span id="otpCountdown">30</span>s</button>
          </div>
          <div class="form-error" id="otpError"></div>
          <div class="demo-note" id="demoNote" hidden>${Icons.sms} Demo mode — your code was sent to <b>${Icons.whatsapp} SMS / WhatsApp</b>: <b class="demo-code" id="demoOtpCode"></b></div>
        </div>
        <div class="verified-line" id="phoneVerifiedLine" hidden>${Icons.check} Phone verified</div>
      </div>
      <div class="form-group">
        <label class="label" for="suPassword">Password</label>
        <div class="input-wrap">
          <input class="input input-pad" type="password" id="suPassword" placeholder="Create a password (min 6 characters)" autocomplete="new-password">
          ${eyeButton()}
        </div>
        <div class="pass-strength"><span id="suStrength"></span></div>
        <div class="pass-hint" id="suPassHint"></div>
      </div>
      <div class="form-group">
        <label class="label" for="suConfirm">Confirm Password</label>
        <div class="input-wrap">
          <input class="input input-pad" type="password" id="suConfirm" placeholder="Re-enter your password" autocomplete="new-password">
          ${eyeButton()}
        </div>
      </div>
      <div class="form-group">
        <label class="label" for="suPin">Transfer PIN <span class="text-muted">(4 digits — protects every transfer)</span></label>
        <div class="input-wrap">
          <input class="input input-pad" type="password" id="suPin" inputmode="numeric" placeholder="••••" maxlength="4" autocomplete="new-password">
          ${eyeButton()}
        </div>
      </div>
      <div class="form-group">
        <label class="label" for="suConfirmPin">Confirm Transfer PIN</label>
        <div class="input-wrap">
          <input class="input input-pad" type="password" id="suConfirmPin" inputmode="numeric" placeholder="••••" maxlength="4" autocomplete="new-password">
          ${eyeButton()}
        </div>
      </div>
      <button class="btn btn-primary btn-block btn-lg" type="submit" id="suBtn">${Icons.user} Create Account</button>
    </form>
    <div class="auth-switch">Already have an account? <a href="#/login">Login</a></div>
    `
  );
}

/* ---------------- Password strength ---------------- */
function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

function updateStrength(input) {
  const bar = $('#suStrength');
  const hint = $('#suPassHint');
  if (!bar || !input.value) { if (bar) bar.style.width = '0%'; if (hint) hint.textContent = ''; return; }
  const s = passwordStrength(input.value);
  const colors = ['var(--red)', 'var(--red)', 'var(--gold)', 'var(--gold)', 'var(--green)', 'var(--green)'];
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'];
  bar.style.width = (s / 5) * 100 + '%';
  bar.style.background = colors[s];
  hint.textContent = labels[s];
  hint.className = 'pass-hint ' + (s <= 2 ? 'weak' : s === 3 ? 'medium' : 'strong');
}

/* ---------------- View: Dashboard ---------------- */
async function viewDashboard() {
  const [me, txs] = await Promise.all([API.account(), API.transactions()]);
  State.user = me;
  State.txs = txs;
  updateUnread();

  const visible = State.balanceHidden ? 'blurred' : '';
  const eyeIcon = State.balanceHidden ? Icons.eye : Icons.eyeOff;

  const recent = txs.slice(0, 6);
  const txList = recent.length
    ? recent.map((t, i) => txItem(t, i)).join('')
    : `<div class="empty-state">${Icons.history}<p>No transactions yet</p></div>`;

  const firstName = (me.full_name || '').split(' ')[0];

  return `
  ${renderTopbar()}
  <div class="app-shell">
    <div class="welcome-row">
      <div class="welcome">
        <h1>Hello, ${firstName} 👋</h1>
        <p>Welcome back to your Chase Bank dashboard</p>
      </div>
      <a href="#/me"><div class="avatar" title="Profile">${avatarContent(me)}</div></a>
    </div>

    <div class="balance-card">
      <div class="balance-top">
        <div class="balance-label">Available Balance</div>
        <div class="balance-eyes">
          <span style="font-size:12px;opacity:.75;">${eyeIcon === Icons.eye ? 'Showing' : 'Hidden'}</span>
          <button type="button" class="eye-toggle" id="toggleBalance" aria-label="Hide balance">${eyeIcon}</button>
        </div>
      </div>
      <div class="amount ${visible}" id="balanceAmount">${fmtMoney(me.balance)}</div>
      <div class="balance-acc">
        <span>${Icons.user} ${me.full_name}</span>
        <span>${Icons.card} ACCT: ${me.account_number}</span>
        <span>${Icons.shield} PIN Protected</span>
      </div>
      <img class="chip" src="Favicon/chase%20favicon.png" alt="Chase Bank">
    </div>

    <div class="quick-actions">
      <button class="quick-action qa-send" onclick="location.hash='#/send'">
        <span class="qa-icon">${Icons.send}</span> Send Money
      </button>
      <button class="quick-action qa-withdraw" onclick="location.hash='#/withdraw'">
        <span class="qa-icon">${Icons.cash}</span> Withdraw
      </button>
      <button class="quick-action qa-care" onclick="location.hash='#/care'">
        <span class="qa-icon">${Icons.headset}</span> Customer Care
      </button>
      <button class="quick-action qa-me" onclick="location.hash='#/me'">
        <span class="qa-icon">${Icons.user}</span> My Profile
      </button>
    </div>

    <div class="panel-grid">
      <div class="panel-card">
        <div class="panel-head">
          <h3>${Icons.history} Recent Transactions</h3>
          <a class="link" href="#/history">View all</a>
        </div>
        <div class="tx-list">${txList}</div>
      </div>

      <div>
        <div class="panel-card" style="margin-bottom:20px;">
          <div class="panel-head"><h3>${Icons.send} Quick Transfer</h3></div>
          <div style="padding:18px 20px;">
            <div class="form-group" style="margin-bottom:12px;">
              <input class="input" id="qiPhone" type="tel" placeholder="Recipient account number" inputmode="numeric" maxlength="10">
            </div>
            <div class="form-group" style="margin-bottom:12px;">
              <input class="input" id="qiAmount" type="number" min="1" placeholder="Amount ($)" inputmode="decimal">
            </div>
            <button class="btn btn-navy btn-block" onclick="startQuickTransfer()">${Icons.send} Send Now</button>
          </div>
        </div>
        <div class="panel-card">
          <div class="panel-head"><h3>${Icons.bell} Alerts</h3><a class="link" href="#/notifications">See all</a></div>
          <div style="padding:18px 20px; text-align:center; color:var(--muted); font-size:13.5px;" id="dashAlert">
            ${Icons.shield}<p style="margin-top:8px;">Every transaction is secured by your transfer PIN.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
  ${renderFooterSmall()}
  ${renderBottomNav()}`;
}

function txItem(t, i) {
  const isIn = t.type === 'credit';
  const icon = isIn ? (t.category === 'WELCOME_BONUS' ? Icons.sparkles : Icons.arrowUp) : (t.category === 'WITHDRAWAL' ? Icons.cash : Icons.send);
  const iconCls = t.category === 'WELCOME_BONUS' ? 'bonus' : (isIn ? 'in' : 'out');
  const title = t.counterparty || (isIn ? 'Credit' : 'Debit');
  const cls = isIn ? 'credit' : 'debit';
  const sign = isIn ? '+' : '−';
  return `
    <div class="tx-item" style="animation-delay:${i * 60}ms">
      <div class="tx-icon ${iconCls}">${icon}</div>
      <div class="tx-meta">
        <div class="tx-title">${title}</div>
        <div class="tx-sub">${fmtDate(t.created_at)} · ${t.category}</div>
      </div>
      <div class="tx-amount ${cls}"><span>${sign}${fmtShortMoney(t.amount)}</span><span class="ref">REF ${t.reference.slice(-8)}</span></div>
      <button type="button" class="tx-receipt" data-receipt="${t.reference}" title="View / share receipt" aria-label="Transaction receipt">${Icons.receipt}</button>
    </div>`;
}

/* ---------------- View: Send ---------------- */
async function viewSend() {
  const me = await API.account();
  return `
  ${renderTopbar()}
  <div class="app-shell" style="max-width:640px;">
    <div class="page-head">
      <h1>${Icons.send} Send Money</h1>
      <p>Transfer instantly to any Chase Bank account using their account number (starts with "52").</p>
    </div>
    <div class="card">
      <form id="sendForm" novalidate>
        <div class="form-error" id="sendError"></div>
        <div class="form-group">
          <label class="label">Recipient Account Number</label>
          <div class="input-wrap">
            <input class="input" type="tel" id="sendPhone" inputmode="numeric" placeholder="e.g. 52000000001" maxlength="10">
          </div>
          <div id="recipientResult"></div>
        </div>
        <div class="form-group">
          <label class="label">From Account</label>
          <select class="input" id="sendAccount">${accountOptions(me.accounts || [], null)}</select>
        </div>
        <div class="form-group">
          <label class="label">Amount ($) <span class="text-muted" id="sendAvailable">— Available: ${fmtShortMoney(me.balance)}</span></label>
          <input class="input" type="number" id="sendAmount" min="1" inputmode="decimal" placeholder="0.00">
        </div>
        <div class="form-group">
          <label class="label">Description <span class="text-muted">(optional)</span></label>
          <input class="input" type="text" id="sendDesc" maxlength="60" placeholder="e.g. Lunch money">
        </div>
        <button class="btn btn-primary btn-block btn-lg" type="submit" id="sendBtn">${Icons.send} Continue to PIN</button>
      </form>
      <div style="margin-top:18px; padding-top:18px; border-top:1px solid var(--line); display:flex; align-items:center; gap:10px; font-size:13px; color:var(--muted);">
        ${Icons.shield} Your transfer PIN confirms this payment.
      </div>
    </div>
  </div>
  ${renderBottomNav()}`;
}

/* ---------------- View: Withdraw ---------------- */
async function viewWithdraw() {
  const me = await API.account();
  return `
  ${renderTopbar()}
  <div class="app-shell" style="max-width:640px;">
    <div class="page-head">
      <h1>${Icons.cash} Withdraw Cash</h1>
      <p>Withdraw money from your Chase Bank account.</p>
    </div>
    <div class="card">
      <form id="withdrawForm" novalidate>
        <div class="form-error" id="withdrawError"></div>
        <div class="form-group">
          <label class="label">From Account</label>
          <select class="input" id="wdAccount">${accountOptions(me.accounts || [], null)}</select>
        </div>
        <div class="form-group">
          <label class="label">Amount ($) <span class="text-muted" id="wdAvailable">— Available: ${fmtShortMoney(me.balance)}</span></label>
          <input class="input" type="number" id="wdAmount" min="1" inputmode="decimal" placeholder="0.00">
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:20px;" id="wdQuick">
          ${[5000, 10000, 20000, 50000].map((v) => `<button type="button" class="btn btn-soft btn-sm" data-quick="${v}">$${v.toLocaleString()}</button>`).join('')}
        </div>
        <button class="btn btn-primary btn-block btn-lg" type="submit" id="wdBtn">${Icons.cash} Continue to PIN</button>
      </form>
    </div>
  </div>
  ${renderBottomNav()}`;
}

/* ---------------- View: Notifications ---------------- */
async function viewNotifications() {
  const { notifications, unread } = await API.notifications();
  State.unread = unread;
  const items = notifications.length
    ? notifications.map((n, i) => {
        const iconCls = n.type === 'debit' ? 'ni-debit' : n.type === 'credit' ? 'ni-credit' : n.type === 'welcome' ? 'ni-welcome' : 'ni-info';
        const icon = n.type === 'debit' ? Icons.arrowDown : n.type === 'credit' ? Icons.arrowUp : Icons.sparkles;
        return `
        <div class="notif-item ${n.is_read ? '' : 'unread'}" style="animation:fadeSlide .4s ease both; animation-delay:${i * 50}ms">
          <div class="notif-icon ${iconCls}">${icon}</div>
          <div class="ni-body"><p>${n.message}</p><time>${fmtDate(n.created_at)}</time></div>
          ${n.is_read ? '' : '<span class="notif-dot"></span>'}
        </div>`;
      }).join('')
    : `<div class="empty-state">${Icons.bell}<p>No notifications yet</p></div>`;

  return `
  ${renderTopbar()}
  <div class="app-shell" style="max-width:720px;">
    <div class="page-head" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
      <div>
        <h1>${Icons.bell} Notifications</h1>
        <p>${unread} unread notification${unread === 1 ? '' : 's'}</p>
      </div>
      ${unread ? '<button class="btn btn-soft btn-sm" id="readAllBtn">Mark all read</button>' : ''}
    </div>
    <div class="panel-card">${items}</div>
  </div>
  ${renderBottomNav()}`;
}

/* ---------------- View: Customer Care ---------------- */
function viewCare() {
  return `
  ${renderTopbar()}
  <div class="app-shell" style="max-width:900px;">
    <div class="page-head">
      <h1>${Icons.headset} Customer Care</h1>
      <p>We're here to help — reach us any way that works for you.</p>
    </div>
    <div class="care-grid">
      <div>
        <div class="card care-card" style="text-align:left;">
          <div class="cc-icon" style="background:var(--blue-soft); color:var(--blue); margin:0 0 14px;">${Icons.chat}</div>
          <h3>Send us a message</h3>
          <p>Describe your issue and our team will respond within 24 hours.</p>
          <form id="careForm" style="margin-top:14px; text-align:left;">
            <div class="form-error" id="careError"></div>
            <div class="form-group">
              <label class="label" for="careSubject">Subject</label>
              <input class="input" type="text" id="careSubject" placeholder="e.g. Transaction not received" maxlength="80">
            </div>
            <div class="form-group">
              <label class="label" for="careMessage">Message</label>
              <textarea class="input" id="careMessage" rows="4" placeholder="Tell us what happened..." maxlength="500"></textarea>
            </div>
            <button class="btn btn-navy btn-block" type="submit" id="careBtn">${Icons.send} Send Message</button>
          </form>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div class="card card-hover care-card">
          <div class="cc-icon" style="background:var(--green-soft); color:var(--green);">${Icons.phone}</div>
          <h3>Call us</h3>
          <p>Our hotline is open 24/7.</p>
          <a class="cc-action" href="tel:+2348000000000">0800 000 0000 →</a>
        </div>
        <div class="card card-hover care-card">
          <div class="cc-icon" style="background:var(--gold-soft); color:var(--gold);">${Icons.mail}</div>
          <h3>Email us</h3>
          <p>Write to our support team.</p>
          <a class="cc-action" href="mailto:support@chasebank.com">support@chasebank.com →</a>
        </div>
        <div class="card card-hover care-card">
          <div class="cc-icon" style="background:var(--red-soft); color:var(--red);">${Icons.globe}</div>
          <h3>Social media</h3>
          <p>Chat with us on our socials.</p>
          <div style="display:flex; gap:8px; justify-content:center;" class="socials-filled">${socialIcons()}</div>
        </div>
      </div>
    </div>
  </div>
  ${renderBottomNav()}`;
}

/* ---------------- View: Me / Profile ---------------- */
async function viewMe() {
  const me = await API.account();
  const memberDate = new Date(me.created_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const firstName = (me.full_name || '').split(' ')[0];

  return `
  ${renderTopbar()}
  <div class="app-shell" style="max-width:760px;">
    <div class="page-head">
      <h1>${Icons.user} My Profile</h1>
      <p>Your account information at a glance.</p>
    </div>
    <div class="profile-hero">
      <div class="p-avatar-wrap">
        <div class="p-avatar">${avatarContent(me)}</div>
        <button type="button" class="ava-edit" id="avaBtn" title="Change profile picture" aria-label="Change profile picture">${Icons.camera}</button>
        <input type="file" id="avaInput" accept="image/png,image/jpeg,image/webp" hidden>
      </div>
      <div>
        <h2>${me.full_name}</h2>
        <p>${firstName}, your unique account number is <b>${me.account_number}</b> — share it freely for transfers.</p>
      </div>
      <div class="member-since"><div>MEMBER SINCE</div><b>${memberDate}</b></div>
    </div>
    <div class="profile-grid">
      <div class="card profile-field">
        <div class="pf-icon">${Icons.user}</div>
        <div><div class="pf-label">Full Name</div><div class="pf-value">${me.full_name}</div></div>
      </div>
      <div class="card profile-field">
        <div class="pf-icon">${Icons.at}</div>
        <div><div class="pf-label">Username</div><div class="pf-value">@${me.username || ''}</div></div>
      </div>
      <div class="card profile-field">
        <div class="pf-icon">${Icons.phone}</div>
        <div><div class="pf-label">Account Number</div><div class="pf-value">${me.account_number}</div></div>
      </div>
      <div class="card profile-field">
        <div class="pf-icon">${Icons.mail}</div>
        <div><div class="pf-label">Email Address</div><div class="pf-value">${me.email}</div></div>
      </div>
      <div class="card profile-field">
        <div class="pf-icon">${Icons.wallet}</div>
        <div><div class="pf-label">Total Balance</div><div class="pf-value">${fmtMoney(me.balance)}</div></div>
      </div>
    </div>
    <div class="panel-card" style="margin-top:22px;">
      <div class="panel-head">
        <h3>${Icons.wallet} My Accounts</h3>
        <button type="button" class="btn btn-soft btn-sm" id="addAccountBtn">${Icons.plus} Open Account</button>
      </div>
      <div style="padding:6px 20px 16px;">
        ${(me.accounts || []).map((a, i) => accountRow(a, i)).join('')}
      </div>
    </div>
    <div class="panel-card" style="margin-top:22px;">
      <div class="panel-head"><h3>${Icons.shield} Security</h3></div>
      <div style="padding:8px 20px 16px;">
        <div class="profile-field" style="border:none; padding:14px 0;">
          <div class="pf-icon" style="background:var(--green-soft); color:var(--green);">${Icons.lock}</div>
          <div><div class="pf-label">Transfer PIN</div><div class="pf-value">4-digit PIN set</div></div>
        </div>
      </div>
    </div>
    <div style="margin-top:20px; display:flex; gap:12px; flex-wrap:wrap;">
      <a class="btn btn-outline btn-block" href="#/history">${Icons.history} View Full History</a>
      <button class="btn btn-danger-soft btn-block" id="logoutBtn">${Icons.logout} Log Out</button>
    </div>
  </div>
  ${renderBottomNav()}`;
}

/* ---------------- View: History ---------------- */
async function viewHistory() {
  const txs = await API.transactions();
  State.txs = txs;
  const items = txs.length
    ? txs.map((t, i) => txItem(t, i)).join('')
    : `<div class="empty-state">${Icons.history}<p>No transactions yet</p></div>`;
  return `
  ${renderTopbar()}
  <div class="app-shell" style="max-width:760px;">
    <div class="page-head">
      <h1>${Icons.history} Transaction History</h1>
      <p>${txs.length} transaction${txs.length === 1 ? '' : 's'} on your account</p>
    </div>
    <div class="panel-card"><div class="tx-list">${items}</div></div>
  </div>
  ${renderBottomNav()}`;
}

function renderFooterSmall() {
  return `
  <footer class="footer" style="margin-top:0;">
    <div class="footer-bottom" style="max-width:1150px;">
      <span>© 2026 Chase Bank. All rights reserved.</span>
      <span>Developed by <span class="dev-credit">SANTOS</span></span>
    </div>
  </footer>`;
}

/* ---------------- PIN modal ---------------- */
function openPinModal({ title = 'Confirm Transfer', amount, onSuccess }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title" style="font-size:18px;">${title}</h3>
        ${amount ? `<div style="font-size:26px; font-weight:800; color:var(--navy); margin:10px 0 4px;">${fmtMoney(amount)}</div>` : ''}
        <p class="modal-desc" style="margin-bottom:18px;">Enter your 4-digit transfer PIN</p>
        <div class="pin-inputs" id="pinInputs">
          ${[0, 1, 2, 3].map((i) => `<input class="pin-box" type="password" inputmode="numeric" maxlength="1" autocomplete="off" aria-label="PIN digit ${i + 1}">`).join('')}
        </div>
        <div style="font-size:13px; color:var(--muted); margin-top:14px;">${Icons.shield} Protected by your transfer PIN</div>
        <div style="display:flex; gap:10px; margin-top:22px;">
          <button class="btn btn-ghost btn-block" id="pinCancel">Cancel</button>
          <button class="btn btn-navy btn-block" id="pinConfirm" disabled>Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const boxes = $$('.pin-box', overlay);
    const errline = document.createElement('div');
    errline.className = 'form-error server';
    $('#pinInputs', overlay).after(errline);

    let pin = '';

    const updateConfirm = () => { $('#pinConfirm', overlay).disabled = pin.length < 4; };

    const focusNext = (i) => { if (i < 3) boxes[i + 1].focus(); };

    boxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '').slice(0, 1);
        pin = boxes.map((b) => b.value).join('');
        boxes.forEach((b, j) => b.classList.toggle('filled', j <= i && !!b.value));
        updateConfirm();
        if (box.value) focusNext(i);
        else boxes[Math.max(0, i - 1)].focus();
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && i > 0) boxes[i - 1].focus();
        if (e.key === 'Enter') $('#pinConfirm', overlay).click();
      });
    });
    setTimeout(() => { if (boxes[0] && !boxes[0].disabled) boxes[0].focus(); }, 120);

    const shake = () => {
      boxes.forEach((b) => { b.classList.add('shake'); setTimeout(() => b.classList.remove('shake'), 500); });
      boxes.forEach((b) => { b.value = ''; b.classList.remove('filled'); });
      boxClean();
    };
    const boxClean = () => { pin = ''; updateConfirm(); boxes[0].focus(); };

    const close = () => { overlay.remove(); resolve({ success: false }); };
    $('#pinCancel', overlay).onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    $('#pinConfirm', overlay).onclick = async () => {
      const btn = $('#pinConfirm', overlay);
      const cancelBtn = $('#pinCancel', overlay);
      btn.disabled = true;
      cancelBtn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Processing';
      try {
        const result = await onSuccess(pin);
        overlay.remove();
        resolve({ success: true, data: result });
      } catch (e) {
        btn.disabled = false;
        cancelBtn.disabled = false;
        btn.innerHTML = 'Confirm';
        errline.classList.add('show');
        errline.textContent = e.message;
        shake();
      }
    };
  });
}

/* ---------------- Logout confirmation ---------------- */
function confirmLogout() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px; text-align:center;">
        <div class="conf-icon" style="width:56px; height:56px; margin:0 auto 14px; border-radius:50%; background:var(--red-soft); color:var(--red); display:flex; align-items:center; justify-content:center;">${Icons.logout}</div>
        <h3 class="modal-title" style="font-size:19px;">Log out of Chase Bank?</h3>
        <p class="modal-desc" style="margin:8px auto 22px; max-width:300px;">Are you sure you want to log out? You will need your username (or phone number) and password to sign in again.</p>
        <div style="display:flex; gap:10px;">
          <button class="btn btn-ghost btn-block" id="logoutCancel">Cancel</button>
          <button class="btn btn-danger-soft btn-block" id="logoutConfirm">${Icons.logout} Yes, Log Out</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = (val) => () => { overlay.remove(); resolve(val); };
    $('#logoutCancel', overlay).onclick = close(false);
    $('#logoutConfirm', overlay).onclick = close(true);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    setTimeout(() => $('#logoutConfirm', overlay).focus(), 80);
  });
}

async function logoutUser() {
  try { await API.logout(); } catch (e) { /* session may already be gone */ }
  State.user = null;
  toast('You have been logged out', 'info');
  navigate('');
}

/* ---------------- Money movement animation ---------------- */
function showMoneyAnimation({ type = 'send', amount, reference, receipt = null }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const isSend = type === 'send';

    const rays = [0, 45, 90, 135, 180, 225, 270, 315]
      .map((a) => `<span style="--angle:${a}deg; animation-delay:${0.55 + a / 1800}s"></span>`)
      .join('');

    const confetti = Array.from({ length: 18 }, (_, i) => {
      const colors = ['#0B5AD1', '#C9A24B', '#0C9D6A', '#E04F5F', '#116CFF'];
      return `<div class="confetti" style="left:${(i * 5.5 + Math.random() * 2)}%; background:${colors[i % colors.length]}; animation-duration:${1.2 + Math.random() * 1}s; animation-delay:${0.4 + Math.random() * 0.8}s;"></div>`;
    }).join('');

    overlay.innerHTML = `
      <div class="modal" style="max-width:460px; overflow:hidden;">
        <div class="confetti-box" id="confettiBox" style="display:none;">${confetti}</div>
        <div class="plane-scene" id="planeScene">
          <div class="plane">${Icons.plane}</div>
          <div class="flying-note" style="left:15%; bottom:8%; animation-delay:.1s;">${Icons.note}</div>
          <div class="flying-note" style="left:42%; bottom:2%; animation-delay:.45s;">${Icons.note}</div>
        </div>
        <div class="success-wrap hidden" id="successWrap">
          <div class="rays"><div class="success-ring">${Icons.check}</div>${rays}</div>
          <h3 class="modal-title">${isSend ? 'Transfer Successful!' : 'Withdrawal Successful!'}</h3>
          <p class="modal-desc" style="margin-top:10px;">
            ${fmtMoney(amount)} ${isSend ? 'sent' : 'withdrawn'} successfully.
            <br>${reference ? `Reference: <b>${reference}</b>` : ''}
          </p>
        </div>
        <div style="display:flex; gap:10px; margin-top:22px;">
          <button class="btn btn-primary btn-block" id="doneBtn" style="display:none;">${Icons.check} Done</button>
          <button class="btn btn-outline btn-block" id="receiptBtn" style="display:none;">${Icons.receipt} Receipt</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const plane = $('.plane', overlay);
    const distW = overlay.getBoundingClientRect().width;
    plane.style.setProperty('--fly-w', (distW * 0.75) + 'px');
    plane.style.setProperty('--fly-y', (-distW * 0.16) + 'px');

    setTimeout(() => {
      $('#planeScene', overlay).style.display = 'none';
      $('#confettiBox', overlay).style.display = 'block';
      $('#successWrap', overlay).classList.remove('hidden');
      $('#doneBtn', overlay).style.display = 'flex';
      if (receipt) $('#receiptBtn', overlay).style.display = 'flex';
    }, 2000);

    $('#doneBtn', overlay).onclick = () => { overlay.remove(); resolve(); };
    if (receipt) $('#receiptBtn', overlay).onclick = () => openReceipt(receipt);
  });
}

/* ---------------- Transaction receipts (image + PDF + share) ---------------- */
function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function receiptData(t) {
  const isIn = t.type === 'credit';
  const cat = t.category || 'TRANSFER';
  const kind = cat === 'WELCOME_BONUS' ? 'WELCOME BONUS'
    : cat === 'WITHDRAWAL' ? 'CASH WITHDRAWAL'
    : isIn ? 'MONEY RECEIVED' : 'MONEY SENT';
  return {
    reference: t.reference || 'N/A',
    amount: Number(t.amount || 0),
    sign: isIn ? '+' : '−',
    kind,
    isIn,
    date: new Date(t.created_at || Date.now()).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }),
    description: t.description || 'Bank transfer',
    counterparty: t.counterparty || 'CHASE BANK',
    balanceAfter: Number.isFinite(Number(t.balance_after)) ? Number(t.balance_after) : null,
    owner: (State.user && State.user.full_name) || 'Chase Bank Customer',
    account: (State.user && State.user.phone) || '',
    generated: new Date().toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  };
}

function receiptRows(rd) {
  const clip = (s) => (String(s).length > 46 ? String(s).slice(0, 43) + '...' : String(s));
  return [
    { l: 'Reference', v: rd.reference },
    { l: 'Date', v: rd.date },
    { l: 'Transaction', v: rd.kind },
    { l: 'Description', v: clip(rd.description) },
    { l: 'Counterparty', v: clip(rd.counterparty) },
    { l: 'Account', v: rd.account || '—' },
    { l: 'Account Name', v: clip(rd.owner) },
    { l: 'Balance After', v: rd.balanceAfter === null ? '—' : fmtMoney(rd.balanceAfter) }
  ];
}

function receiptSVG(rd) {
  const W = 620;
  const HEADER = 148;
  const ROW = 46;
  const rows = receiptRows(rd);
  const bodyTop = HEADER + 128;
  const H = bodyTop + rows.length * ROW + 96;
  const rowSvg = (y, label, value) => `
      <text x="46" y="${y}" font-size="13" fill="#66748B" font-family="Inter,'Segoe UI',Arial,sans-serif">${escapeXml(label)}</text>
      <text x="574" y="${y}" text-anchor="end" font-size="14" font-weight="700" fill="#12233F" font-family="Inter,'Segoe UI',Arial,sans-serif">${escapeXml(value)}</text>`;
  const statusW = 168;
  return {
    W, H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="${W}" height="${H}" fill="#FFFFFF"/>
      <rect width="${W}" height="${HEADER}" fill="#0B2545"/>
      <circle cx="${W - 40}" cy="30" r="120" fill="rgba(255,255,255,0.05)"/>
      <circle cx="${W - 110}" cy="${HEADER + 20}" r="90" fill="rgba(255,255,255,0.04)"/>
      <text x="46" y="72" font-size="30" font-weight="800" fill="#FFFFFF" font-family="Inter,'Segoe UI',Arial,sans-serif">Chase Bank</text>
      <text x="48" y="100" font-size="12" letter-spacing="3" fill="#C9A24B" font-family="Inter,'Segoe UI',Arial,sans-serif">TRANSACTION RECEIPT</text>
      <text x="${W / 2}" y="224" text-anchor="middle" font-size="52" font-weight="800" fill="#0B2545" font-family="Inter,'Segoe UI',Arial,sans-serif">${rd.sign}${fmtMoney(rd.amount)}</text>
      <text x="${W / 2}" y="254" text-anchor="middle" font-size="14" font-weight="600" letter-spacing="1.5" fill="#0B5AD1" font-family="Inter,'Segoe UI',Arial,sans-serif">${rd.kind}</text>
      <rect x="${(W - statusW) / 2}" y="276" width="${statusW}" height="34" rx="17" fill="#0C9D6A"/>
      <text x="${W / 2}" y="298" text-anchor="middle" font-size="13" font-weight="700" fill="#FFFFFF" font-family="Inter,'Segoe UI',Arial,sans-serif">✓ SUCCESSFUL</text>
      <line x1="46" y1="330" x2="${W - 46}" y2="330" stroke="#E3E9F2" stroke-width="2"/>
      ${rows.map((r, i) => rowSvg(bodyTop + i * ROW, r.l, r.v)).join('')}
      <line x1="46" y1="${H - 74}" x2="${W - 46}" y2="${H - 74}" stroke="#E3E9F2" stroke-width="1.5" stroke-dasharray="6 6"/>
      <text x="${W / 2}" y="${H - 44}" text-anchor="middle" font-size="12" fill="#66748B" font-family="Inter,'Segoe UI',Arial,sans-serif">This receipt was issued electronically by Chase Bank · ${rd.generated}</text>
      <text x="${W / 2}" y="${H - 22}" text-anchor="middle" font-size="11" fill="#66748B" font-family="Inter,'Segoe UI',Arial,sans-serif">Developed by SANTOS</text>
    </svg>`
  };
}

function svgToPngDataURL(svg, width, height) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function downloadDataURL(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function dataURLtoBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)[1];
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function pdfEscape(s) {
  return String(s || '')
    .split('').map((c) => (c.charCodeAt(0) > 127 ? '?' : c)).join('')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildReceiptPdf(rd) {
  const W = 595, H = 842, M = 56;
  const rows = receiptRows(rd);
  const pSign = rd.isIn ? '+' : '-';
  const p = [];
  p.push('BT /F2 22 Tf 1 0 0 1 ' + M + ' ' + (H - 90) + ' Td (' + pdfEscape('Chase Bank') + ') Tj ET');
  p.push('BT /F1 11 Tf 1 0 0 1 ' + M + ' ' + (H - 116) + ' Td (' + pdfEscape('Transaction Receipt - ' + rd.kind) + ') Tj ET');
  p.push('BT /F1 9 Tf 1 0 0 1 ' + M + ' ' + (H - 132) + ' Td (' + pdfEscape('Issued ' + rd.generated + ' · Developed by SANTOS') + ') Tj ET');
  p.push('BT /F2 34 Tf 1 0 0 1 ' + M + ' ' + (H - 192) + ' Td (' + pdfEscape(pSign + fmtMoney(rd.amount)) + ') Tj ET');
  p.push('BT /F1 13 Tf 1 0 0 1 ' + M + ' ' + (H - 216) + ' Td (' + pdfEscape(rd.kind + '  |  STATUS: SUCCESSFUL') + ') Tj ET');
  p.push('0.89 0.91 0.95 rg ' + M + ' ' + (H - 242) + ' ' + (W - 2 * M) + ' 2 re f');
  rows.forEach((r, i) => {
    const y = H - 278 - i * 34;
    p.push('BT /F1 10 Tf 1 0 0 1 ' + M + ' ' + y + ' Td (' + pdfEscape(String(r.l).toUpperCase()) + ') Tj ET');
    p.push('BT /F2 11 Tf 1 0 0 1 ' + 296 + ' ' + y + ' Td (' + pdfEscape(r.v) + ') Tj ET');
  });
  const fy = H - 278 - rows.length * 34 - 26;
  p.push('0.89 0.91 0.95 rg ' + M + ' ' + fy + ' ' + (W - 2 * M) + ' 1 re f');
  p.push('BT /F1 9 Tf 1 0 0 1 ' + M + ' ' + (fy - 16) + ' Td (' + pdfEscape('This receipt was issued electronically by Chase Bank. For enquiries, contact our 24/7 customer care.') + ') Tj ET');
  p.push('BT /F1 9 Tf 1 0 0 1 ' + M + ' ' + (fy - 30) + ' Td (' + pdfEscape('Reference ' + rd.reference + ' · Account ' + rd.account) + ') Tj ET');

  const content = p.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'
  ];
  let file = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets[i] = file.length;
    file += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
  });
  const xrefPos = file.length;
  file += 'xref\n0 ' + (objs.length + 1) + '\n';
  file += '0000000000 65535 f \n';
  offsets.forEach((off) => { file += String(off).padStart(10, '0') + ' 00000 n \n'; });
  file += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';
  return new TextEncoder().encode(file);
}

const Receipt = { data: null };

function bindReceiptButtons() {
  $$('.tx-receipt').forEach((btn) => {
    btn.onclick = () => {
      const ref = btn.dataset.receipt;
      const t = (State.txs || []).find((x) => x.reference === ref);
      if (t) openReceipt(t);
    };
  });
}

function openReceipt(t) {
  Receipt.data = receiptData(t);
  const rd = Receipt.data;
  const rows = receiptRows(rd);
  const shareSupported = typeof navigator !== 'undefined' && !!navigator.share;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-receipt">
      <div class="rc-head">
        <div>
          <div class="rc-title">${Icons.receipt} Transaction Receipt</div>
          <div class="rc-sub">${rd.kind} · ${rd.date}</div>
        </div>
        <button type="button" class="icon-btn" id="rcClose" aria-label="Close">${Icons.x}</button>
      </div>
      <div class="rc-amount ${rd.isIn ? 'credit' : 'debit'}">${rd.sign}${fmtMoney(rd.amount)}</div>
      <div class="rc-status"><span class="pill">${Icons.check} Successful</span></div>
      <div class="rc-body">
        ${rows.map((r) => `<div class="rc-row"><span>${escapeXml(r.l)}</span><b>${escapeXml(r.v)}</b></div>`).join('')}
      </div>
      <div class="rc-actions">
        <button type="button" class="btn btn-navy btn-block" id="rcPng">${Icons.download} Download Image</button>
        <div style="display:flex; gap:10px;">
          <button type="button" class="btn btn-outline btn-block" id="rcPdf">${Icons.download} PDF</button>
          ${shareSupported ? `<button type="button" class="btn btn-soft btn-block" id="rcShare">${Icons.share} Share</button>` : ''}
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  $('#rcClose', overlay).onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const rcPng = $('#rcPng', overlay);
  rcPng.onclick = async () => {
    rcPng.disabled = true;
    rcPng.innerHTML = '<span class="spinner"></span> Preparing image...';
    try {
      const { svg, W, H } = receiptSVG(rd);
      const dataUrl = await svgToPngDataURL(svg, W, H);
      downloadDataURL(dataUrl, 'chase-receipt-' + rd.reference.slice(-8) + '.png');
      toast('Receipt image downloaded', 'success');
    } catch (e) {
      toast('Could not generate the image — please try again', 'error');
    } finally {
      rcPng.disabled = false;
      rcPng.innerHTML = `${Icons.download} Download Image`;
    }
  };

  const rcPdf = $('#rcPdf', overlay);
  rcPdf.onclick = () => {
    rcPdf.disabled = true;
    rcPdf.innerHTML = '<span class="spinner"></span> Preparing PDF...';
    try {
      downloadBlob(new Blob([buildReceiptPdf(rd)], { type: 'application/pdf' }), 'chase-receipt-' + rd.reference.slice(-8) + '.pdf');
      toast('Receipt PDF downloaded', 'success');
    } catch (e) {
      toast('Could not generate the PDF — please try again', 'error');
    } finally {
      rcPdf.disabled = false;
      rcPdf.innerHTML = `${Icons.download} PDF`;
    }
  };

  if (shareSupported) {
    $('#rcShare', overlay).onclick = async () => {
      try {
        const { svg, W, H } = receiptSVG(rd);
        const dataUrl = await svgToPngDataURL(svg, W, H);
        const file = new File([dataURLtoBlob(dataUrl)], 'chase-receipt-' + rd.reference.slice(-8) + '.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ title: 'Chase Bank Receipt', text: 'Receipt ' + rd.reference, files: [file] });
          toast('Receipt shared', 'success');
        } else {
          downloadDataURL(dataUrl, 'chase-receipt-' + rd.reference.slice(-8) + '.png');
          toast('Image downloaded — share it anywhere', 'info');
        }
      } catch (e) {
        toast('Sharing cancelled or unavailable', 'error');
      }
    };
  }
}

/* ---------------- Event bindings ---------------- */
function bindRouteEvents(route) {
  if (route === 'login') bindLogin();
  if (route === 'signup') bindSignup();
  if (route === 'dashboard') bindDashboard();
  if (route === 'send') bindSend();
  if (route === 'withdraw') bindWithdraw();
  if (route === 'notifications') bindNotifications();
  if (route === 'care') bindCare();
  if (route === 'me') bindMe();

  // Eye toggles
  $$('[data-eye]').forEach((btn) => {
    btn.onclick = () => togglePasswordEye(btn);
  });

  // Global: refresh unread count badge
  if (State.user && route !== 'notifications') updateUnread();

  // Receipt buttons on transaction rows
  bindReceiptButtons();

  // Theme toggle
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.onclick = () => Theme.toggle();
    Theme.syncToggle();
  }

  // Logout icon (topbar)
  const logoutIcon = $('#logoutIcon');
  if (logoutIcon) {
    logoutIcon.onclick = async () => { if (await confirmLogout()) logoutUser(); };
  }
}

function togglePasswordEye(btn) {
  const input = btn.previousElementSibling;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.innerHTML = showing ? Icons.eye : Icons.eyeOff;
  input.focus();
}

function showFormError(id, msg) {
  const el = $('#' + id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

function hideFormError(id) {
  const el = $('#' + id);
  if (el) el.classList.remove('show');
}

function bindLogin() {
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    hideFormError('loginError');
    const identifier = $('#loginIdentifier').value.trim();
    const password = $('#loginPassword').value;
    const isPhone = /^\d{10,12}$/.test(identifier);
    const isUsername = /^[a-zA-Z0-9_]{3,20}$/.test(identifier);
    if (!isPhone && !isUsername) { showFormError('loginError', 'Enter your username or a valid phone number'); return; }
    if (!password) { showFormError('loginError', 'Enter your password'); return; }

    const btn = $('#loginBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Logging in...';
    try {
      await API.login({ identifier, password });
      toast('Welcome back to Chase Bank', 'success');
      navigate('dashboard');
    } catch (err) {
      showFormError('loginError', err.message);
      btn.disabled = false;
      btn.innerHTML = `${Icons.lock} Login`;
    }
  };
}

function bindSignup() {
  const first = $('#suFirst');
  const last = $('#suLast');
  const username = $('#suUsername');
  const pass = $('#suPassword');
  pass.addEventListener('input', () => updateStrength(pass));

  const usernameInput = username;
  usernameInput.addEventListener('input', () => {
    const v = usernameInput.value.trim();
    const hint = $('#suUsernameHint');
    if (!hint) return;
    if (!v) { hint.textContent = 'Choose a unique username — it is how you log in.'; hint.className = 'pass-hint'; return; }
    const ok = /^[a-zA-Z0-9_]{3,20}$/.test(v);
    hint.textContent = ok ? 'Username available to use.' : '3-20 characters: letters, numbers or underscores.';
    hint.className = 'pass-hint ' + (ok ? 'strong' : 'weak');
  });

  State.phoneVerified = null;
  const phoneInput = $('#suPhone');
  const sendBtn = $('#sendOtpBtn');
  const resendBtn = $('#resendOtpBtn');
  const otpBox = $('#otpBox');
  const otpStatus = $('#otpStatus');
  const digits = $$('.otp-digit');
  let otpLeft = 30;
  clearInterval(otpCountdownTimer);

  const setOtpStatus = (msg, ok) => {
    otpStatus.textContent = msg || '';
    otpStatus.classList.toggle('ok', !!ok);
  };

  const resetOtp = () => {
    State.phoneVerified = null;
    $('#phoneVerifiedLine').hidden = true;
    $('#demoNote').hidden = true;
    $('#demoOtpCode').textContent = '';
    digits.forEach((d) => (d.value = ''));
    hideFormError('otpError');
  };

  const startCountdown = () => {
    resendBtn.disabled = true;
    resendBtn.innerHTML = 'Resend in <span id="otpCountdown">30</span>s';
    otpLeft = 30;
    $('#otpCountdown').textContent = otpLeft;
    clearInterval(otpCountdownTimer);
    otpCountdownTimer = setInterval(() => {
      const el = $('#otpCountdown');
      if (!el) { clearInterval(otpCountdownTimer); return; }
      otpLeft -= 1;
      el.textContent = Math.max(otpLeft, 0);
      if (otpLeft <= 0) {
        clearInterval(otpCountdownTimer);
        resendBtn.disabled = false;
        resendBtn.innerHTML = `${Icons.sms} Resend code`;
      }
    }, 1000);
  };

  const sendOtpCode = async (btn) => {
    const phone = phoneInput.value.trim();
    if (!/^\d{10,12}$/.test(phone)) return showFormError('signupError', 'Enter a valid phone number (10-12 digits)');
    hideFormError('signupError');
    resetOtp();
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending...';
    try {
      const r = await API.sendOtp({ phone });
      otpBox.hidden = false;
      $('#demoNote').hidden = false;
      $('#demoOtpCode').textContent = r.demo_otp;
      setOtpStatus('Code sent via SMS / WhatsApp', true);
      startCountdown();
      digits[0].focus();
    } catch (err) {
      showFormError('signupError', err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  };

  sendBtn.onclick = () => sendOtpCode(sendBtn);
  resendBtn.onclick = () => sendOtpCode(resendBtn);

  digits.forEach((d, i) => {
    d.addEventListener('input', () => {
      d.value = d.value.replace(/\D/g, '');
      if (d.value && i < digits.length - 1) digits[i + 1].focus();
    });
    d.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !d.value && i > 0) digits[i - 1].focus();
    });
    d.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
      for (let k = 0; k < text.length && i + k < digits.length; k++) {
        digits[i + k].value = text[k];
        if (i + k < digits.length - 1) digits[i + k + 1].focus();
      }
    });
  });

  $('.otp-inputs').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#verifyOtpBtn').click();
  });

  $('#verifyOtpBtn').onclick = async () => {
    const phone = phoneInput.value.trim();
    const otp = digits.map((d) => d.value).join('');
    hideFormError('otpError');
    if (otp.length !== 6) return showFormError('otpError', 'Enter the 6-digit code');
    const btn = $('#verifyOtpBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Verifying...';
    try {
      const r = await API.verifyOtp({ phone, otp });
      State.phoneVerified = phone;
      otpBox.hidden = true;
      clearInterval(otpCountdownTimer);
      $('#demoNote').hidden = true;
      $('#phoneVerifiedLine').hidden = false;
      setOtpStatus('Phone verified — you can now create your account', true);
      phoneInput.disabled = true;
      toast('Phone number verified', 'success');
    } catch (err) {
      showFormError('otpError', err.message);
      digits.forEach((d) => (d.value = ''));
      digits[0].focus();
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${Icons.shield} Verify Code`;
    }
  };

  phoneInput.addEventListener('input', () => {
    const val = phoneInput.value.trim();
    if (State.phoneVerified && val !== State.phoneVerified) {
      resetOtp();
      setOtpStatus('');
      phoneInput.disabled = false;
    }
  });

  $('#signupForm').onsubmit = async (e) => {
    e.preventDefault();
    hideFormError('signupError');

    const first_name = first.value.trim();
    const last_name = last.value.trim();
    const handle = username.value.trim();
    const email = $('#suEmail').value.trim();
    const phone = phoneInput.value.trim();
    const password = pass.value;
    const confirm_password = $('#suConfirm').value;
    const transfer_pin = $('#suPin').value;
    const confirm_transfer_pin = $('#suConfirmPin').value;

    if (!/^[A-Za-z]{2,30}$/.test(first_name)) return showFormError('signupError', 'Enter your first name (letters only)');
    if (!/^[A-Za-z]{2,30}$/.test(last_name)) return showFormError('signupError', 'Enter your last name (letters only)');
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(handle)) return showFormError('signupError', 'Username must be 3-20 characters (letters, numbers or underscores)');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showFormError('signupError', 'Enter a valid email address');
    if (!/^\d{10,12}$/.test(phone)) return showFormError('signupError', 'Enter a valid phone number (10-12 digits)');
    if (password.length < 6) return showFormError('signupError', 'Password must be at least 6 characters');
    if (password !== confirm_password) return showFormError('signupError', 'Passwords do not match');
    if (!/^\d{4}$/.test(transfer_pin)) return showFormError('signupError', 'Transfer PIN must be exactly 4 digits');
    if (transfer_pin !== confirm_transfer_pin) return showFormError('signupError', 'Transfer PINs do not match');
    if (State.phoneVerified !== phone) return showFormError('signupError', 'Confirm your phone number with the OTP first');

    const btn = $('#suBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creating account...';
    try {
      await API.register({ first_name, last_name, username: handle, email, phone, password, confirm_password, transfer_pin, confirm_transfer_pin });
      State.phoneVerified = null;
      toast('Account created! $50,000 welcome bonus credited.', 'success');
      navigate('dashboard');
    } catch (err) {
      showFormError('signupError', err.message);
      btn.disabled = false;
      btn.innerHTML = `${Icons.user} Create Account`;
    }
  };
}

function bindDashboard() {
  $('#toggleBalance').onclick = () => {
    State.balanceHidden = !State.balanceHidden;
    const amount = $('#balanceAmount');
    amount.classList.toggle('blurred', State.balanceHidden);
    $('#toggleBalance').innerHTML = State.balanceHidden ? Icons.eye : Icons.eyeOff;
    $('.balance-eyes span').textContent = State.balanceHidden ? 'Hidden' : 'Showing';
  };
}

async function startQuickTransfer() {
  const acc = $('#qiPhone').value.trim();
  const amount = $('#qiAmount').value;
  if (!/^52\d{8}$/.test(acc)) { toast('Enter a valid recipient account number (starts with 52)', 'error'); return; }
  if (!(Number(amount) > 0)) { toast('Enter a valid amount', 'error'); return; }
  openingTransfer(acc, amount, '');
}

/* ---------------- Send flow ---------------- */
function bindSend() {
  const acctSel = $('#sendAccount');
  if (acctSel) {
    acctSel.addEventListener('change', () => {
      const opt = acctSel.options[acctSel.selectedIndex];
      $('#sendAvailable').textContent = '— Available: ' + (opt ? opt.text.split('—').pop() : '');
    });
  }

  $('#sendPhone').addEventListener('input', debounce(async () => {
    const acc = $('#sendPhone').value.trim();
    const box = $('#recipientResult');
    box.innerHTML = '';
    if (!/^52\d{8}$/.test(acc)) return;
    try {
      const r = await API.recipient(acc);
      box.innerHTML = `
        <div class="recipient-card">
          <div class="rc-avatar">${initials(r.full_name)}</div>
          <div><div class="rc-name">${r.full_name}</div><div class="rc-phone">@${r.username || ''} · ${r.account_number}</div></div>
          ${Icons.check}
        </div>`;
    } catch (e) {
      box.innerHTML = '';
    }
  }, 400));

  $('#sendForm').onsubmit = (e) => {
    e.preventDefault();
    hideFormError('sendError');
    const acc = $('#sendPhone').value.trim();
    const amount = $('#sendAmount').value;
    const desc = $('#sendDesc').value.trim();
    if (!/^52\d{8}$/.test(acc)) { showFormError('sendError', 'Enter a valid recipient account number (starts with 52)'); return; }
    if (!(Number(amount) > 0)) { showFormError('sendError', 'Enter a valid amount'); return; }
    openingTransfer(acc, amount, desc, 'sendError');
  };
}

async function openingTransfer(accNum, amount, desc, errorId) {
  try {
    const r = await API.recipient(accNum);
    const acctSel = $('#sendAccount');
    const accountId = acctSel ? Number(acctSel.value) : undefined;
    const result = await openPinModal({
      title: 'Confirm Transfer',
      amount,
      onSuccess: (pin) => API.transfer({ recipient: accNum, amount, pin, description: desc || '', account_id: accountId })
    });
    if (!result.success) return;
    await showMoneyAnimation({
      type: 'send',
      amount,
      reference: result.data.reference,
      receipt: {
        type: 'debit',
        category: 'TRANSFER',
        amount,
        reference: result.data.reference,
        description: desc || 'Bank transfer',
        counterparty: `SENT TO ${r.full_name.toUpperCase()} (${accNum})`,
        balance_after: result.data.balance,
        created_at: new Date().toISOString()
      }
    });
    navigate('dashboard');
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------------- Withdraw flow ---------------- */
function bindWithdraw() {
  const acctSel = $('#wdAccount');
  if (acctSel) {
    acctSel.addEventListener('change', () => {
      const opt = acctSel.options[acctSel.selectedIndex];
      $('#wdAvailable').textContent = '— Available: ' + (opt ? opt.text.split('—').pop() : '');
    });
  }
  $$('#wdQuick [data-quick]').forEach((btn) => {
    btn.onclick = () => { $('#wdAmount').value = btn.dataset.quick; };
  });
  $('#withdrawForm').onsubmit = async (e) => {
    e.preventDefault();
    hideFormError('withdrawError');
    const amount = $('#wdAmount').value;
    if (!(Number(amount) > 0)) { showFormError('withdrawError', 'Enter a valid amount'); return; }
    const acctSel = $('#wdAccount');
    const accountId = acctSel ? Number(acctSel.value) : undefined;
    try {
      const result = await openPinModal({
        title: 'Confirm Withdrawal',
        amount,
        onSuccess: (pin) => API.withdraw({ amount, pin, account_id: accountId })
      });
      if (!result.success) return;
      await showMoneyAnimation({
        type: 'withdraw',
        amount,
        reference: result.data.reference,
        receipt: {
          type: 'debit',
          category: 'WITHDRAWAL',
          amount,
          reference: result.data.reference,
          description: 'Cash withdrawal',
          counterparty: 'CASH WITHDRAWAL (ATM)',
          balance_after: result.data.balance,
          created_at: new Date().toISOString()
        }
      });
      navigate('dashboard');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
}

/* ---------------- Notifications ---------------- */
function bindNotifications() {
  if ($('#readAllBtn')) {
    $('#readAllBtn').onclick = async () => {
      await API.readAllNotifications();
      $('#readAllBtn').remove();
      $$('.notif-item.unread').forEach((el) => { el.classList.remove('unread'); el.querySelector('.notif-dot')?.remove(); });
      State.unread = 0;
      updateUnread();
      toast('All notifications marked as read', 'success');
    };
  }
}

/* ---------------- Care ---------------- */
function bindCare() {
  $('#careForm').onsubmit = async (e) => {
    e.preventDefault();
    hideFormError('careError');
    const subject = $('#careSubject').value.trim();
    const message = $('#careMessage').value.trim();
    if (subject.length < 3) return showFormError('careError', 'Please provide a subject');
    if (message.length < 10) return showFormError('careError', 'Please describe your issue (at least 10 characters)');
    const btn = $('#careBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending...';
    try {
      const r = await API.customerCare({ subject, message });
      toast(r.message, 'success');
      $('#careSubject').value = '';
      $('#careMessage').value = '';
    } catch (err) {
      showFormError('careError', err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${Icons.send} Send Message`;
    }
  };
}

/* ---------------- Me ---------------- */
function bindMe() {
  $('#logoutBtn').onclick = async () => { if (await confirmLogout()) logoutUser(); };

  const avaBtn = $('#avaBtn');
  const avaInput = $('#avaInput');

  avaBtn.onclick = () => avaInput.click();

  avaInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast('Please choose a PNG, JPEG or WebP picture', 'error'); }
    else if (file.size > 4 * 1024 * 1024) { toast('Image is too large (max 4 MB)', 'error'); }
    else {
      avaBtn.disabled = true;
      const original = avaBtn.innerHTML;
      avaBtn.innerHTML = '<span class="spinner"></span>';
      try {
        const dataUrl = await resizeImage(file, 256);
        await API.setAvatar({ avatar: dataUrl });
        toast('Profile picture updated', 'success');
        router();
      } catch (err) {
        toast(err.message || 'Could not update your profile picture', 'error');
      } finally {
        avaBtn.disabled = false;
        avaBtn.innerHTML = original;
        e.target.value = '';
      }
    }
    e.target.value = '';
  });

  $('#addAccountBtn').onclick = async () => {
    try {
      const r = await openAddAccountModal();
      if (r) { toast(r.message, 'success'); router(); }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  $$('.acc-move').forEach((btn) => {
    btn.onclick = async () => {
      try {
        const r = await openMoveModal(State.user, Number(btn.dataset.moveFrom));
        if (r) { toast('Transfer successful', 'success'); router(); }
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
}

/* ---------------- Add account modal ---------------- */
function openAddAccountModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">${Icons.plus} Open a New Account</h3>
        <p class="modal-desc">Your new account starts at $0 and is ready for transfers and withdrawals.</p>
        <div class="form-group">
          <label class="label" for="accLabel">Account name <span class="text-muted">(optional)</span></label>
          <input class="input" id="accLabel" maxlength="30" placeholder="e.g. Savings, Bills, Travel">
        </div>
        <div class="form-error" id="accError"></div>
        <div style="display:flex; gap:10px; margin-top:16px;">
          <button class="btn btn-ghost btn-block" id="accCancel">Cancel</button>
          <button class="btn btn-navy btn-block" id="accCreate">${Icons.plus} Open Account</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    $('#accCancel', overlay).onclick = () => overlay.remove();
    const input = $('#accLabel', overlay);
    setTimeout(() => input.focus(), 60);
    $('#accCreate', overlay).onclick = async () => {
      const btn = $('#accCreate', overlay);
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Opening...';
      try {
        const r = await API.openAccount({ label: input.value.trim() });
        overlay.remove();
        resolve(r);
      } catch (err) {
        showFormError('accError', err.message);
        btn.disabled = false;
        btn.innerHTML = `${Icons.plus} Open Account`;
      }
    };
  });
}

/* ---------------- Move-money modal (own accounts) ---------------- */
function openMoveModal(me, fromId) {
  return new Promise((resolve) => {
    const accounts = (me && me.accounts) || [];
    if (accounts.length < 2) { toast('You need at least two accounts to move money', 'error'); resolve(false); return; }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3 class="modal-title">${Icons.send} Move Money</h3>
        <p class="modal-desc">Transfer between your own Chase Bank accounts.</p>
        <div class="form-group">
          <label class="label" for="mvFrom">From Account</label>
          <select class="input" id="mvFrom">${accountOptions(accounts, fromId)}</select>
        </div>
        <div class="form-group">
          <label class="label" for="mvTo">To Account</label>
          <select class="input" id="mvTo">${accountOptions(accounts, null)}</select>
        </div>
        <div class="form-group">
          <label class="label" for="mvAmount">Amount ($) <span class="text-muted" id="mvAvailable"></span></label>
          <input class="input" type="number" id="mvAmount" min="1" inputmode="decimal" placeholder="0.00">
        </div>
        <div class="form-error" id="mvError"></div>
        <div style="display:flex; gap:10px; margin-top:16px;">
          <button class="btn btn-ghost btn-block" id="mvCancel">Cancel</button>
          <button class="btn btn-navy btn-block" id="mvNext">${Icons.send} Continue to PIN</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    $('#mvCancel', overlay).onclick = () => overlay.remove();

    const fromSel = $('#mvFrom', overlay);
    const toSel = $('#mvTo', overlay);
    const syncAvail = () => {
      const opt = fromSel.options[fromSel.selectedIndex];
      $('#mvAvailable', overlay).textContent = '— Available: ' + (opt ? opt.text.split('—').pop() : '');
    };
    fromSel.addEventListener('change', syncAvail);
    syncAvail();

    $('#mvNext', overlay).onclick = async () => {
      const from = Number(fromSel.value);
      const to = Number(toSel.value);
      const amount = $('#mvAmount', overlay).value;
      hideFormError('mvError');
      if (from === to) return showFormError('mvError', 'Choose two different accounts');
      if (!(Number(amount) > 0)) return showFormError('mvError', 'Enter a valid amount');

      const btn = $('#mvNext', overlay);
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Loading...';
      try {
        const result = await openPinModal({
          title: 'Confirm Move',
          amount,
          onSuccess: (pin) => API.moveMoney({ from_account_id: from, to_account_id: to, amount, pin })
        });
        if (result.success) {
          overlay.remove();
          resolve(result.data);
          return;
        }
      } catch (err) {
        showFormError('mvError', err.message);
      }
      btn.disabled = false;
      btn.innerHTML = `${Icons.send} Continue to PIN`;
    };
  });
}

/* ---------------- Resize image for avatar upload ---------------- */
function resizeImage(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(new Error('Could not process the image'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the image'));
    };
    img.src = url;
  });
}

/* ---------------- Unread badge ---------------- */
async function updateUnread() {
  if (!State.user) return;
  try {
    const { unread } = await API.notifications();
    State.unread = unread;
  } catch (e) { State.unread = 0; }
}

/* ---------------- Helpers ---------------- */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ---------------- Boot ---------------- */
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', async () => {
  Theme.apply();
  try {
    State.user = await API.me();
  } catch (e) { State.user = null; }
  router();
});

// Expose for inline onclick usage
window.startQuickTransfer = startQuickTransfer;