import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import { connect } from '@tursodatabase/serverless';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizeFortuneAmount, normalizeFortuneCode } from './fortuneLogic.js';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || '';
const ADMIN_KEY = process.env.FORTUNE_ADMIN_KEY || process.env.ADMIN_KEY || '';

// Receiving accounts for manual mobile-money deposits. Displayed on the deposit page.
const DEPOSIT_ACCOUNTS = {
  'Airtel Money': '0704 141 950',
  'MTN Mobile Money': '0788 734 485'
};
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (!JWT_SECRET) {
  if (IS_PRODUCTION) {
    console.error('Refusing to start in production without a JWT_SECRET environment variable.');
    process.exit(1);
  }
  console.warn('WARNING: JWT_SECRET is not set. Using a temporary development secret — sessions reset on restart.');
}

const DEV_JWT_SECRET = 'xplode-dev-secret';
const WITHDRAWAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_JSON_BODY = '16kb';
const DATABASE_SCHEMA_VERSION = 1;
const TOON_WATCH_SECONDS = 6;
const getKampalaDate = () => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Kampala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const TOON_LEVELS = {
  1: { amount: 10000, reward: 800 },
  2: { amount: 45000, reward: 2250 },
  3: { amount: 100000, reward: 3000 }
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors());
// CSP: pages load no inline scripts, so external script execution is blocked.
// Allowed externals: Google Fonts, remote kid-cartoon videos (explode.live),
// YouTube-nocookie embeds on the cartoons page.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ['https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'https:'],
      'media-src': ["'self'", 'https:'],
      'frame-src': ['https://www.youtube-nocookie.com', 'https://www.youtube.com'],
      'connect-src': ["'self'"],
      'upgrade-insecure-requests': null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression());
app.use(express.json({ limit: MAX_JSON_BODY }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down and try again shortly.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please wait a few minutes and try again.' }
});

app.use('/api', apiLimiter);

const TURSO_DATABASE_URL = process.env.RECOVERY_TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.RECOVERY_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
const remoteDatabaseEnabled = Boolean(TURSO_DATABASE_URL && TURSO_AUTH_TOKEN);
const localDb = remoteDatabaseEnabled ? null : new Database(process.env.DB_PATH || path.join(__dirname, 'xplode.db'));
localDb?.pragma('journal_mode = WAL');
localDb?.pragma('foreign_keys = ON');
const remoteDb = remoteDatabaseEnabled ? connect({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN }) : null;
const transactionContext = new AsyncLocalStorage();
if (remoteDatabaseEnabled) await (await remoteDb.prepare('PRAGMA foreign_keys = ON')).run();
let localQueue = Promise.resolve();
const withLocalLock = async (callback) => {
  const previous = localQueue;
  let release;
  localQueue = new Promise((resolve) => { release = resolve; });
  await previous;
  try { return await callback(); } finally { release(); }
};
const execute = async (method, sql, params = []) => {
  const transaction = transactionContext.getStore();
  if (remoteDatabaseEnabled) {
    const statement = await (transaction || remoteDb).prepare(sql);
    const result = await statement[method](params);
    if (method === 'run') return { changes: Number(result.changes || 0), lastInsertRowid: Number(result.lastInsertRowid || 0) };
    return result;
  }
  const perform = () => localDb.prepare(sql)[method === 'run' ? 'run' : method](...params);
  return transaction === localDb ? perform() : withLocalLock(perform);
};
const run = async (sql, params = []) => execute('run', sql, params);
const get = async (sql, params = []) => execute('get', sql, params);
const all = async (sql, params = []) => execute('all', sql, params);
const withTransaction = async (callback) => {
  if (transactionContext.getStore()) return callback();
  if (remoteDatabaseEnabled) {
    return remoteDb.transactionAsync(async (tx) => {
      await (await tx.prepare('PRAGMA foreign_keys = ON')).run();
      return transactionContext.run(tx, callback);
    })();
  }
  return withLocalLock(async () => {
    localDb.exec('BEGIN IMMEDIATE');
    try {
      const result = await transactionContext.run(localDb, callback);
      localDb.exec('COMMIT');
      return result;
    } catch (error) {
      localDb.exec('ROLLBACK');
      throw error;
    }
  });
};
const db = { transaction: (callback) => (...args) => withTransaction(() => callback(...args)) };

const tryAddColumn = async (table, column, definition) => {
  try {
    await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
};

const createTables = async () => {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      mobile TEXT NOT NULL,
      invite_code TEXT UNIQUE,
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
    CREATE TABLE IF NOT EXISTS toon_subscriptions (
      user_id INTEGER NOT NULL,
      level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
      amount INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('payment_required', 'active')),
      deposit_id INTEGER UNIQUE,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, level),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (deposit_id) REFERENCES deposit_requests(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS toon_reward_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      level INTEGER NOT NULL,
      claim_date TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, level, claim_date),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS toon_watch_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      level INTEGER NOT NULL,
      watch_date TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, level, watch_date),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  await tryAddColumn('toon_watch_sessions', 'completed_at', 'TEXT');

  await run(`
    CREATE TABLE IF NOT EXISTS fortune_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL COLLATE NOCASE UNIQUE,
      amount INTEGER NOT NULL CHECK (amount > 0),
      max_redemptions INTEGER NOT NULL DEFAULT 10 CHECK (max_redemptions > 0),
      redeemed_by INTEGER,
      redeemed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (redeemed_by) REFERENCES users(id)
    )
  `);

  await tryAddColumn('fortune_codes', 'max_redemptions', 'INTEGER NOT NULL DEFAULT 10');

  await run(`
    CREATE TABLE IF NOT EXISTS fortune_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fortune_code_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      redeemed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (fortune_code_id, user_id),
      FOREIGN KEY (fortune_code_id) REFERENCES fortune_codes(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);
  await run(
    `INSERT OR IGNORE INTO fortune_redemptions (fortune_code_id, user_id, redeemed_at)
     SELECT id, redeemed_by, COALESCE(redeemed_at, created_at)
     FROM fortune_codes WHERE redeemed_by IS NOT NULL`
  );

  await tryAddColumn('users', 'referred_by', 'TEXT');
  await tryAddColumn('users', 'role', "TEXT NOT NULL DEFAULT 'client'");
  await tryAddColumn('withdrawal_requests', 'account_provider', 'TEXT');
  await tryAddColumn('withdrawal_requests', 'account_name', 'TEXT');
  await tryAddColumn('withdrawal_requests', 'account_number', 'TEXT');
  await tryAddColumn('deposit_requests', 'payer_number', 'TEXT');

  await run(`
    CREATE TABLE IF NOT EXISTS sms_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT,
      body TEXT NOT NULL,
      parsed_amount REAL,
      parsed_payer TEXT,
      parsed_reference TEXT,
      action TEXT NOT NULL DEFAULT 'ignored',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code)');
  } catch (error) {
    // Existing databases may hold duplicate invite codes; regenerate them below and retry.
    const duplicates = await all(
      `SELECT invite_code FROM users WHERE invite_code IS NOT NULL
       GROUP BY invite_code HAVING COUNT(*) > 1`
    );
    for (const duplicate of duplicates) {
      for (const row of await all('SELECT id FROM users WHERE invite_code = ? AND id > (SELECT MIN(id) FROM users WHERE invite_code = ?)', [duplicate.invite_code, duplicate.invite_code])) {
        await run('UPDATE users SET invite_code = ? WHERE id = ?', [await generateInviteCode(), row.id]);
      }
    }
    await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code)');
  }
};

