# XPLODE — Running the site everywhere

## The one idea to remember

The site has two parts:

| Part | What it is | Where it can live |
|---|---|---|
| **The skin** | The HTML/CSS/JS pages | Anywhere: this PC, XAMPP, Vercel, any web host |
| **The brain** | The Node backend (`server.js`) + its database | ONE place at a time: your PC, or a server online |

The pages always find the brain automatically (see `xp-config.js`):

- **On this computer** → they call `http://localhost:3000`, so keep `npm run dev` running.
- **Hosted online with one address** (whole app on Vercel) → they call their own address.
- **Split hosting** → set one line in `xp-config.js` (instructions inside the file).

Because of this, the same users, wallets and admin account work no matter which
server serves the pages — the brain is always the same.

---

## Mode 1 — On this PC (normal daily use)

```bash
npm run dev
```

Then open **http://localhost:3000/index.html** (bookmark it — NOT `localhost/mywebsite`).

Admin login: Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the environment before starting the server.

Database: `xplode.db` in this folder (file-based, no setup needed).

## Mode 2 — XAMPP (Apache serves the pages)

XAMPP can serve the pages (files in `C:\xampp\htdocs\mywebsite`), but Apache
cannot run the brain — a Node server is still required:

- Keep `npm run dev` running in this folder, **or**
- Point `xp-config.js` (in the htdocs copy) at a brain hosted online (Mode 3).

Pages from XAMPP automatically send logins and data to the brain at
`localhost:3000` (or wherever `xp-config.js` points). CORS is already enabled.

## Mode 3 — Online (Vercel)

1. Push this folder to a GitHub repository (`.env`, `xplode.db`, `server.log`,
   `.db` files are already git-ignored — they will NOT be uploaded).
2. On https://vercel.com → **Add New Project** → import the repo → Deploy.
   The included `vercel.json` routes everything to `server.js`.
3. In Vercel → Settings → Environment Variables, add:

   | Name | Value |
   |---|---|
   | `JWT_SECRET` | any long random text (required) |
   | `ADMIN_USERNAME` | `xplode-admin` |
   | `ADMIN_PASSWORD` | your admin password |
   | `ADMIN_EMAIL` | admin email |
   | `ADMIN_PIN` | choose a private five-digit PIN |
   | `ADMIN_KEY` | the SMS forwarder key |
   | `DB_PATH` | `/tmp/xplode.db` (trial only — see warning) |

4. Admin dashboard will be at `https://your-site.vercel.app/admin.html`.

### ⚠️ The one honest warning about Vercel + real money data

Vercel's server is **stateless**: any file written (including `xplode.db`)
disappears when the app recycles. Fine for a demo — **not fine for real
wallets**. For real data, pick one:

- **Option A — cloud database (recommended):** create a free account at
  https://turso.tech (a cloud SQLite — the exact database language this
  project already uses). Then the database layer is switched from the local
  file to Turso by setting `DATABASE_URL` — same code, same SQL, works on
  your PC AND on Vercel with identical data. This needs a one-time code
  change in `server.js` (ask and it will be done).
- **Option B — persistent-disk host:** run the whole app unchanged on a
  platform with a persistent disk (e.g. Railway, a small VPS). Zero code
  changes. Vercel can still serve the pages — set `xp-config.js` to the
  backend address.

---

## Quick reference

| Thing | Value |
|---|---|
| Start server | `npm run dev` |
| Local site | http://localhost:3000 |
| Admin login | Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the environment |
| Database file | `xplode.db` (set `DB_PATH` to move it) |
| Tests | `npm test` |
