# XPLODE local setup

The site uses a Node.js/Express API and stores accounts and wallet data in `xplode.db` (SQLite). XAMPP's Apache can serve the HTML, CSS, and JavaScript, but its MySQL service is not used by this project.

## Run with XAMPP

1. Start Apache in the XAMPP Control Panel.
2. Place the project folder under XAMPP's `htdocs` directory and open it at `http://localhost/<folder>/`.
3. In a terminal opened in the project folder, run `npm install` once, then `npm run dev` and leave that terminal running. The API listens at `http://localhost:3000`.
4. Reload the site and register an account, or log in with the demo account below.

The frontend on `localhost` sends `/api` requests to the Node API on port 3000. If login or registration says it cannot reach the backend, make sure `npm run dev` is still running and check `http://localhost:3000/api/health`.

## Fortune codes

Fortune codes are provisioned by the site operator and can only be redeemed once by an authenticated account. The live site blocks browser requests from `localhost` and uses a separate account session, so local fortune codes are kept in this app's SQLite database rather than being forwarded to the live service.

To enable code provisioning, set the same private admin key in the API terminal before starting the server:

```powershell
$env:FORTUNE_ADMIN_KEY = "replace-with-a-long-random-value"
npm run dev
```

In a second PowerShell terminal, set that same key and issue a code. The key stays server-side and must not be added to browser code:

```powershell
$env:FORTUNE_ADMIN_KEY = "replace-with-a-long-random-value"
$body = @{ code = "FORT-ABC123"; amount = 100 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/admin/fortune-codes" -Method Post -Headers @{ "X-Fortune-Admin-Key" = $env:FORTUNE_ADMIN_KEY } -ContentType "application/json" -Body $body
```

The fortune page uses `GET /api/fortune` for the account's wins and `POST /api/fortune/redeem` to atomically mark a code used, credit its amount to the wallet, and record a transaction. Codes must use `FORT-` followed by 1–15 letters or digits; amounts must be positive whole UGX values.

## Demo account

- Username: `fred`
- Password: `fredo@2003`

## APIs

- `POST /api/login`
- `POST /api/register`
- `GET /api/wallet`
- `POST /api/wallet/deposit`
- `POST /api/wallet/withdraw`
- `POST /api/rewards/claim`
- `GET /api/fortune`
- `POST /api/fortune/redeem`
- `POST /api/admin/fortune-codes` (requires `FORTUNE_ADMIN_KEY`)
- `GET /api/transactions`
