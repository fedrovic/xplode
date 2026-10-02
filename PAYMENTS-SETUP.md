# Payment Gateway Setup Guide (XPLODE)

This guide covers how to receive mobile-money payments automatically and plug
them into the site. The site currently runs on **manual verification**
(users pay to your numbers, then submit the transaction ID; you approve it in
the admin queue — see "Admin deposit queue" below). That works today with zero
third parties; a gateway automates the same loop.

---

## 0. The free path you can use right now (no registration, no fees)

You need only your phone and the numbers you already have. Two tools are built
into the site:

1. **Operator panel** — open `http://localhost:3000/admin.html` (or
   `https://your-domain/admin.html` in production), paste your `ADMIN_KEY`, and
   approve/reject deposits with buttons instead of curl. It also issues fortune
   codes and lets you paste a payment SMS.
2. **SMS auto-credit** — install any free Android auto-forwarder (MacroDroid,
   Tasker, or SMS Forwarder) on the phone that receives the MTN/Airtel payment
   confirmations, and forward matching SMSs to
   `POST /api/sms/ingest` with header `X-Admin-Key: <ADMIN_KEY>` as JSON:
   `{ "sender": "MTN", "body": "...full SMS text..." }`.
   The server parses the amount + payer number, matches the oldest pending
   deposit with the same amount and payer number, and credits that wallet
   automatically. Every message is logged in the `sms_log` table.

Depositors must now enter the **number they paid from** on the deposit form —
that is what makes the automatic match reliable.

Cost: UGX 0. Registration: none. This is the recommended mode until your
business is registered and a gateway becomes necessary.

---

## 0b. Flutterwave status (update)

Flutterwave placed the business on its **waitlist**: in Uganda they currently
onboard only large enterprises processing **above ~USD 5M annually**. Do not
count on them short-term. When they expand capacity they will email you.

Treat the direct-network and aggregator options below as the primary paths.

---

## 1. What you have today (manual mode — already working)

| Network | Receiving number | Where shown |
| --- | --- | --- |
| Airtel Money | 0704 141 950 | deposit.html |
| MTN Mobile Money | 0788 734 485 | deposit.html |

Users pay to those numbers, submit the transaction ID from their SMS, and the
request lands in a pending queue. You approve or reject it with the admin
endpoints (below) and the wallet updates automatically on approval.

**Admin deposit queue** — set an `ADMIN_KEY` in `.env`, then:

```powershell
# list pending deposits (newest first)
curl -H "X-Admin-Key: YOUR_ADMIN_KEY" http://localhost:3000/api/admin/deposits

# after you SEE the money in your mobile money statement:
curl -X POST -H "X-Admin-Key: YOUR_ADMIN_KEY" http://localhost:3000/api/admin/deposits/12/approve

# if the transaction ID is not in your statement:
curl -X POST -H "X-Admin-Key: YOUR_ADMIN_KEY" http://localhost:3000/api/admin/deposits/12/reject
```

Approve credits the user's withdrawable + total balance in one atomic step and
writes a `confirmed` transaction row. Reject marks it rejected and does not move
any balances. Both refuse to act twice (a settled request can't change again).

---

## 2. Option A — MTN MoMo Open API (direct from MTN Uganda, no middleman)

MTN's Open API program is designed for Ugandan businesses of any size.

1. **Register a developer account** — <https://momodeveloper.mtn.com> (the MoMo
   Developer Portal). Free; sandbox access is granted immediately.
2. **Subscribe to Collections** in the portal → you receive a
   **subscription key (primary key)**.
3. **Provision an API user + API key** (sandbox first, then production):
   - `POST /v1_0/api-user` with a `referenceId` (a UUID you generate) and your
     callback host → creates the API user.
   - `POST /v1_0/api-user/{referenceId}/apikey` → returns the API key.
4. **For live (production) collections**, your receiving number must be a
   registered MoMo merchant. **Self-register the business at
   <https://onboarding.momo.africa/>** (or dial \*165\*17# / \*155# on the
   business line) and ask the MTN business desk to link the merchant account to
   your developer account for Collections production access.
