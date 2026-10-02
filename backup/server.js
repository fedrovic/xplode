import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { timingSafeEqual } from 'node:crypto';
import { normalizeFortuneAmount, normalizeFortuneCode } from './fortuneLogic.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'xplode-secret-key';
const FORTUNE_ADMIN_KEY = process.env.FORTUNE_ADMIN_KEY || '';

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database(process.env.DB_PATH || path.join(__dirname, 'xplode.db'));

let dbOperationQueue = Promise.resolve();

const withDbOperation = (operation) => {
  const queuedOperation = dbOperationQueue.then(operation, operation);
  dbOperationQueue = queuedOperation.then(() => undefined, () => undefined);
  return queuedOperation;
};

const runUnlocked = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) return reject(err);
    resolve({ id: this.lastID, changes: this.changes });
  });
});

const getUnlocked = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) return reject(err);
    resolve(row || null);
  });
});

const allUnlocked = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows || []);
  });
});

const run = (sql, params = []) => withDbOperation(() => runUnlocked(sql, params));
const get = (sql, params = []) => withDbOperation(() => getUnlocked(sql, params));
const all = (sql, params = []) => withDbOperation(() => allUnlocked(sql, params));

const withDbTransaction = (operation) => withDbOperation(async () => {
  await runUnlocked('BEGIN IMMEDIATE');
  try {
    const result = await operation({ run: runUnlocked, get: getUnlocked, all: allUnlocked });
    await runUnlocked('COMMIT');
    return result;
  } catch (error) {
    await runUnlocked('ROLLBACK').catch(() => {});
    throw error;
  }
});

const createTables = async () => {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      mobile TEXT NOT NULL,
      invite_code TEXT DEFAULT '9700',
      pin_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      withdrawable REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      pending REAL NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS deposit_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount >= 10000),
      transaction_id TEXT NOT NULL COLLATE NOCASE UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL CHECK (amount >= 500),
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS reward_claims (
      user_id INTEGER PRIMARY KEY,
      bonus INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS plan_selections (
      user_id INTEGER PRIMARY KEY,
      plan TEXT NOT NULL CHECK (plan IN ('basic', 'premium', 'vip')),
      status TEXT NOT NULL CHECK (status IN ('active', 'payment_required')),
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS fortune_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      amount INTEGER NOT NULL CHECK (amount > 0),
      redeemed_by INTEGER,
      redeemed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (redeemed_by) REFERENCES users(id)
    )
  `);

  const existingUser = await get('SELECT id FROM users WHERE username = ?', ['fred']);
  if (!existingUser) {
    const passwordHash = await bcrypt.hash('fredo@2003', 10);
    const pinHash = await bcrypt.hash('1234', 10);
    const userResult = await run(
      `INSERT INTO users (username, password_hash, full_name, email, mobile, invite_code, pin_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['fred', passwordHash, 'Fred Murph', 'fred@xplode.com', '+256 700 123 456', '9700', pinHash]
    );

    await run(
      `INSERT INTO wallets (user_id, withdrawable, total, pending) VALUES (?, ?, ?, ?)`,
      [userResult.id, 2000, 4500, 500]
    );

    await run(
      `INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)`,
      [userResult.id, 'deposit', 1000, 'confirmed']
    );
    await run(
      `INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)`,
      [userResult.id, 'withdrawal', 500, 'completed']
    );
    await run(
      `INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)`,
      [userResult.id, 'reward', 250, 'credited']
    );
  }
};

const sanitizeUser = (user) => {
  if (!user) return null;
  const { password_hash, pin_hash, ...safe } = user;
  return safe;
};

const getWallet = async (userId) => {
  const wallet = await get('SELECT * FROM wallets WHERE user_id = ?', [userId]);
  return wallet || { user_id: userId, withdrawable: 0, total: 0, pending: 0 };
};

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await get('SELECT * FROM users WHERE id = ?', [payload.userId]);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }
    req.user = sanitizeUser(user);
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

const fortuneAdminMiddleware = (req, res, next) => {
  if (!FORTUNE_ADMIN_KEY) {
    return res.status(503).json({ success: false, message: 'Fortune code provisioning is not configured.' });
  }

  const providedKey = Buffer.from(String(req.get('X-Fortune-Admin-Key') || ''));
  const configuredKey = Buffer.from(FORTUNE_ADMIN_KEY);
  if (providedKey.length !== configuredKey.length || !timingSafeEqual(providedKey, configuredKey)) {
    return res.status(401).json({ success: false, message: 'Admin authorization required.' });
  }

  next();
};

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'XPLODE backend is running.' });
});