const generateInviteCode = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!await get('SELECT id FROM users WHERE invite_code = ?', [code])) return code;
  }
  return `X${Date.now().toString(36).toUpperCase().slice(-7)}`;
};

const generateFortuneCode = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = `FORT-${randomBytes(4).toString('hex').toUpperCase()}`;
    if (!await get('SELECT id FROM fortune_codes WHERE code = ?', [code])) return code;
  }
  throw new Error('Unable to generate a unique fortune code.');
};

const ensureAdminAccount = async () => {
  if (await get("SELECT id FROM users WHERE role = 'admin' LIMIT 1")) return;

  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  if (await get('SELECT id FROM users WHERE username = ?', [adminUsername])) return;

  const adminPassword = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  await run(
    `INSERT INTO users (username, password_hash, full_name, email, mobile, invite_code, pin_hash, role)
     VALUES (?, ?, 'XPLODE Admin', ?, ?, ?, ?, 'admin')`,
    [
      adminUsername,
      bcrypt.hashSync(adminPassword, 10),
      process.env.ADMIN_EMAIL || 'admin@xplode.local',
      process.env.ADMIN_MOBILE || '0000000000',
      `ADM-${randomBytes(3).toString('hex').toUpperCase()}`,
      bcrypt.hashSync(process.env.ADMIN_PIN || '00000', 10)
    ]
  );
  if (process.env.ADMIN_PASSWORD) {
    console.log(`Admin account ready — sign in as "${adminUsername}".`);
  } else {
    console.log(`\n  Admin account created — username: ${adminUsername}  password: ${adminPassword}`);
    console.log('  Save it now; it is only printed once.\n');
  }
};

const initializeDatabase = async () => {
  let schemaVersion = 0;
  if (remoteDatabaseEnabled) {
    try {
      const version = await get("SELECT value FROM app_meta WHERE key = 'schema_version'");
      schemaVersion = Number(version?.value) || 0;
    } catch (error) {
      if (!String(error.message).toLowerCase().includes('no such table')) throw error;
    }
  }

  if (!remoteDatabaseEnabled || schemaVersion < DATABASE_SCHEMA_VERSION) {
    await createTables();
    await tryAddColumn('users', 'role', "TEXT NOT NULL DEFAULT 'client'");
    await ensureAdminAccount();
    if (remoteDatabaseEnabled) {
      await run('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      await run(
        `INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [String(DATABASE_SCHEMA_VERSION)]
      );
    }
  }
};

await initializeDatabase();

const sanitizeUser = (user) => {
  if (!user) return null;
  const { password_hash, pin_hash, ...safe } = user;
  return safe;
};

const getWallet = async (userId) => {
  return await get('SELECT * FROM wallets WHERE user_id = ?', [userId]) || { user_id: userId, withdrawable: 0, total: 0, pending: 0 };
};

const createWalletIfMissing = async (userId) => {
  await run(
    `INSERT INTO wallets (user_id, withdrawable, total, pending) VALUES (?, 0, 0, 0)
     ON CONFLICT(user_id) DO NOTHING`,
    [userId]
  );
};

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET || DEV_JWT_SECRET);
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

const adminMiddleware = async (req, res, next) => {
  // Admin account session: a valid JWT whose user has the admin role.
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (bearerToken) {
    try {
      const payload = jwt.verify(bearerToken, JWT_SECRET || DEV_JWT_SECRET);
      const adminUser = await get('SELECT role FROM users WHERE id = ?', [payload.userId]);
      if (adminUser?.role === 'admin') {
        return next();
      }
    } catch (error) {
      // Fall through to admin-key authentication.
    }
  }

  // Shared-key fallback (also used by the SMS auto-forwarder).
  if (!ADMIN_KEY) {
    return res.status(503).json({ success: false, message: 'Admin authorization required. Sign in with the admin account or set the ADMIN_KEY environment variable.' });
  }

  const providedKey = Buffer.from(String(req.get('X-Admin-Key') || req.get('X-Fortune-Admin-Key') || ''));
  const configuredKey = Buffer.from(ADMIN_KEY);
  if (providedKey.length !== configuredKey.length || !timingSafeEqual(providedKey, configuredKey)) {
    return res.status(401).json({ success: false, message: 'Admin authorization required.' });
  }

  next();
};

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all']) {
  const register = app[method].bind(app);
  app[method] = (...args) => register(...args.map((argument, index) => index > 0 && typeof argument === 'function' ? asyncHandler(argument) : argument));
}

app.get('/api/health', async (req, res) => {
  await get('SELECT 1 AS database_ready');
  res.json({ ok: true, message: 'XPLODE backend is running.' });
});

app.get('/api/config', (req, res) => {
  return res.json({ success: true, depositAccounts: DEPOSIT_ACCOUNTS });
});

app.post('/api/login', authLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  const user = await get('SELECT * FROM users WHERE username = ?', [username]);
  const validPassword = user && bcrypt.compareSync(password, user.password_hash);
  if (!validPassword) {
    return res.status(401).json({ success: false, message: 'Incorrect username or password.' });
  }

  await createWalletIfMissing(user.id);
  const wallet = await getWallet(user.id);
  const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET || DEV_JWT_SECRET, { expiresIn: '7d' });

  return res.json({
    success: true,
    message: 'Login successful.',
    token,
    role: user.role === 'admin' ? 'admin' : 'client',
    user: sanitizeUser(user),
    wallet
  });
});

app.post('/api/register', authLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim();
  const mobile = String(req.body.mobile || '').trim();
  const inviteCodeInput = String(req.body.inviteCode || '').trim();
  const password = String(req.body.password || '');
  const pin = String(req.body.pin || '');

  if (!username || !email || !mobile || !password || !pin) {
    return res.status(400).json({ success: false, message: 'Please complete all required fields.' });
  }

  if (!/^[A-Za-z0-9_-]{3,24}$/.test(username)) {
    return res.status(400).json({ success: false, message: 'Username must be 3-24 letters, numbers, hyphens, or underscores.' });
  }

  if (!/^[0-9]{5}$/.test(pin)) {
    return res.status(400).json({ success: false, message: 'The withdrawal PIN must be exactly 5 digits.' });
  }

  if (mobile.replace(/\D/g, '').length < 9) {
    return res.status(400).json({ success: false, message: 'Enter a valid mobile money number.' });
  }

  const inviter = inviteCodeInput ? await get('SELECT id FROM users WHERE invite_code = ?', [inviteCodeInput]) : null;
  if (inviteCodeInput && !inviter) {
    return res.status(400).json({ success: false, message: 'Invalid invite code.' });
  }

  const existingUser = await get('SELECT id FROM users WHERE username = ?', [username]);
  if (existingUser) {
    return res.status(409).json({ success: false, message: 'Username already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const pinHash = bcrypt.hashSync(pin, 10);
  const inviteCode = await generateInviteCode();

  const registerTransaction = db.transaction(async () => {
    const userResult = await run(
      `INSERT INTO users (username, password_hash, full_name, email, mobile, invite_code, pin_hash, referred_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, passwordHash, username, email, mobile, inviteCode, pinHash, inviter ? inviter.id : null]
    );

    await run(
      `INSERT INTO wallets (user_id, withdrawable, total, pending) VALUES (?, 0, 0, 0)`,
      [userResult.lastInsertRowid]
    );

    return userResult.lastInsertRowid;
  });

  const userId = await registerTransaction();

  const token = jwt.sign({ userId, username }, JWT_SECRET || DEV_JWT_SECRET, { expiresIn: '7d' });
  const createdUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
  const wallet = await getWallet(userId);

  return res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    token,
    user: sanitizeUser(createdUser),
    wallet
  });
});

