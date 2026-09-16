# Chase Bank — Demo (Developed by SANTOS)

A full-stack **banking demo web app** built to look and feel like a modern
retail bank: landing page, sign-up with phone (OTP) verification, deposit &
withdrawal with a PIN + device-location gate, P2P money transfer with an
animated paper-plane confirmation and generated receipts (PNG/PDF), live
transaction history, notifications, 24/7 customer care, profile pictures,
multiple accounts, and a profile/logout flow.

> ⚠️ **Not affiliated with, endorsed by, or connected to JPMorgan Chase & Co.
> in any way.** This is an independent educational/demo project built from
> scratch by **SANTOS** for a portfolio. The Chase name, logo and colors are
> used purely for a familiar demo aesthetic. **It does not move real money.**

---

## Tech stack

| Layer    | Tech                                        |
|----------|---------------------------------------------|
| Backend  | Node.js + Express + SQLite (`node:sqlite`)   |
| Frontend | Vanilla JS SPA (hash router), hand-rolled    |
| Styles   | CSS variables, glassmorphism, fully responsive |
| E2E      | `puppeteer-core` + headless Chrome          |

Zero production dependencies beyond the runtime + `puppeteer-core` for tests.

---

## Features

- Landing page with hero CTA, social links, and footer credit
- Open account: full signup validation (name, email, phone, password, PIN)
- Phone **OTP** verification with a locked phone field (demo OTP is shown on
  page for testing)
- **Eye** toggles on password/PIN fields (mask/reveal)
- Dashboard: balance with a visibility toggle, welcome bonus, quick actions,
  recent transactions, notifications
- **Send money**: recipient card → PIN modal gated by **device location
  verification** → animated paper-plane + success receipt
- **Withdraw cash**: quick amounts, same PIN + device-location gate, balance
  debit
- **Receipts**: auto-generated PNG (download) and PDF
- **Notifications**: unread markers + "mark all read"
- **Customer care** (chat form + call/email/social cards)
- **Profile** page with demo identity
- **Profile pictures**: upload a photo (resized to 256px on-device) that shows on
  the profile page and dashboard; falls back to initials when unset
- **Multiple accounts**: open additional accounts (start at $0), view all
  accounts and balances in the Me section, and move money between your own
  accounts (PIN-protected)
- Send Money / Withdraw: choose which account to send from or withdraw against
- Logout with confirmation (from dashboard or the topbar icon)

---

## Run locally

```bash
node server/index.js
# then open http://localhost:3000
```

On first launch the app applies schema migrations (idempotent) to the committed
`data/chasebank.db`, which already contains the demo accounts below. New
sign-ups create their own accounts and receive the welcome bonus.

### Demo/test credentials

| Role  | Name | Phone | Password | Transfer PIN |
|-------|------|--------|----------|--------------|
| Admin | ADAEZE OBI | `08123456789` | `chase123` | `2468` |
| Peer  | TUNDE BALOGUN | `07011112222` | `pass4567` | `1111` |

The two demo accounts are pre-seeded in the committed database (`data/chasebank.db`), so the app boots fully populated. `pass4567` and `07011112222` are also the values used in the automated tests.

The signup flow also generates a `demo_otp` welcome bonus on the page.

---

## Tests

```bash
# backend API contract suite
node server/test-backend.js      # 36 checks

# full browser E2E (starts its own clean DB; needs the server on :3000)
node server/test-e2e.js
```

---

© 2026 **SANTOS** — see [LICENSE](LICENSE). Built as a portfolio demo.
