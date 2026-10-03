// ============================================================
//  XPLODE — front-end configuration (works everywhere)
// ============================================================
//  The web pages (HTML/CSS/JS) are only the "skin". Logins,
//  wallets, deposits and the admin dashboard always talk to
//  ONE backend API (the "brain"). This file decides where the
//  brain lives. You normally never need to touch it:
//
//  1. On this computer (XAMPP, Node server, or a double-clicked
//     file): pages automatically use the Node backend at
//     http://localhost:3000 — so keep "npm run dev" running.
//
//  2. Hosted online where the pages AND the backend share one
//     address (e.g. the whole app on Vercel): pages use the
//     same address they were loaded from — nothing to change.
//
//  3. Split hosting (pages on one address, backend on another):
//     remove the // from the line below and put your backend
//     address there. Every page on every server will follow it.
//
// window.XPLODE_API_BASE = 'https://your-backend-address.example.com';
// ============================================================

window.XPLODE_API_BASE = window.XPLODE_API_BASE || '';