app.get('/api/me', authMiddleware, async (req, res) => {
  await createWalletIfMissing(req.user.id);
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
  await createWalletIfMissing(req.user.id);
  const wallet = await getWallet(req.user.id);
  return res.json({ success: true, wallet });
});

app.post('/api/wallet/deposit', authMiddleware, async (req, res) => {
  const amount = Number(req.body.amount);
  const provider = String(req.body.provider || '').trim();
  const transactionId = String(req.body.transactionId || '').trim();
  const payerNumber = String(req.body.payerNumber || '').replace(/\D/g, '').slice(-9);

  if (!Number.isSafeInteger(amount) || amount < 10000) {
    return res.status(400).json({ success: false, message: 'Minimum deposit is UGX 10,000.' });
  }

  if (!Object.prototype.hasOwnProperty.call(DEPOSIT_ACCOUNTS, provider)) {
    return res.status(400).json({ success: false, message: 'Choose Airtel Money or MTN Mobile Money.' });
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
      `INSERT INTO deposit_requests (user_id, provider, amount, transaction_id, status, payer_number)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
      [req.user.id, provider, amount, transactionId, payerNumber || null]
    );
    await run(
      `UPDATE toon_subscriptions SET deposit_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND amount = ? AND status = 'payment_required' AND deposit_id IS NULL
         AND level = (SELECT MIN(level) FROM toon_subscriptions
                      WHERE user_id = ? AND amount = ? AND status = 'payment_required' AND deposit_id IS NULL)`,
      [request.lastInsertRowid, req.user.id, amount, req.user.id, amount]
    );
    const deposit = await get('SELECT id, provider, amount, transaction_id, status, created_at FROM deposit_requests WHERE id = ?', [request.lastInsertRowid]);
    return res.status(201).json({
      success: true,
      message: 'Deposit submitted for manual verification. Your balance will update after the payment is confirmed.',
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
  const accountProvider = String(req.body.accountProvider || '').trim();
  const accountName = String(req.body.accountName || '').trim();
  const accountNumber = String(req.body.accountNumber || '').trim();

  if (!Number.isSafeInteger(amount) || amount < 500) {
    return res.status(400).json({ success: false, message: 'Minimum withdrawal is UGX 500.' });
  }

  if (!['MTN Mobile Money', 'Airtel Money'].includes(accountProvider)) {
    return res.status(400).json({ success: false, message: 'Choose MTN Mobile Money or Airtel Money.' });
  }

  if (accountName.length < 3 || accountName.length > 60) {
    return res.status(400).json({ success: false, message: 'Enter the account holder name.' });
  }

  if (!/^0\d{9}$/.test(accountNumber)) {
    return res.status(400).json({ success: false, message: 'Enter a valid mobile money number, e.g. 0770123456.' });
  }

  const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const validPin = bcrypt.compareSync(pin, user.pin_hash);
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

  const lastRequest = await get(
    'SELECT created_at FROM withdrawal_requests WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    [req.user.id]
  );
  if (lastRequest) {
    const lastTime = new Date(`${String(lastRequest.created_at).replace(' ', 'T')}Z`).getTime();
    if (!Number.isNaN(lastTime)) {
      const elapsed = Date.now() - lastTime;
      if (elapsed < WITHDRAWAL_COOLDOWN_MS) {
        const hoursLeft = Math.ceil((WITHDRAWAL_COOLDOWN_MS - elapsed) / (60 * 60 * 1000));
        return res.status(429).json({
          success: false,
          message: `One withdrawal is allowed every 24 hours. Try again in about ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}.`
        });
      }
    }
  }

  const request = await run(
    `INSERT INTO withdrawal_requests (user_id, amount, status, account_provider, account_name, account_number)
     VALUES (?, ?, 'pending', ?, ?, ?)`,
    [req.user.id, amount, accountProvider, accountName, accountNumber]
  );
  const withdrawal = await get(
    'SELECT id, amount, status, account_provider, account_name, account_number, created_at FROM withdrawal_requests WHERE id = ?',
    [request.lastInsertRowid]
  );

  return res.status(201).json({
    success: true,
    message: 'Withdrawal request submitted for review. Your balance will update after it is processed.',
    withdrawal,
    available: available - amount
  });
});

app.get('/api/withdrawals', authMiddleware, async (req, res) => {
  const [rows, pending, wallet, lastRequest] = await Promise.all([
    all(
      `SELECT id, amount, status, account_provider, account_name, account_number, created_at FROM withdrawal_requests WHERE user_id = ?
       UNION ALL
       SELECT id, amount, status, NULL AS account_provider, NULL AS account_name, NULL AS account_number, created_at FROM transactions WHERE user_id = ? AND type = 'withdrawal'
       ORDER BY created_at DESC LIMIT 20`,
      [req.user.id, req.user.id]
    ),
    get(
      `SELECT COALESCE(SUM(amount), 0) AS amount
       FROM withdrawal_requests WHERE user_id = ? AND status = 'pending'`,
      [req.user.id]
    ),
    getWallet(req.user.id),
    get(
      'SELECT created_at FROM withdrawal_requests WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      [req.user.id]
    )
  ]);
  const pendingWithdrawals = Number(pending.amount) || 0;

  let nextWithdrawalAt = null;
  if (lastRequest) {
    const lastTime = new Date(`${String(lastRequest.created_at).replace(' ', 'T')}Z`).getTime();
    if (!Number.isNaN(lastTime)) {
      const nextTime = lastTime + WITHDRAWAL_COOLDOWN_MS;
      if (nextTime > Date.now()) nextWithdrawalAt = new Date(nextTime).toISOString();
    }
  }

  return res.json({
    success: true,
    withdrawals: rows,
    available: Math.max(0, Number(wallet.withdrawable) - pendingWithdrawals),
    pending: (Number(wallet.pending) || 0) + pendingWithdrawals,
    nextWithdrawalAt
  });
});

app.get('/api/team', authMiddleware, async (req, res) => {
  const [directResult, level2Result] = await Promise.all([
    get('SELECT COUNT(*) AS count FROM users WHERE referred_by = ?', [req.user.id]),
    get(
      `SELECT COUNT(*) AS count FROM users AS l2
       JOIN users AS l1 ON l1.id = l2.referred_by
       WHERE l1.referred_by = ?`,
      [req.user.id]
    )
  ]);
  const direct = Number(directResult.count);
  const level2 = Number(level2Result.count);

  return res.json({
    success: true,
    team: {
      direct,
      level2,
      total: direct + level2
    }
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

app.post('/api/rewards/claim', authMiddleware, (req, res) => {
  return res.status(409).json({
    success: false,
    eligible: false,
    message: 'No verified reward is available for this account yet. Referral eligibility is not connected.'
  });
});

app.get('/api/toonhub/status', authMiddleware, async (req, res) => {
  const today = getKampalaDate();
  const [activeRows, pendingRows, claimedRows, watchedRows, startedRows] = await Promise.all([
    all("SELECT level FROM toon_subscriptions WHERE user_id = ? AND status = 'active'", [req.user.id]),
    all("SELECT level FROM toon_subscriptions WHERE user_id = ? AND status = 'payment_required'", [req.user.id]),
    all('SELECT level FROM toon_reward_claims WHERE user_id = ? AND claim_date = ?', [req.user.id, today]),
    all('SELECT level FROM toon_watch_sessions WHERE user_id = ? AND watch_date = ? AND completed_at IS NOT NULL', [req.user.id, today]),
    all('SELECT level FROM toon_watch_sessions WHERE user_id = ? AND watch_date = ?', [req.user.id, today])
  ]);
  const activeLevels = new Set(activeRows.map((row) => Number(row.level)));
  const pendingLevels = new Set(pendingRows.map((row) => Number(row.level)));
  const claimedLevels = new Set(claimedRows.map((row) => Number(row.level)));
  const watchedLevels = new Set(watchedRows.map((row) => Number(row.level)));
  const startedLevels = new Set(startedRows.map((row) => Number(row.level)));
  const levels = Object.entries(TOON_LEVELS).map(([level, details]) => ({
    level: Number(level),
    amount: details.amount,
    reward: details.reward,
    active: activeLevels.has(Number(level)),
    paymentPending: pendingLevels.has(Number(level)),
    startedToday: startedLevels.has(Number(level)),
    watchedToday: watchedLevels.has(Number(level)),
    claimedToday: claimedLevels.has(Number(level))
  }));
  return res.json({ success: true, levels });
});

app.post('/api/toonhub/watch', authMiddleware, async (req, res) => {
  const level = Number(req.body.level);
  if (!TOON_LEVELS[level] || !Number.isInteger(level)) {
    return res.status(400).json({ success: false, message: 'Choose a valid Toonhub level.' });
  }

  const watch = await db.transaction(async () => {
    const subscription = await get(
      "SELECT status FROM toon_subscriptions WHERE user_id = ? AND level = ?",
      [req.user.id, level]
    );
    if (subscription?.status !== 'active') return { error: 'This Toonhub level is locked until its payment is approved.' };

    const watchDate = getKampalaDate();
    const priorWatch = await get(
      'SELECT id, completed_at FROM toon_watch_sessions WHERE user_id = ? AND level = ? AND watch_date = ?',
      [req.user.id, level, watchDate]
    );
    if (priorWatch?.completed_at) return { error: 'You have already watched this level today.' };
    if (priorWatch) return { resume: true };

    await run(
      'INSERT INTO toon_watch_sessions (user_id, level, watch_date) VALUES (?, ?, ?)',
      [req.user.id, level, watchDate]
    );
    return { success: true };
  })();

  if (watch.error) return res.status(409).json({ success: false, message: watch.error });
  return res.status(watch.resume ? 200 : 201).json({
    success: true,
    message: watch.resume ? 'Resume your video to finish today’s watch.' : 'Your daily watch is ready.'
  });
});

app.post('/api/toonhub/complete', authMiddleware, async (req, res) => {
  const level = Number(req.body.level);
  if (!TOON_LEVELS[level] || !Number.isInteger(level)) {
    return res.status(400).json({ success: false, message: 'Choose a valid Toonhub level.' });
  }

  const watchDate = getKampalaDate();
  const watch = await get(
    `SELECT id, created_at, completed_at FROM toon_watch_sessions
     WHERE user_id = ? AND level = ? AND watch_date = ?`,
    [req.user.id, level, watchDate]
  );
  if (!watch) {
    return res.status(409).json({ success: false, message: 'Start today’s video before claiming its reward.' });
  }
  if (watch.completed_at) {
    return res.json({ success: true, message: 'Today’s video is already complete.' });
  }
  const startedAt = new Date(`${String(watch.created_at).replace(' ', 'T')}Z`).getTime();
  if (Number.isNaN(startedAt) || Date.now() - startedAt < TOON_WATCH_SECONDS * 1000) {
    return res.status(409).json({
      success: false,
      message: `Keep watching for ${TOON_WATCH_SECONDS} seconds before claiming your reward.`
    });
  }
  const result = await run(
    `UPDATE toon_watch_sessions SET completed_at = CURRENT_TIMESTAMP
     WHERE id = ? AND completed_at IS NULL
       AND EXISTS (SELECT 1 FROM toon_subscriptions WHERE user_id = ? AND level = ? AND status = 'active')`,
    [watch.id, req.user.id, level]
  );
  if (result.changes !== 1) {
    return res.status(409).json({ success: false, message: 'No unfinished authorized video watch was found for today.' });
  }
  return res.json({ success: true, message: 'Video completed. Today’s reward is ready to claim.' });
});

app.post('/api/toonhub/subscribe', authMiddleware, async (req, res) => {
  const level = Number(req.body.level);
  const details = TOON_LEVELS[level];
  if (!details || !Number.isInteger(level)) {
    return res.status(400).json({ success: false, message: 'Choose a valid Toonhub level.' });
  }

  const existing = await get('SELECT status FROM toon_subscriptions WHERE user_id = ? AND level = ?', [req.user.id, level]);
  if (existing?.status === 'active') {
    return res.json({ success: true, status: 'active', message: `VIP ${level} is already active.` });
  }

  const matchedDeposit = await get(
    `SELECT id, status FROM deposit_requests
     WHERE user_id = ? AND amount = ? AND status IN ('pending', 'confirmed')
     ORDER BY CASE status WHEN 'confirmed' THEN 0 ELSE 1 END, id DESC LIMIT 1`,
    [req.user.id, details.amount]
  );
  const status = matchedDeposit?.status === 'confirmed' ? 'active' : 'payment_required';
  const subscription = await db.transaction(async () => {
    if (status === 'active' && matchedDeposit) {
      const alreadyReserved = await get(
        `SELECT id FROM transactions
         WHERE user_id = ? AND type = 'toon_subscription' AND amount = ? AND status = 'reserved'
           AND id IN (SELECT id FROM transactions WHERE user_id = ? ORDER BY id DESC) LIMIT 1`,
        [req.user.id, details.amount, req.user.id]
      );
      if (!alreadyReserved) {
        const wallet = await getWallet(req.user.id);
        if (Number(wallet.withdrawable) < details.amount) {
          return { error: 'This approved deposit has already been spent or withdrawn and cannot activate this level.' };
        }
        await run(
          'UPDATE wallets SET withdrawable = withdrawable - ?, total = total - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
          [details.amount, details.amount, req.user.id]
        );
        await run(
          'INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)',
          [req.user.id, 'toon_subscription', -details.amount, 'reserved']
        );
      }
    }
    // One active level per client: when a new level activates, the previous
    // one is locked until its payment is approved again.
    if (status === 'active') {
      await run(
        `UPDATE toon_subscriptions SET status = 'payment_required', deposit_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND level != ? AND status = 'active'`,
        [req.user.id, level]
      );
    }
    await run(
      `INSERT INTO toon_subscriptions (user_id, level, amount, status, deposit_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, level) DO UPDATE SET
         amount = excluded.amount,
         status = CASE WHEN toon_subscriptions.status = 'active' THEN 'active' ELSE excluded.status END,
         deposit_id = CASE WHEN toon_subscriptions.status = 'active' THEN toon_subscriptions.deposit_id ELSE excluded.deposit_id END,
         updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, level, details.amount, status, matchedDeposit?.id || null]
    );
    return { success: true };
  })();
  if (subscription.error) return res.status(409).json({ success: false, message: subscription.error });

  return res.json({
    success: true,
    status,
    message: status === 'active'
      ? `VIP ${level} activated from your approved UGX ${details.amount.toLocaleString()} deposit.`
      : `VIP ${level} is pending. Submit a UGX ${details.amount.toLocaleString()} deposit and wait for admin approval.`
  });
});