app.post('/api/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  const user = await get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Incorrect username or password.' });
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    return res.status(401).json({ success: false, message: 'Incorrect username or password.' });
  }

  const wallet = await getWallet(user.id);
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

  return res.json({
    success: true,
    message: 'Login successful.',
    token,
    user: sanitizeUser(user),
    wallet
  });
});

app.post('/api/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim();
  const mobile = String(req.body.mobile || '').trim();
  const inviteCode = String(req.body.inviteCode || '').trim();
  const password = String(req.body.password || '');
  const pin = String(req.body.pin || '');

  if (!username || !email || !mobile || !password || !pin) {
    return res.status(400).json({ success: false, message: 'Please complete all required fields.' });
  }

  if (inviteCode && inviteCode !== '9700') {
    return res.status(400).json({ success: false, message: 'Invalid invite code.' });
  }

  const existingUser = await get('SELECT id FROM users WHERE username = ?', [username]);
  if (existingUser) {
    return res.status(409).json({ success: false, message: 'Username already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const pinHash = await bcrypt.hash(pin, 10);
  const userResult = await run(
    `INSERT INTO users (username, password_hash, full_name, email, mobile, invite_code, pin_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [username, passwordHash, username, email, mobile, inviteCode || '9700', pinHash]
  );

  await run(
    `INSERT INTO wallets (user_id, withdrawable, total, pending) VALUES (?, ?, ?, ?)`,
    [userResult.id, 0, 0, 0]
  );

  const token = jwt.sign({ userId: userResult.id, username }, JWT_SECRET, { expiresIn: '7d' });
  const createdUser = await get('SELECT * FROM users WHERE id = ?', [userResult.id]);
  const wallet = await getWallet(userResult.id);

  return res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    token,
    user: sanitizeUser(createdUser),
    wallet
  });
});

app.get('/api/me', authMiddleware, async (req, res) => {
  const wallet = await getWallet(req.user.id);
  return res.json({ success: true, user: req.user, wallet });
});

app.patch('/api/profile', authMiddleware, async (req, res) => {
  const fullName = String(req.body.fullName || '').trim();
  if (fullName.length < 2 || fullName.length > 80) {
    return res.status(400).json({ success: false, message: 'Name must be between 2 and 80 characters.' });
  }

  await run('UPDATE users SET full_name = ? WHERE id = ?', [fullName, req.user.id]);
  const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  return res.json({ success: true, message: 'Profile name updated.', user: sanitizeUser(user) });
});

app.get('/api/wallet', authMiddleware, async (req, res) => {
  const wallet = await getWallet(req.user.id);
  return res.json({ success: true, wallet });
});

app.post('/api/wallet/deposit', authMiddleware, async (req, res) => {
  const amount = Number(req.body.amount);
  const provider = String(req.body.provider || '').trim();
  const transactionId = String(req.body.transactionId || '').trim();

  if (!Number.isSafeInteger(amount) || amount < 10000) {
    return res.status(400).json({ success: false, message: 'Minimum deposit is UGX 10,000.' });
  }

  if (provider === 'MTN Mobile Money') {
    return res.status(400).json({ success: false, message: 'MTN deposits are unavailable until the receiving number is configured.' });
  }

  if (provider !== 'Airtel Money') {
    return res.status(400).json({ success: false, message: 'Choose Airtel Money. MTN deposits are not configured yet.' });
  }

  if (transactionId.length < 6 || transactionId.length > 120) {
    return res.status(400).json({ success: false, message: 'Enter a valid transaction ID from your payment SMS.' });
  }

  const existingRequest = await get('SELECT id FROM deposit_requests WHERE transaction_id = ?', [transactionId]);
  if (existingRequest) {
    return res.status(409).json({ success: false, message: 'This transaction ID has already been submitted.' });
  }

  try {
    const request = await run(
      `INSERT INTO deposit_requests (user_id, provider, amount, transaction_id, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [req.user.id, provider, amount, transactionId]
    );
    const deposit = await get('SELECT id, provider, amount, transaction_id, status, created_at FROM deposit_requests WHERE id = ?', [request.id]);
    return res.status(201).json({
      success: true,
      message: 'Airtel deposit submitted for manual verification. Your balance will update after the payment is confirmed.',
      deposit
    });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({ success: false, message: 'This transaction ID has already been submitted.' });
    }
    throw error;
  }
});

app.get('/api/deposits', authMiddleware, async (req, res) => {
  const rows = await all(
    `SELECT id, provider, amount, transaction_id, status, created_at
     FROM deposit_requests WHERE user_id = ?
     UNION ALL
     SELECT id, 'Mobile Money' AS provider, amount, NULL AS transaction_id, status, created_at
     FROM transactions WHERE user_id = ? AND type = 'deposit'
     ORDER BY created_at DESC LIMIT 20`,
    [req.user.id, req.user.id]
  );
  return res.json({ success: true, deposits: rows });
});

app.post('/api/wallet/withdraw', authMiddleware, async (req, res) => {
  const amount = Number(req.body.amount);
  const pin = String(req.body.pin || '');

  if (!Number.isSafeInteger(amount) || amount < 500) {
    return res.status(400).json({ success: false, message: 'Minimum withdrawal is UGX 500.' });
  }

  const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const validPin = await bcrypt.compare(pin, user.pin_hash);
  if (!validPin) {
    return res.status(400).json({ success: false, message: 'Incorrect withdrawal PIN.' });
  }

  const wallet = await getWallet(req.user.id);
  const pendingRequests = await get(
    `SELECT COALESCE(SUM(amount), 0) AS amount
     FROM withdrawal_requests WHERE user_id = ? AND status = 'pending'`,
    [req.user.id]
  );
  const available = Number(wallet.withdrawable) - Number(pendingRequests.amount || 0);
  if (amount > available) {
    return res.status(400).json({ success: false, message: 'Withdrawal exceeds your available balance.' });
  }

  const request = await run(
    `INSERT INTO withdrawal_requests (user_id, amount, status) VALUES (?, ?, 'pending')`,
    [req.user.id, amount]
  );
  const withdrawal = await get(
    'SELECT id, amount, status, created_at FROM withdrawal_requests WHERE id = ?',
    [request.id]
  );

  return res.status(201).json({
    success: true,
    message: 'Withdrawal request submitted for review. Your balance will update after it is processed.',
    withdrawal,
    available: available - amount
  });
});

app.get('/api/withdrawals', authMiddleware, async (req, res) => {
  const rows = await all(
    `SELECT id, amount, status, created_at FROM withdrawal_requests WHERE user_id = ?
     UNION ALL
     SELECT id, amount, status, created_at FROM transactions WHERE user_id = ? AND type = 'withdrawal'
     ORDER BY created_at DESC LIMIT 20`,
    [req.user.id, req.user.id]
  );
  const pending = await get(
    `SELECT COALESCE(SUM(amount), 0) AS amount
     FROM withdrawal_requests WHERE user_id = ? AND status = 'pending'`,
    [req.user.id]
  );
  const wallet = await getWallet(req.user.id);
  const pendingWithdrawals = Number(pending.amount) || 0;
  return res.json({
    success: true,
    withdrawals: rows,
    available: Math.max(0, Number(wallet.withdrawable) - pendingWithdrawals),
    pending: (Number(wallet.pending) || 0) + pendingWithdrawals
  });
});

app.get('/api/rewards/status', authMiddleware, async (req, res) => {
  const claim = await get('SELECT bonus, created_at FROM reward_claims WHERE user_id = ?', [req.user.id]);
  return res.json({
    success: true,
    claimed: Boolean(claim),
    eligible: false,
    points: 0,
    tier: claim ? 'Starter' : 'New',
    boost: 0,
    message: 'No verified reward is available for this account yet.'
  });
});

app.post('/api/rewards/claim', authMiddleware, async (req, res) => {
  return res.status(409).json({
    success: false,
    eligible: false,
    message: 'No verified reward is available for this account yet. Referral eligibility is not connected.'
  });
});

app.post('/api/admin/fortune-codes', fortuneAdminMiddleware, async (req, res) => {
  const code = normalizeFortuneCode(req.body.code);
  const amount = normalizeFortuneAmount(req.body.amount);

  if (!code) {
    return res.status(400).json({ success: false, message: 'Use a code in the FORT-XXXXXX format.' });
  }
  if (amount === null) {
    return res.status(400).json({ success: false, message: 'Enter a valid fortune amount.' });
  }

  try {
    await run('INSERT INTO fortune_codes (code, amount) VALUES (?, ?)', [code, amount]);
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({ success: false, message: 'That fortune code has already been issued.' });
    }
    throw error;
  }

  return res.status(201).json({ success: true, code, amount });
});

