# XPLODE

A commercial animation site: user accounts, UGX wallet (deposits, withdrawals),
squad referrals, plans, salaries, fortune codes, and a kids/cartoons video hub.

- **Frontend:** static HTML/CSS/JS (no build step) served by the same Node server
- **Backend:** Node.js + Express, SQLite (`better-sqlite3`), JWT auth, bcrypt-hashed passwords/PINs
- **Tests:** `node --test` (API integration suite)

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 and **register a new account** — there is no demo or
seeded account. Every dashboard, wallet, and withdrawal requires signing in
with an account you created. To start with a completely fresh database, delete
`xplode.db` and restart the server.

### Using XAMPP

XAMPP/Apache can serve the HTML files at `http://localhost/mywebsite/`, but it
does not run this Node.js API. Keep Apache running, then open PowerShell in this
project folder and run `npm install` once followed by `npm run dev`. The page
will call the API at `http://localhost:3000`; verify it at
`http://localhost:3000/api/health`. If that address does not return the XPLODE
health response, login cannot work yet.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | no (default `3000`) | HTTP port |
| `DB_PATH` | no (default `./xplode.db`) | SQLite database file |
| `JWT_SECRET` | **yes in production** | Signs session tokens. Startup fails without it when `NODE_ENV=production`. |
| `ADMIN_KEY` | no | Enables admin endpoints: deposit approve/reject queue and fortune codes. Sent as the `X-Admin-Key` header. |
| `NODE_ENV` | no | Set to `production` when deploying |

The server loads a `.env` file from the project root automatically (see
`.env.example`). Copy it, fill in real values, and never commit the real file.

### Admin endpoints (operator only)

Set `ADMIN_KEY` in `.env`, then manage the deposit queue and fortune codes with
the `X-Admin-Key` header (details in [PAYMENTS-SETUP.md](PAYMENTS-SETUP.md)):

```powershell
$env:ADMIN_KEY = "a-long-random-value"
npm run dev
```

Then open http://localhost:3000/admin.html and paste the key. The curl/PowerShell
equivalents (list queue, approve/reject, fortune codes, SMS ingest) are in
[PAYMENTS-SETUP.md](PAYMENTS-SETUP.md).

Codes follow `FORT-` + 1–15 letters/digits, are single-use, and credit the
winner's withdrawable balance atomically.

## Payments

Deposits are received on Airtel **0704 141 950** and MTN **0788 734 485**.
Users submit the transaction ID **and the number they paid from**; the operator
verifies via the **operator panel at `/admin.html`** (unlock with `ADMIN_KEY`):
approve/reject buttons, payment-SMS processing, and fortune-code issuance.

**Free auto-crediting (no registration, no gateway):** forward the MTN/Airtel
payment SMSs from your phone to `POST /api/sms/ingest` (`X-Admin-Key` header)
using any Android auto-forwarder app — matching deposits are credited
automatically. Full setup in [PAYMENTS-SETUP.md](PAYMENTS-SETUP.md), which also
covers the MTN MoMo Open API, Airtel OpenAPI, and aggregators for later
(Flutterwave is currently waitlisting Ugandan businesses below enterprise
volume).

## Deploying to production

1. Set `NODE_ENV=production` and a strong random `JWT_SECRET`
   (e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
2. Keep the SQLite file on persistent disk and **outside** any web-servable
   directory if you front this with nginx/Apache. The app already refuses to
   serve `xplode.db`, `server.js`, `package.json`, `node_modules`, `test/`, and
   `backup/` over HTTP, but a reverse proxy should not serve the project
   directory directly either.
3. Run behind HTTPS. Helmet security headers are enabled (HSTS requires TLS).
4. Put the process under a supervisor (`pm2 start server.js` or a systemd unit)
   and restart it after server reboots.

## API overview

- `POST /api/login`, `POST /api/register` (rate-limited: 20 per 15 min)
- `GET /api/me`, `PATCH /api/profile`
- `GET /api/wallet`, `POST /api/wallet/deposit`, `POST /api/wallet/withdraw`
- `GET /api/deposits`, `GET /api/withdrawals`, `GET /api/transactions`
- `GET /api/team` — referral counts (direct / level 2 / total)
- `GET /api/rewards/status`, `POST /api/rewards/claim`
- `GET /api/plans/current`, `POST /api/plans/select`
- `GET /api/fortune`, `POST /api/fortune/redeem`
- `POST /api/admin/fortune-codes` (admin key required)
- `GET /api/health`

All `/api` routes are rate-limited (300 requests per 15 min per IP).

## Business rules encoded in the backend

- Deposits: Airtel Money only right now, minimum UGX 10,000, unique transaction
  IDs, manual verification (balance updates after operator confirmation).
- Withdrawals: minimum UGX 500, MTN/Airtel mobile money destination with
  account name + number, PIN check, and **one request per 24 hours**
  (`nextWithdrawalAt` is returned so the UI can show the cooldown).
- Referrals: every new account gets a unique 6-digit invite code; registering
  with someone's code links `referred_by` for team counting.

## Tests

```bash
npm test
```

Runs the API integration suite against a temporary database — no data is touched.

## Not yet connected (intentional)

- **Payment gateway:** deposits are recorded for manual verification; no
  automatic confirmation from Airtel/MTN yet.
- **Plan payments:** selecting Premium/VIP records intent only; no charge.
- **Reward claiming / squad salary payouts:** pages are informational; the
  payout engine (referral bonuses, salary runs) is not built yet.
- **APK download:** the dashboard APK tile is a placeholder until an APK file
  is provided.