app.post('/api/toonhub/claim', authMiddleware, async (req, res) => {
  const level = Number(req.body.level);
  const details = TOON_LEVELS[level];
  if (!details || !Number.isInteger(level)) {
    return res.status(400).json({ success: false, message: 'Choose a valid Toonhub level.' });
  }

  const claim = await db.transaction(async () => {
    const subscription = await get(
      'SELECT status FROM toon_subscriptions WHERE user_id = ? AND level = ?',
      [req.user.id, level]
    );
    if (subscription?.status !== 'active') return { error: 'This Toonhub level is locked until its payment is approved.' };

    const claimDate = getKampalaDate();
    const watched = await get(
      'SELECT id FROM toon_watch_sessions WHERE user_id = ? AND level = ? AND watch_date = ? AND completed_at IS NOT NULL',
      [req.user.id, level, claimDate]
    );
    if (!watched) return { error: 'Watch today’s video before claiming this level’s reward.' };

    const alreadyClaimed = await get(
      'SELECT id FROM toon_reward_claims WHERE user_id = ? AND level = ? AND claim_date = ?',
      [req.user.id, level, claimDate]
    );
    if (alreadyClaimed) return { error: 'You have already claimed today’s reward for this level.' };

    await run(
      'INSERT INTO toon_reward_claims (user_id, level, claim_date, amount) VALUES (?, ?, ?, ?)',
      [req.user.id, level, claimDate, details.reward]
    );
    await run(
      'UPDATE wallets SET withdrawable = withdrawable + ?, total = total + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [details.reward, details.reward, req.user.id]
    );
    await run(
      'INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)',
      [req.user.id, 'toonhub_reward', details.reward, 'credited']
    );
    return { amount: details.reward, wallet: await getWallet(req.user.id) };
  })();

  if (claim.error) return res.status(409).json({ success: false, message: claim.error });
  return res.status(201).json({
    success: true,
    message: `UGX ${claim.amount.toLocaleString()} daily reward credited.`,
    amount: claim.amount,
    wallet: claim.wallet
  });
});