app.get('/api/fortune', authMiddleware, async (req, res) => {
  const wins = await all(
    `SELECT code, amount, redeemed_at AS redeemedAt
     FROM fortune_codes WHERE redeemed_by = ? ORDER BY redeemed_at DESC LIMIT 50`,
    [req.user.id]
  );
  const totalWon = wins.reduce((total, win) => total + Number(win.amount), 0);
  return res.json({ success: true, totalWon, wins });
});

app.post('/api/fortune/redeem', authMiddleware, async (req, res) => {
  const code = normalizeFortuneCode(req.body.code);
  if (!code) {
    return res.status(400).json({ success: false, message: 'Use a code in the FORT-XXXXXX format.' });
  }

  const redemption = await withDbTransaction(async ({ run: runInTransaction, get: getInTransaction }) => {
    const fortuneCode = await getInTransaction(
      'SELECT code, amount FROM fortune_codes WHERE code = ? COLLATE NOCASE AND redeemed_by IS NULL',
      [code]
    );
    if (!fortuneCode) return null;

    const claimed = await runInTransaction(
      'UPDATE fortune_codes SET redeemed_by = ?, redeemed_at = CURRENT_TIMESTAMP WHERE code = ? COLLATE NOCASE AND redeemed_by IS NULL',
      [req.user.id, code]
    );
    if (claimed.changes !== 1) return null;

    await runInTransaction(
      'UPDATE wallets SET withdrawable = withdrawable + ?, total = total + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [fortuneCode.amount, fortuneCode.amount, req.user.id]
    );
    await runInTransaction(
      'INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)',
      [req.user.id, 'fortune', fortuneCode.amount, 'credited']
    );

    const wallet = await getInTransaction('SELECT withdrawable, total FROM wallets WHERE user_id = ?', [req.user.id]);
    const totalWon = await getInTransaction(
      'SELECT COALESCE(SUM(amount), 0) AS amount FROM fortune_codes WHERE redeemed_by = ?',
      [req.user.id]
    );
    const redeemedAt = await getInTransaction(
      'SELECT redeemed_at AS redeemedAt FROM fortune_codes WHERE code = ? COLLATE NOCASE',
      [code]
    );

    return {
      code: fortuneCode.code,
      amount: Number(fortuneCode.amount),
      redeemedAt: redeemedAt.redeemedAt,
      totalWon: Number(totalWon.amount),
      wallet
    };
  });

  if (!redemption) {
    return res.status(422).json({ success: false, message: 'Invalid or already used fortune code.' });
  }

  return res.status(201).json({
    success: true,
    message: `You won UGX ${redemption.amount.toLocaleString()}!`,
    win: { code: redemption.code, amount: redemption.amount, redeemedAt: redemption.redeemedAt },
    totalWon: redemption.totalWon,
    wallet: redemption.wallet
  });
});