5. You will then hold: `MOMO_SUBSCRIPTION_KEY`, `MOMO_API_USER_ID`,
   `MOMO_API_KEY`, plus `MOMO_TARGET_ENV` (`sandbox` for testing, `mtnuganda`
   for live).
6. How a charge works: request an OAuth token (Basic auth of
   `API_USER_ID:API_KEY`), then `POST /collection/v1_0/requesttopay` with the
   payer's number in international format (`0788734485` → `256788734485`), the
   amount, and an idempotency UUID in `X-Reference-Id`. The user confirms on
   their phone; MTN calls your webhook when it settles.

---

## 3. Option B — Airtel Africa OpenAPI (direct from Airtel)

1. Create an account at <https://developers.airtel.africa> and register your
   service for **Collections** in Uganda.
2. After their onboarding review you receive `client_id` and `client_secret`.
3. OAuth2: `POST /auth/oauth2/token` → bearer token →
   `POST /merchant/v1/payments/` with the subscriber MSISDN and amount.
4. Live collections require the receiving number to be an Airtel Money
   merchant — coordinate with an Airtel business representative.

---

## 4. Option C — Local aggregators (fastest middle path)

Aggregators aggregate many small merchants onto the network APIs and approve
businesses well below Flutterwave's enterprise threshold. Examples active in
Uganda: **Iotec**, **DGateway**, and similar providers (verify current terms,
fees, and settlement times yourself before committing). Typically you get API
keys within days and a single integration covers MTN + Airtel. Due diligence
checklist: settlement schedule (T+0/T+1), fee per transaction, webhook
security, and the contract's merchant-of-record terms.

---

## 5. Where the credentials go

Add to `.env` (copy from `.env.example`), then send me the values (or set them
on the server yourself) and I will wire the integration:

```
# MTN (Option A)
MOMO_SUBSCRIPTION_KEY=…
MOMO_API_USER_ID=…
MOMO_API_KEY=…
MOMO_TARGET_ENV=sandbox        # then mtnuganda when live

# Airtel (Option B)
AIRTEL_CLIENT_ID=…
AIRTEL_CLIENT_SECRET=…
AIRTEL_COUNTRY=UG

# Aggregator (Option C) — names depend on the provider
PAYMENT_PROVIDER=…             # e.g. iotec / dgateway
```

---

## 6. How the integration will work once credentials exist

1. **Deposit page** gains a "Pay now" button next to the chosen network: the
   server creates a charge for the user's MSISDN; the user confirms the
   *prompt on their phone* (STK push / requesttopay).
2. **Webhook** arrives at the server, is verified (signature or secret hash),
   finds the pending deposit request by reference, and credits the wallet —
   the same atomic code the manual approve endpoint uses today, so both paths
   stay consistent.
3. **Reconciliation** — the admin queue remains as a fallback: if a webhook is
   missed you can still approve manually; duplicate credits are impossible
   because the deposit row status guard (`pending`) is checked in the
   transaction.
4. **Withdrawals (payouts)** can also be automated with the same credentials
   (MoMo Disbursement / Airtel Disbursement) — added only after collections
   work, since payouts move real money out.

---

## 7. Security rules for the credentials

- **Never** commit real keys to the repo or paste them in chat; put them in
  `.env` on the server (already gitignore-able; `.env` is also blocked from HTTP
  by the server) or your host's environment settings.
- Only **public** keys belong in the browser. Secret keys live in server-side
  code paths only.
- Rotate keys if they ever leak (portal → regenerate).
- Test with sandbox keys first, verify one real payment of the minimum amount
  (UGX 10,000) end-to-end, then switch to live keys.

## 8. Minimum-viable alternative (zero credentials — launch-ready now)

If API paperwork stalls, manual mode is safe at scale: approve only
transaction IDs that appear in your statement (the admin queue gives you
exactly that check). This is how the site works today; a gateway is a
convenience upgrade, not a blocker for launch.