app.get('/api/admin/deposits', adminMiddleware, async (req, res) => {
  const rows = await all(
    `SELECT d.id, d.user_id, d.provider, d.amount, d.transaction_id, d.status, d.created_at,
            u.username
     FROM deposit_requests d JOIN users u ON u.id = d.user_id
     ORDER BY d.status = 'pending' DESC, d.id DESC LIMIT 100`
  );
  return res.json({ success: true, deposits: rows });
});

// Core settlement used by the admin queue and the SMS auto-credit engine.
// 'confirmed' credits the wallet atomically; 'rejected' only flips the status.
const settleDepositById = async (id, nextStatus) => {
  return await db.transaction(async () => {
    const deposit = await get('SELECT id, user_id, provider, amount, status, transaction_id, payer_number FROM deposit_requests WHERE id = ?', [id]);
    if (!deposit) return { error: 404, message: 'Deposit request not found.' };
    if (deposit.status !== 'pending') return { error: 409, message: `This deposit was already ${deposit.status}.` };

    await run('UPDATE deposit_requests SET status = ? WHERE id = ?', [nextStatus, id]);

    let activatedLevel = null;
    if (nextStatus === 'confirmed') {
      await createWalletIfMissing(deposit.user_id);
      const subscriptionDeposit = await get(
        `SELECT level, status FROM toon_subscriptions
         WHERE user_id = ? AND deposit_id = ? AND status IN ('payment_required', 'active')`,
        [deposit.user_id, id]
      );
      if (subscriptionDeposit && subscriptionDeposit.status === 'payment_required') {
        // Subscription payments are NOT wallet credit: approving them activates
        // the level, and the money is recorded as reserved, never withdrawable.
        activatedLevel = subscriptionDeposit.level;
        await run(
          'INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)',
          [deposit.user_id, 'toon_subscription', -deposit.amount, 'reserved']
        );
      }
      if (!subscriptionDeposit) {
        await run(
          'UPDATE wallets SET withdrawable = withdrawable + ?, total = total + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
          [deposit.amount, deposit.amount, deposit.user_id]
        );
        await run(
          'INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)',
          [deposit.user_id, 'deposit', deposit.amount, 'confirmed']
        );
      }
      if (activatedLevel) {
        // One active level per client: the newly approved level locks the rest.
        await run(
          `UPDATE toon_subscriptions SET status = 'payment_required', deposit_id = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND level != ? AND status = 'active'`,
          [deposit.user_id, activatedLevel]
        );
      }
      await run(
        `UPDATE toon_subscriptions SET status = 'active', updated_at = CURRENT_TIMESTAMP
         WHERE deposit_id = ? AND user_id = ? AND amount = ?`,
        [id, deposit.user_id, deposit.amount]
      );
    }
    return { deposit, activatedLevel };
  })();
};

app.post('/api/admin/deposits/:id/approve', adminMiddleware, async (req, res) => {
  const result = await settleDepositById(Number(req.params.id), 'confirmed');
  if (result.error) {
    return res.status(result.error).json({ success: false, message: result.message });
  }
  const username = (await get('SELECT username FROM users WHERE id = ?', [result.deposit.user_id]))?.username || 'unknown';
  const approvalMessage = result.activatedLevel
    ? `Deposit #${result.deposit.id} confirmed. UGX ${Number(result.deposit.amount).toLocaleString()} VIP ${result.activatedLevel} subscription activated for @${username} (reserved, not withdrawable).`
    : `Deposit #${result.deposit.id} confirmed. UGX ${Number(result.deposit.amount).toLocaleString()} credited to @${username}.`;
  return res.json({
    success: true,
    message: approvalMessage,
    deposit: { ...result.deposit, status: 'confirmed' }
  });
});