app.get('/api/plans/current', authMiddleware, async (req, res) => {
  const selection = await get('SELECT plan, status, updated_at FROM plan_selections WHERE user_id = ?', [req.user.id]);
  return res.json({ success: true, selection: selection || { plan: 'basic', status: 'active', updated_at: null } });
});

app.post('/api/plans/select', authMiddleware, async (req, res) => {
  const plan = String(req.body.plan || '').trim().toLowerCase();
  if (!['basic', 'premium', 'vip'].includes(plan)) {
    return res.status(400).json({ success: false, message: 'Choose a valid plan.' });
  }

  const status = plan === 'basic' ? 'active' : 'payment_required';
  await run(
    `INSERT INTO plan_selections (user_id, plan, status) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, status = excluded.status, updated_at = CURRENT_TIMESTAMP`,
    [req.user.id, plan, status]
  );

  const message = plan === 'basic'
    ? 'Basic plan selected.'
    : `${plan === 'vip' ? 'VIP' : 'Premium'} selected. Payment is not connected, so the plan is not activated and no charge was made.`;
  return res.json({ success: true, message, selection: { plan, status } });
});

app.get('/api/transactions', authMiddleware, async (req, res) => {
  const rows = await all('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 20', [req.user.id]);
  return res.json({ success: true, transactions: rows });
});

app.use(express.static(__dirname));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ success: false, message: 'API endpoint not found.' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

await createTables();

app.listen(PORT, () => {
  console.log(`XPLODE backend running on http://localhost:${PORT}`);
});