app.post('/api/admin/deposits/:id/reject', adminMiddleware, async (req, res) => {
  const result = await settleDepositById(Number(req.params.id), 'rejected');
  if (result.error) {
    return res.status(result.error).json({ success: false, message: result.message });
  }
  return res.json({
    success: true,
    message: `Deposit #${result.deposit.id} rejected. The transaction ID was not found in your ${result.deposit.provider} statement.`,
    deposit: { ...result.deposit, status: 'rejected' }
  });
});

// --- Admin dashboard data & withdrawal payouts ------------------------------
app.get('/api/admin/stats', adminMiddleware, async (req, res) => {
  const stats = await get(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM deposit_requests WHERE status = 'pending') AS pending_deposit_count,
      (SELECT COALESCE(SUM(amount), 0) FROM deposit_requests WHERE status = 'pending') AS pending_deposit_amount,
      (SELECT COUNT(*) FROM withdrawal_requests WHERE status = 'pending') AS pending_withdrawal_count,
      (SELECT COALESCE(SUM(amount), 0) FROM withdrawal_requests WHERE status = 'pending') AS pending_withdrawal_amount,
      (SELECT COALESCE(SUM(amount), 0) FROM deposit_requests WHERE status = 'confirmed') AS confirmed_deposits,
      (SELECT COALESCE(SUM(amount), 0) FROM withdrawal_requests WHERE status = 'paid') AS paid_withdrawals,
      (SELECT COUNT(DISTINCT f.id) FROM fortune_codes f LEFT JOIN fortune_redemptions r ON r.fortune_code_id = f.id) AS fortune_issued,
      (SELECT COALESCE(SUM(f.amount), 0) FROM fortune_codes f LEFT JOIN fortune_redemptions r ON r.fortune_code_id = f.id) AS fortune_redeemed,
      (SELECT COUNT(*) FROM sms_log WHERE action = 'no_match') AS unmatched_sms
  `);

  return res.json({
    success: true,
    stats: {
      users: stats.users,
      pendingDeposits: { count: stats.pending_deposit_count, amount: Number(stats.pending_deposit_amount) },
      pendingWithdrawals: { count: stats.pending_withdrawal_count, amount: Number(stats.pending_withdrawal_amount) },
      confirmedDeposits: Number(stats.confirmed_deposits),
      paidWithdrawals: Number(stats.paid_withdrawals),
      fortuneCodes: { issued: stats.fortune_issued, redeemed: Number(stats.fortune_redeemed) },
      unmatchedSms: stats.unmatched_sms
    }
  });
});

app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  const rows = await all(
    `SELECT u.id, u.username, u.role, u.full_name, u.email, u.mobile, u.invite_code, u.referred_by, u.created_at,
            w.withdrawable, w.total, w.pending
     FROM users u LEFT JOIN wallets w ON w.user_id = u.id
     ORDER BY u.id DESC LIMIT 200`
  );
  return res.json({ success: true, users: rows });
});

// Full operator control: manually correct a client's balance. A positive
// amount credits the wallet, a negative amount debits it. Every adjustment is
// written to the transactions ledger so both sides keep an audit trail.
const MAX_BALANCE_ADJUSTMENT = 100000000;

app.post('/api/admin/users/:id/balance', adminMiddleware, async (req, res) => {
  const userId = Number(req.params.id);
  const amount = Number(req.body.amount);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid user.' });
  }
  if (!Number.isSafeInteger(amount) || amount === 0) {
    return res.status(400).json({ success: false, message: 'Enter a non-zero whole UGX amount (use a minus sign to debit).' });
  }
  if (Math.abs(amount) > MAX_BALANCE_ADJUSTMENT) {
    return res.status(400).json({ success: false, message: 'That adjustment is too large.' });
  }

  const target = await get('SELECT id, username, role FROM users WHERE id = ?', [userId]);
  if (!target) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }
  if (target.role === 'admin') {
    return res.status(409).json({ success: false, message: 'Admin accounts do not hold a client wallet.' });
  }

  await createWalletIfMissing(userId);
  const adjustment = await db.transaction(async () => {
    const wallet = await getWallet(userId);
    if (Number(wallet.withdrawable) + amount < 0) {
      return { error: `@${target.username} only has UGX ${Number(wallet.withdrawable).toLocaleString()} available, so the debit was cancelled.` };
    }
    await run(
      'UPDATE wallets SET withdrawable = withdrawable + ?, total = total + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [amount, amount, userId]
    );
    await run(
      'INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)',
      [userId, 'admin_adjustment', amount, 'adjusted']
    );
    return { wallet: await getWallet(userId) };
  })();

  if (adjustment.error) {
    return res.status(409).json({ success: false, message: adjustment.error });
  }
  return res.json({
    success: true,
    message: `${amount > 0 ? 'Credited' : 'Debited'} UGX ${Math.abs(amount).toLocaleString()} ${amount > 0 ? 'to' : 'from'} @${target.username}.`,
    wallet: adjustment.wallet
  });
});

// Removes a client and every record tied to them. Admin accounts are protected.
app.delete('/api/admin/users/:id', adminMiddleware, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid user.' });
  }
  const target = await get('SELECT id, username, role FROM users WHERE id = ?', [userId]);
  if (!target) {
    return res.status(404).json({ success: false, message: 'User not found.' });
  }
  if (target.role === 'admin') {
    return res.status(409).json({ success: false, message: 'The admin account cannot be deleted.' });
  }

  await db.transaction(async () => {
    await run('UPDATE fortune_codes SET redeemed_by = NULL WHERE redeemed_by = ?', [userId]);
    await run('DELETE FROM fortune_redemptions WHERE user_id = ?', [userId]);
    await run('DELETE FROM toon_reward_claims WHERE user_id = ?', [userId]);
    await run('DELETE FROM toon_watch_sessions WHERE user_id = ?', [userId]);
    await run('DELETE FROM toon_subscriptions WHERE user_id = ?', [userId]);
    await run('DELETE FROM plan_selections WHERE user_id = ?', [userId]);
    await run('DELETE FROM reward_claims WHERE user_id = ?', [userId]);
    await run('DELETE FROM deposit_requests WHERE user_id = ?', [userId]);
    await run('DELETE FROM withdrawal_requests WHERE user_id = ?', [userId]);
    await run('DELETE FROM transactions WHERE user_id = ?', [userId]);
    await run('DELETE FROM wallets WHERE user_id = ?', [userId]);
    await run("DELETE FROM users WHERE id = ? AND role != 'admin'", [userId]);
  })();

  return res.json({ success: true, message: `@${target.username} and all their data were removed from the system.` });
});

app.get('/api/admin/withdrawals', adminMiddleware, async (req, res) => {
  const rows = await all(
    `SELECT r.id, r.user_id, r.amount, r.status, r.account_provider, r.account_name, r.account_number, r.created_at,
            u.username
     FROM withdrawal_requests r JOIN users u ON u.id = r.user_id
     ORDER BY r.status = 'pending' DESC, r.id DESC LIMIT 100`
  );
  return res.json({ success: true, withdrawals: rows });
});

// Payout duties. Approve = you have SENT the money from your mobile money
// account to the customer: wallet is debited and the request is closed 'paid'.
// Reject = the request cannot be honored: the reservation releases, no balances
// move (they were never debited).
const settleWithdrawalById = async (id, nextStatus) => {
  return await db.transaction(async () => {
    const withdrawal = await get(
      'SELECT id, user_id, amount, status, account_provider, account_number FROM withdrawal_requests WHERE id = ?',
      [id]
    );
    if (!withdrawal) return { error: 404, message: 'Withdrawal request not found.' };
    if (withdrawal.status !== 'pending') return { error: 409, message: `This withdrawal was already ${withdrawal.status}.` };

    if (nextStatus === 'paid') {
      const update = await run(
        'UPDATE wallets SET withdrawable = withdrawable - ?, total = total - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND withdrawable >= ?',
        [withdrawal.amount, withdrawal.amount, withdrawal.user_id, withdrawal.amount]
      );
      if (update.changes !== 1) return { error: 409, message: 'The wallet no longer holds enough funds for this payout.' };
      await run(
        'INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)',
        [withdrawal.user_id, 'withdrawal', withdrawal.amount, 'completed']
      );
    }

    await run('UPDATE withdrawal_requests SET status = ? WHERE id = ?', [nextStatus, id]);
    return { withdrawal };
  })();
};

app.post('/api/admin/withdrawals/:id/approve', adminMiddleware, async (req, res) => {
  const result = await settleWithdrawalById(Number(req.params.id), 'paid');
  if (result.error) {
    return res.status(result.error).json({ success: false, message: result.message });
  }
  return res.json({
    success: true,
    message: `Withdrawal #${result.withdrawal.id} paid out. UGX ${Number(result.withdrawal.amount).toLocaleString()} sent to ${result.withdrawal.account_provider} ${result.withdrawal.account_number}.`,
    withdrawal: { ...result.withdrawal, status: 'paid' }
  });
});

app.post('/api/admin/withdrawals/:id/reject', adminMiddleware, async (req, res) => {
  const result = await settleWithdrawalById(Number(req.params.id), 'rejected');
  if (result.error) {
    return res.status(result.error).json({ success: false, message: result.message });
  }
  return res.json({
    success: true,
    message: `Withdrawal #${result.withdrawal.id} rejected. The reserved amount is back in the user's available balance.`,
    withdrawal: { ...result.withdrawal, status: 'rejected' }
  });
});

app.get('/api/admin/sms', adminMiddleware, async (req, res) => {
  const rows = await all('SELECT id, sender, body, parsed_amount, parsed_payer, parsed_reference, action, created_at FROM sms_log ORDER BY id DESC LIMIT 50');
  return res.json({ success: true, messages: rows });
});

app.get('/api/admin/fortune-codes', adminMiddleware, async (req, res) => {
  const rows = await all(
    `SELECT f.code, f.amount, f.max_redemptions, f.redeemed_at, f.created_at,
            u.username AS redeemed_by,
            (SELECT COUNT(*) FROM fortune_redemptions r WHERE r.fortune_code_id = f.id) AS redeemed_count
     FROM fortune_codes f LEFT JOIN users u ON u.id = f.redeemed_by
     ORDER BY f.id DESC LIMIT 50`
  );
  return res.json({ success: true, codes: rows });
});

// --- SMS auto-credit engine -------------------------------------------------
// Forward payment SMSs from the operator's phone (Tasker/MacroDroid/Android
// auto-forwarder or the operator panel) to this endpoint. Each message is
// parsed for an amount + payer number and matched against the oldest pending
// deposit with the same amount and payer number. A match is credited
// automatically — no human action needed for routine deposits.
const digit = (value) => String(value || '').replace(/\D/g, '');

const normalizePayerNumber = (value) => {
  const digits = digit(value);
  if (!digits) return null;
  return digits.length > 9 ? digits.slice(-9) : digits.padStart(9, '0');
};

const parsePaymentSms = (sender, body) => {
  const text = `${sender || ''} ${body || ''}`;
  const isMtn = /(m-?tn|momote?|\*?165)/i.test(text);
  const isAirtel = /(airtel|airtel ?money|\*?185)/i.test(text);
  if (!isMtn && !isAirtel) return null;

  // Amount: prefer the figure right after "received/deposited" (the transfer
  // amount), NOT the account balance that usually appears later in the SMS.
  let amount = 0;
  const receivedMatch = text.match(/(?:received|deposited|got)\s*(?:an?\s*)?(?:amount\s*(?:of)?)?\s*:?\s*(?:UGX|UGHS?)?\s*([0-9][0-9,]*(?:\.\d+)?)/i);
  if (receivedMatch) {
    const candidate = Number(receivedMatch[1].replace(/,/g, ''));
    if (Number.isFinite(candidate)) amount = candidate;
  }
  if (amount <= 0) {
    const amountMatches = text.matchAll(/(?:UGX|UGHS?)\s*([0-9][0-9,]*(?:\.\d+)?)|([0-9][0-9,]*(?:\.\d+)?)\s*(?:UGX|UGHS?)/gi);
    for (const match of amountMatches) {
      const candidate = Number((match[1] || match[2] || '').replace(/,/g, ''));
      if (Number.isFinite(candidate) && candidate > amount) amount = candidate;
    }
  }
  if (amount <= 0) return null;

  // Payer: the "from 07XXXXXXXX" / "from 25677..." figure, not the receiver.
  let payer = null;
  const fromMatch = text.match(/from\s*:?\s*(\+?0?\d[\d\s-]{8,14}\d)/i)
    || text.match(/(?:from|sender)\s*(?:number)?\s*:?\s*(\+?0?\d[\d\s-]{8,14}\d)/i);
  if (fromMatch) payer = normalizePayerNumber(fromMatch[1]);
  if (!payer) {
    const anyPhone = text.match(/(\+?0?7\d[\d\s-]{7,12}\d)/);
    if (anyPhone) payer = normalizePayerNumber(anyPhone[1]);
  }

  // Reference: MTN "Financial Transaction ID: 123456789" / Airtel "TxnId: ...".
  const referenceMatch = text.match(/(?:Financial Transaction ID|Transaction ID|TxnId|Txn ID|Ref)\s*[:#]?\s*([A-Z0-9-]{5,})/i);
  const reference = referenceMatch ? referenceMatch[1].trim() : null;

  return { network: isMtn ? 'MTN Mobile Money' : 'Airtel Money', amount, payer, reference };
};

const autoCreditFromSms = async (parsed) => {
  return await db.transaction(async () => {
    const candidates = await all(
      `SELECT id, user_id, amount FROM deposit_requests
       WHERE status = 'pending' AND provider = ? AND amount = ?
       ORDER BY id ASC LIMIT 25`,
      [parsed.network, parsed.amount]
    );
    let match = null;
    if (parsed.payer) {
      for (const row of candidates) {
        const stored = normalizePayerNumber((await get('SELECT payer_number FROM deposit_requests WHERE id = ?', [row.id]))?.payer_number);
        if (stored && stored === parsed.payer) { match = row; break; }
      }
    }
    if (!match && parsed.reference) {
      match = await get(
        `SELECT id, user_id, amount FROM deposit_requests
         WHERE status = 'pending' AND provider = ? AND LOWER(transaction_id) = LOWER(?)
         ORDER BY id ASC LIMIT 1`,
        [parsed.network, parsed.reference]
      ) || null;
    }
    if (!match) return null;

    const result = await settleDepositById(match.id, 'confirmed');
    return result.error ? null : { depositId: match.id, userId: match.user_id, amount: match.amount };
  })();
};

// Receives one SMS (or an array) from an auto-forwarder app or the admin panel.
// Auth: X-Admin-Key (same ADMIN_KEY as other admin endpoints). Always 200 so
// forwarders do not retry endlessly; every message is logged in sms_log.
app.post('/api/sms/ingest', async (req, res) => {
  const providedKey = Buffer.from(String(req.get('X-Admin-Key') || ''));
  const configuredKey = Buffer.from(ADMIN_KEY);
  if (!ADMIN_KEY || providedKey.length !== configuredKey.length || !timingSafeEqual(providedKey, configuredKey)) {
    return res.status(401).json({ success: false, message: 'Admin authorization required.' });
  }

  const messages = Array.isArray(req.body.messages)
    ? req.body.messages
    : [{ sender: req.body.sender, body: req.body.body }];
  const results = [];

  for (const message of messages.slice(0, 50)) {
    const sender = String(message.sender || '').trim();
    const body = String(message.body || '').trim();
    const parsed = parsePaymentSms(sender, body);
    let action = 'ignored';
    let credited = null;

    if (parsed) {
      credited = await autoCreditFromSms(parsed);
      action = credited ? 'credited' : 'no_match';
    }

    await run(
      'INSERT INTO sms_log (sender, body, parsed_amount, parsed_payer, parsed_reference, action) VALUES (?, ?, ?, ?, ?, ?)',
      [sender, body, parsed ? parsed.amount : null, parsed ? parsed.payer : null, parsed ? parsed.reference : null, action]
    );
    results.push({ action, credited });
  }

  return res.json({ success: true, results });
});

app.post('/api/admin/fortune-codes', adminMiddleware, async (req, res) => {
  const suppliedCode = req.body.code === undefined ? null : normalizeFortuneCode(req.body.code);
  const amount = normalizeFortuneAmount(req.body.amount);

  if (req.body.code !== undefined && !suppliedCode) {
    return res.status(400).json({ success: false, message: 'Use a code in the FORT-XXXXXX format.' });
  }
  if (amount === null) {
    return res.status(400).json({ success: false, message: 'Enter a valid fortune amount.' });
  }

  const code = suppliedCode || await generateFortuneCode();
  try {
    await run('INSERT INTO fortune_codes (code, amount, max_redemptions) VALUES (?, ?, 10)', [code, amount]);
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
    `SELECT f.code, f.amount, r.redeemed_at AS redeemedAt
     FROM fortune_redemptions r JOIN fortune_codes f ON f.id = r.fortune_code_id
     WHERE r.user_id = ? ORDER BY r.redeemed_at DESC LIMIT 50`,
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

  const redemption = await db.transaction(async () => {
    const fortuneCode = await get(
      'SELECT id, code, amount, max_redemptions FROM fortune_codes WHERE code = ? COLLATE NOCASE',
      [code]
    );
    if (!fortuneCode) return { error: 'Invalid fortune code.' };

    const priorClaim = await get(
      'SELECT id FROM fortune_redemptions WHERE fortune_code_id = ? AND user_id = ?',
      [fortuneCode.id, req.user.id]
    );
    if (priorClaim) return { error: 'You have already redeemed this fortune code.' };

    const claimedCount = (await get(
      'SELECT COUNT(*) AS count FROM fortune_redemptions WHERE fortune_code_id = ?',
      [fortuneCode.id]
    )).count;
    if (claimedCount >= fortuneCode.max_redemptions) return { error: 'This fortune code has already been claimed by 10 clients.' };

    await run(
      'INSERT INTO fortune_redemptions (fortune_code_id, user_id) VALUES (?, ?)',
      [fortuneCode.id, req.user.id]
    );
    await run(
      'UPDATE fortune_codes SET redeemed_by = COALESCE(redeemed_by, ?), redeemed_at = COALESCE(redeemed_at, CURRENT_TIMESTAMP) WHERE id = ?',
      [req.user.id, fortuneCode.id]
    );

    await run(
      'UPDATE wallets SET withdrawable = withdrawable + ?, total = total + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [fortuneCode.amount, fortuneCode.amount, req.user.id]
    );
    await run(
      'INSERT INTO transactions (user_id, type, amount, status) VALUES (?, ?, ?, ?)',
      [req.user.id, 'fortune', fortuneCode.amount, 'credited']
    );

    const wallet = await get('SELECT withdrawable, total FROM wallets WHERE user_id = ?', [req.user.id]);
    const totalWon = await get(
      `SELECT COALESCE(SUM(f.amount), 0) AS amount
       FROM fortune_redemptions r JOIN fortune_codes f ON f.id = r.fortune_code_id
       WHERE r.user_id = ?`,
      [req.user.id]
    );
    const redeemedAt = await get(
      'SELECT redeemed_at AS redeemedAt FROM fortune_redemptions WHERE fortune_code_id = ? AND user_id = ?',
      [fortuneCode.id, req.user.id]
    );

    return {
      code: fortuneCode.code,
      amount: Number(fortuneCode.amount),
      redeemedAt: redeemedAt.redeemedAt,
      totalWon: Number(totalWon.amount),
      wallet
    };
  })();

  if (redemption.error) {
    return res.status(422).json({ success: false, message: redemption.error });
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

// Unknown API routes answer with JSON for every method (not just GET), so API
// clients never receive an HTML error page.
app.all('/api/*', (req, res) => {
  return res.status(404).json({ success: false, message: 'API endpoint not found.' });
});

// Static assets with long-lived caching (HTML files always revalidate via the fallback route below).
const BLOCKED_FILES = new Set([
  'server.js', 'fortunelogic.js', 'package.json', 'package-lock.json',
  'xplode.db', 'xplode.db-wal', 'xplode.db-shm', '.env',
  'server.log', 'start.bat', 'readme.md'
]);
const BLOCKED_PREFIXES = ['node_modules', 'test', 'backup', '.freebuff', '.git'];
const BLOCKED_EXTENSIONS = ['.log', '.bat', '.bak', '.md', '.sh', '.ps1', '.sqlite', '.db-journal'];

app.use((req, res, next) => {
  const requested = decodeURIComponent(req.path).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  const segments = requested.split('/').filter(Boolean);
  if (
    BLOCKED_FILES.has(requested)
    || BLOCKED_EXTENSIONS.some((extension) => requested.endsWith(extension))
    || segments.some((segment) => BLOCKED_PREFIXES.includes(segment))
  ) {
    return res.status(404).end();
  }
  next();
});

app.use(express.static(PUBLIC_DIR, {
  index: false,
  dotfiles: 'ignore',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.svg') || filePath.endsWith('.webp')) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ success: false, message: 'API endpoint not found.' });
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Malformed JSON and unexpected errors must return JSON, not an HTML stack page.
app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    return res.status(400).json({ success: false, message: 'Invalid request body.' });
  }
  console.error('Unhandled error:', error);
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
});

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  app.listen(PORT, () => {
    console.log(`XPLODE backend running on http://localhost:${PORT}`);
  });
}

export default app;
