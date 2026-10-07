const express = require('express');
const compression = require('compression');
const cookieSession = require('cookie-session');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const multer = require('multer');
const crypto = require('crypto');
const dur = require('./duration');
const youdu = require('./youdustore');

// Load .env FIRST before anything reads process.env
require('dotenv').config();

// PENTING — KEAMANAN: session cookie ditandatangani (signed) pakai secret ini.
// Sebelumnya ada fallback string HARDCODED di source code
// ('yooskystore-fallback-secret-2024-xK9mP3qR'). Itu lubang keamanan serius:
// siapa pun yang baca source code ini (termasuk lewat zip project ini) bisa
// tahu secret-nya, lalu memalsukan cookie session sendiri — termasuk bikin
// cookie isAdmin:true atau menyamar jadi reseller manapun untuk menguras
// saldo wallet mereka — TANPA perlu password sama sekali.
// Sekarang: kalau SESSION_SECRET tidak di-set, generate secret acak yang
// unik per kali server nyala (bukan string tetap yang bisa dibaca orang).
// Konsekuensinya session akan ke-reset tiap restart server kalau kamu belum
// set SESSION_SECRET — supaya aman SEKALIGUS stabil di production, WAJIB
// set SESSION_SECRET di environment variables (Vercel/hosting kamu).
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Production warning tapi JANGAN exit — Vercel kadat lambat inject env
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET belum di-set! Pakai secret acak sementara (reset tiap restart server).');
  console.warn('⚠️  WAJIB set SESSION_SECRET di environment variables untuk keamanan & session yang stabil.');
}

// Load DB module AFTER dotenv so env vars are available
const db = require('./supabase');

const app = express();
const PORT = process.env.PORT || 3000;

// PENTING (biaya): tanpa gzip/brotli, setiap HTML/JSON response dikirim mentah
// tanpa kompresi -> "Fast Data Transfer" di Vercel jebol lebih cepat karena
// byte yang ditransfer jauh lebih besar dari yang seharusnya. compression()
// biasanya motong 60-80% ukuran response HTML/JSON.
app.use(compression());

// Rate limiting untuk QR Code
const qrRateLimit = new Map();
const QR_RATE_LIMIT = 30;
const QR_RATE_WINDOW = 60000;

// Rate limiting untuk login (brute force protection)
const loginFailMap = new Map();
const LOGIN_MAX_FAIL = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 menit

const checkLoginBlocked = (ip) => {
  const rec = loginFailMap.get(ip);
  if (!rec) return { blocked: false };
  if (Date.now() > rec.resetAt) { loginFailMap.delete(ip); return { blocked: false }; }
  return { blocked: rec.count >= LOGIN_MAX_FAIL, wait: Math.ceil((rec.resetAt - Date.now()) / 60000) };
};

const recordLoginFail = (ip) => {
  const now = Date.now();
  const rec = loginFailMap.get(ip);
  if (!rec || now > rec.resetAt) loginFailMap.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else { rec.count++; loginFailMap.set(ip, rec); }
};

const clearLoginFail = (ip) => loginFailMap.delete(ip);

// ── Cloudflare Turnstile verification ────────────────────────────────────────
async function verifyTurnstile(token) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Turnstile tidak dikonfigurasi, skip verifikasi

  return new Promise((resolve) => {
    const body = JSON.stringify({
      secret,
      response: token,
    });

    const options = {
      hostname: 'challenges.cloudflare.com',
      path: '/turnstile/v0/siteverify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.success === true);
        } catch {
          resolve(false);
        }
      });
    });

    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}
// ─────────────────────────────────────────────────────────────────────────────

// Invoice rate limiting (cegah brute force order code enumeration)
const invoiceRateMap = new Map();
const INVOICE_RATE_LIMIT = 10;
const INVOICE_RATE_WINDOW = 5 * 60 * 1000;

const checkInvoiceRateLimit = (ip) => {
  const now = Date.now();
  const rec = invoiceRateMap.get(ip);
  if (!rec || now > rec.resetAt) {
    invoiceRateMap.set(ip, { count: 1, resetAt: now + INVOICE_RATE_WINDOW });
    return true;
  }
  if (rec.count >= INVOICE_RATE_LIMIT) return false;
  rec.count++;
  return true;
};

// API rate limiting untuk endpoint publik
const apiRateMap = new Map();
const checkApiRateLimit = (ip, limit = 60, windowMs = 60000) => {
  const now = Date.now();
  const rec = apiRateMap.get(ip);
  if (!rec || now > rec.resetAt) {
    apiRateMap.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count++;
  return true;
};

// Lock set untuk mencegah race condition pada alokasi key
const processingOrders = new Set();
// Lock per-user untuk operasi wallet (beli pakai saldo). Tanpa ini, dua
// request /wallet/buy yang nyaris bersamaan (double-click, atau script abuse)
// bisa sama-sama baca saldo & stok key SEBELUM salah satu sempat nulis balik
// — hasilnya: saldo cuma kepotong sekali tapi key kekirim dua kali (double-spend).
const walletLocks = new Set();

const checkQrRateLimit = (ip) => {
  const now = Date.now();
  const record = qrRateLimit.get(ip);
  if (record) {
    const windowStart = now - QR_RATE_WINDOW;
    const recentRequests = record.filter(ts => ts > windowStart);
    if (recentRequests.length >= QR_RATE_LIMIT) {
      return false;
    }
    recentRequests.push(now);
    qrRateLimit.set(ip, recentRequests);
  } else {
    qrRateLimit.set(ip, [now]);
  }
  return true;
};

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.set('trust proxy', 1);
app.use(expressLayouts);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// PENTING (biaya): kasih maxAge supaya browser & Vercel Edge Cache nyimpen
// file statis (logo, css, gambar produk) dan TIDAK invoke serverless
// function lagi tiap ada yang buka halaman. Sebelumnya tanpa header cache,
// tiap request static file = 1 function invocation + full transfer ulang.
const staticOpts = {
  maxAge: '7d',
  etag: true,
  // s-maxage = cache di CDN Vercel (bukan cuma browser), jadi request ke aset
  // statis dilayani edge dan TIDAK membangunkan function (hemat invocation,
  // Active CPU, dan Fast Origin Transfer).
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400');
  }
};
app.use(express.static(path.join(__dirname, 'public'), staticOpts));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), staticOpts));
app.use('/uploads/avatars', express.static(path.join(__dirname, 'public/uploads/avatars'), staticOpts));

// Vercel: file di /uploads tidak persistent - redirect ke Supabase Storage
if (process.env.VERCEL === '1' || process.env.NOW_REGION) {
  app.get('/uploads/logo-ys.png', (req, res) => {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const storageUrl = supabaseUrl ? supabaseUrl + '/storage/v1/object/public/product-images/logo-ys.png' : null;
    if (storageUrl) return res.redirect(302, storageUrl);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#00D2FF"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-size="14" font-weight="bold">YS</text></svg>');
  });
  app.get('/uploads/banner-reseller.jpg', (req, res) => {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const storageUrl = supabaseUrl ? supabaseUrl + '/storage/v1/object/public/product-images/banner-reseller.jpg' : null;
    if (storageUrl) return res.redirect(302, storageUrl);
    res.status(404).send('Banner not found');
  });
}

app.use(cookieSession({
  name: 'vpr_session',
  secret: SESSION_SECRET,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
}));

// ── FIX: Regenerate session object tiap request (cookie-session quirk) ──
app.use((req, res, next) => {
  // Pastikan session object tidak null
  if (!req.session) req.session = {};
  next();
});

// SECURITY: helper untuk embed data JSON ke dalam <script> block di EJS
// dengan aman. JSON.stringify() biasa TIDAK aman kalau string di dalamnya
// mengandung "</script>" — itu akan memutus tag <script> di HTML dan bisa
// jadi stored XSS (misal lewat nama produk yang diinput admin). Fungsi ini
// meng-escape karakter '<' jadi '\u003c' sehingga JSON tetap valid & sama
// persis secara data, tapi tidak bisa memutus tag HTML manapun.
// Dipakai di views lewat <%- safeJson(dataVariable) %> menggantikan
// <%- JSON.stringify(dataVariable) %> untuk data yang di-inject ke <script>.
app.locals.safeJson = (data) => JSON.stringify(data).replace(/</g, '\\u003c');
// Helper durasi (hari/jam) untuk view EJS
app.locals.dur = dur;

// Inject settings + isAdmin ke semua view otomatis
app.use(async (req, res, next) => {
  // Kalau cache settings kosong, fetch dari Supabase dulu
  let settings = readDB('settings.json');
  if (!settings || Object.keys(settings).length === 0) {
    settings = await db.readFresh('settings.json').catch(() => ({}));
  }
  res.locals.settings = settings || {};
  res.locals.isAdmin = !!(req.session?.isAdmin || req.session?.userId === 'admin');
  res.locals.user = getSessionUser(req);
  next();
});

// Setup upload — gunakan /tmp di Vercel (satu-satunya writable path)
const isVercel = process.env.VERCEL === '1' || process.env.NOW_REGION;
const uploadsBase = isVercel ? '/tmp' : path.join(__dirname, 'public', 'uploads');
const uploadsDir = isVercel ? '/tmp/products' : path.join(__dirname, 'public', 'uploads', 'products');

// Buat direktori lokal hanya jika bukan Vercel
if (!isVercel) {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = isVercel ? '/tmp/products' : path.join(__dirname, 'public', 'uploads', 'products');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Hanya file gambar yang diizinkan'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
});

// Database helpers (Supabase)
const dbPath = path.join(__dirname, 'database');
if (!isVercel && !fs.existsSync(dbPath)) fs.mkdirSync(dbPath, { recursive: true });

const readDB = db.readDB;
const writeDB = db.writeDB;
const readFresh = db.readFresh;

// Banner lama (seed default "Open Reseller") tersimpan tanpa field `id` dan
// pakai key `url` bukan `imageUrl` — akibatnya tombol "Hapus"/"Toggle" di
// admin panel selalu gagal mencocokkan banner tersebut (id undefined !== id
// yang dikirim dari client) sehingga banner itu seolah tidak bisa dihapus.
// Banner default ini memang tidak diperlukan, jadi begitu terbaca langsung
// dibuang otomatis. Banner lain yang memang tidak punya `id` (kasus lama
// lainnya) tetap dipertahankan, hanya dibenahi id & imageUrl-nya.
function normalizeBanners(settings) {
  if (!Array.isArray(settings.banners)) return false;
  let changed = false;
  const isLegacyDefaultReseller = b => !b.id && b.url === '/uploads/banner-reseller.jpg' && b.title === 'Open Reseller' && b.link === '/reseller';
  const filtered = settings.banners.filter(b => !isLegacyDefaultReseller(b));
  if (filtered.length !== settings.banners.length) { settings.banners = filtered; changed = true; }
  settings.banners.forEach(b => {
    if (!b.id) { b.id = uuidv4(); changed = true; }
    if (!b.imageUrl && b.url) { b.imageUrl = b.url; changed = true; }
  });
  return changed;
}
const readSmart = db.readSmart; // TTL-based: auto-refresh jika cache >60 detik
const refreshForWrite = (...files) => Promise.all(files.map(f => db.refreshFromDB(f)));

// Initialize database files with defaults (only if truly missing)
const initDB = async () => {
  // JANGAN hardcode username/password admin di source code (ini yang
  // sebelumnya bocor lewat GitHub). Kalau env var tidak diset, generate
  // password random tiap kali server start dari nol, dan print SEKALI ke
  // log server (bukan ke kode) supaya bisa langsung dipakai lalu diganti.
  const crypto = require('crypto');
  const fallbackUsername = process.env.INITIAL_ADMIN_USERNAME || 'admin';
  const fallbackPassword = process.env.INITIAL_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  if (!process.env.INITIAL_ADMIN_PASSWORD) {
    console.log('🔐 Belum ada INITIAL_ADMIN_PASSWORD di env. Password admin awal di-generate random:');
    console.log(`   username: ${fallbackUsername}`);
    console.log(`   password: ${fallbackPassword}`);
    console.log('   GANTI password ini lewat Admin Panel setelah login pertama!');
  }
  const defaultSettings = {
    siteName: 'YOOSKY STORE',
    gamePanelName: 'YOOSKY STORE',
    about: 'YOOSKY STORE menyediakan layanan topup games dan key mod aplikasi premium terbaik #1 indonesia.',
    marqueeText: 'LAYANAN GAME MOD MENU PREMIUM - PROSES CEPAT & AMAN',
    contact: {
      whatsapp: '6281549460894',
      telegram: 'YooskyModz',
      email: 'support@yooskystore.com',
      waChannel: 'https://whatsapp.com/channel/0029Vb7MKnEKbYMGZcDUAj0C',
      waGroup: 'https://chat.whatsapp.com/KbD6Yyyt5c8A9lZyykwSap',
    },
    fonnteToken: '',
    pakasir: { apiKey: '', project: '', mode: 'production', webhookSecret: '' },
    youdu: { token: '', apiKey: '', sandbox: false, callbackSecret: '', map: {} },
    adminUsername: fallbackUsername,
    adminPassword: bcrypt.hashSync(fallbackPassword, 12),
    logoUrl: '/uploads/logo-ys.png',
    categories: ['freefire', 'mlbb', 'pubgm', 'sertifikat'],
    categoryLabels: { freefire: 'FREE FIRE', mlbb: 'MOBILE LEGENDS', pubgm: 'PUBG MOBILE', sertifikat: 'SERTIFIKAT' },
    resellerEnabled: true,
    resellerPrice: 50000,
    resellerDiscount: 20,
    resellerNote: 'Dapatkan diskon eksklusif untuk semua produk!',
    resellerMinDeposit: 50000,
    popularProductIds: [],
    banners: []
  };

  const arrayFiles = ['users.json', 'products.json', 'transactions.json', 'testimonials.json', 'notifications.json', 'keyspool.json', 'vouchers.json', 'restocks.json'];

  // Seed arrays only if they don't exist at all
  for (const filename of arrayFiles) {
    const current = readDB(filename);
    if (!Array.isArray(current)) {
      await writeDB(filename, []);
    }
  }

  // Settings: merge defaults + existing. Jangan overwrite data yang sudah ada.
  const currentSettings = readDB('settings.json');
  if (!currentSettings || Object.keys(currentSettings).length === 0) {
    // Supabase kosong — push default penuh
    await writeDB('settings.json', defaultSettings);
    console.log('✅ Settings seeded with defaults');
  } else {
    // Merge: tambah field yang belum ada, jangan overwrite yang sudah ada
    let dirty = false;
    for (const [k, v] of Object.entries(defaultSettings)) {
      if (currentSettings[k] === undefined || currentSettings[k] === null) {
        currentSettings[k] = v;
        dirty = true;
      }
    }
    if (dirty) {
      await writeDB('settings.json', currentSettings);
      console.log('✅ Settings merged missing fields');
    }
  }
};

// Vercel: export app langsung (Vercel tidak pakai app.listen)
// Lokal: jalankan server setelah DB siap
if (isVercel) {
  // ── VERCEL FIX: pastikan DB init selesai sebelum request diproses ──
  let dbReady = false;
  let dbInitPromise = null;

  const ensureDBReady = async () => {
    if (dbReady) return;
    if (!dbInitPromise) {
      dbInitPromise = db.initializeDB().then(() => initDB()).then(() => { dbReady = true; });
    }
    await dbInitPromise;
  };

  // Middleware: block request sampai DB siap (max 8 detik)
  app.use(async (req, res, next) => {
    try {
      await Promise.race([
        ensureDBReady(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB init timeout')), 8000))
      ]);
    } catch (e) {
      console.error('[DB] Init failed or timeout:', e.message);
      // Lanjut saja, pakai local fallback
    }
    next();
  });

  module.exports = app;
} else {
  // Lokal / VPS: tunggu DB siap baru listen
  db.initializeDB().then(() => {
    initDB(); // seed defaults only if missing
    app.listen(PORT, () => {
      console.log(`✅ Server berjalan di http://localhost:${PORT}`);
      console.log(`📁 Database: ${dbPath}`);
      console.log(`🔐 Admin: /admin`);
    });
  }).catch(err => {
    console.error('Fatal: Failed to initialize database:', err);
    process.exit(1);
  });
  module.exports = app;
}

// Helper: dapatkan user dari session (support admin yang tidak ada di users.json)
const getSessionUser = (req) => {
  if (req.session?.isAdmin) {
    const s = readDB('settings.json');
    return { id: 'admin', username: s.adminUsername || 'Admin', isAdmin: true, photo: null, role: 'admin', is_reseller: false };
  }
  if (req.session?.userId) return readDB('users.json').find(u => u.id === req.session.userId) || null;
  return null;
};

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session?.userId) {
    if (req.xhr || req.headers['content-type']?.includes('application/json')) {
      return res.json({ success: false, message: 'Silakan login terlebih dahulu', redirect: '/login' });
    }
    return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  }
  next();
};

const requireAdmin = async (req, res, next) => {
  if (!req.session?.isAdmin && req.session?.userId !== 'admin') {
    // Balas 404 bukan 403 agar penyerang tidak tahu route admin ada
    return res.status(404).send('Not found');
  }

  // ── Single-Device Admin Lock ──────────────────────────────────
  // Mencegah 2 orang (mis: web dev + client) login admin bersamaan di
  // device berbeda. Login bersamaan menyebabkan race condition saat
  // keduanya baca-ubah-simpan data produk di waktu hampir sama, sehingga
  // perubahan salah satu pihak tertimpa / produk "berubah-ubah" saat refresh.
  //
  // PENTING: pakai readFresh (bukan readDB) di sini. Vercel menjalankan
  // banyak instance serverless yang TIDAK berbagi memori — kalau pakai
  // cache lokal, satu instance bisa "telat tahu" kalau device lain baru
  // saja ambil alih sesi, dan tetap meloloskan device yang seharusnya
  // sudah diblokir. Ini satu-satunya pengecekan yang wajib selalu fresh.
  const lock = await db.readFresh('admin-lock.json');
  if (isLockActive(lock) && lock.sessionId !== req.session.adminSessionId) {
    req.session = null; // paksa logout sesi yang sudah digantikan
    if (ADMIN_PAGE_ROUTES.has(req.path)) {
      return res.redirect('/vpr-secure-panel-8x?kicked=1');
    }
    return res.status(401).json({
      success: false,
      sessionRevoked: true,
      message: `Sesi admin Anda diakhiri karena ada login dari perangkat lain (${lock.device || 'perangkat lain'}).`
    });
  }

  // Sesi ini pemegang lock yang sah → perpanjang heartbeat (di-throttle,
  // supaya tidak nulis ke Supabase di setiap request)
  touchAdminLock(req.session.adminSessionId, lock);

  next();
};

// Halaman admin yang dimuat lewat navigasi browser biasa (bukan fetch/XHR)
// → kalau lock-nya hilang, redirect ke halaman login, bukan balas JSON.
const ADMIN_PAGE_ROUTES = new Set(['/admin', '/admin/product-edit', '/admin/theme-settings']);

// Lock dianggap kosong/expired kalau tidak ada heartbeat selama ini
// (mis: tab ditutup / koneksi putus tanpa logout resmi).
const ADMIN_LOCK_TIMEOUT_MS = 6 * 60 * 1000; // 6 menit

const parseDeviceLabel = (ua = '') => {
  let browser = 'Browser';
  if (/edg/i.test(ua)) browser = 'Edge';
  else if (/chrome/i.test(ua)) browser = 'Chrome';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';
  let os = 'Unknown';
  if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ios/i.test(ua)) os = 'iOS';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/mac os/i.test(ua)) os = 'Mac';
  else if (/linux/i.test(ua)) os = 'Linux';
  return `${browser} · ${os}`;
};

const isLockActive = (lock) => {
  if (!lock || !lock.sessionId || !lock.lastSeen) return false;
  return (Date.now() - new Date(lock.lastSeen).getTime()) < ADMIN_LOCK_TIMEOUT_MS;
};

// Klaim lock untuk sesi admin yang baru login. Dipanggil SETELAH password
// terverifikasi & lock lama dipastikan kosong/expired (lihat route login).
const acquireAdminLock = async (req) => {
  const sessionId = uuidv4();
  await writeDB('admin-lock.json', {
    sessionId,
    ip: req.ip,
    device: parseDeviceLabel(req.headers['user-agent'] || ''),
    loginAt: new Date().toISOString(),
    lastSeen: new Date().toISOString()
  });
  return sessionId;
};

// Lepas lock saat logout resmi — supaya device lain bisa langsung login
// tanpa harus menunggu timeout.
const releaseAdminLock = async (sessionId) => {
  if (!sessionId) return;
  try {
    const lock = await db.readFresh('admin-lock.json');
    if (lock && lock.sessionId === sessionId) await writeDB('admin-lock.json', {});
  } catch {}
};

// Heartbeat di-throttle per sessionId supaya tidak nulis ke Supabase di
// setiap request admin (cukup tiap ≥60 detik aktivitas). `lock` di sini
// sudah hasil readFresh dari requireAdmin, jadi tidak perlu baca ulang.
const lastHeartbeatAt = new Map();
const touchAdminLock = (sessionId, lock) => {
  if (!sessionId || !lock || lock.sessionId !== sessionId) return;
  const now = Date.now();
  if (now - (lastHeartbeatAt.get(sessionId) || 0) < 60000) return;
  lastHeartbeatAt.set(sessionId, now);
  writeDB('admin-lock.json', { ...lock, lastSeen: new Date().toISOString() }).catch(() => {});
};

// Helper functions
const generateOrderCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'VR-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

const formatDate = (date = new Date()) => {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
};

// ── PakKasir API v2 (app.pakasir.com) ──
// Dokumentasi: https://pakasir.com/p/create-transaction (v1 dihentikan 20 Okt 2026)
//   POST /api/v2/create-transaction/{slug}/{order_id}   body {method, amount}
//   GET  /api/v2/transaction-status/{slug}/{txn_id}     (maks 1x / 4 dtk per transaksi)
//   Webhook POST ke server kita saat transaksi berhasil (header X-Secret)
const PAKASIR_QRIS_MIN = 500;
const PAKASIR_QRIS_MAX = 10000000;

const getPakasirCfg = (settings) => ({
  apiKey: (settings?.pakasir?.apiKey || process.env.PAKASIR_API_KEY || '').trim(),
  slug: (settings?.pakasir?.project || process.env.PAKASIR_PROJECT || '').trim(),
  webhookSecret: (settings?.pakasir?.webhookSecret || process.env.PAKASIR_WEBHOOK_SECRET || '').trim(),
  sandboxOk: (settings?.pakasir?.mode || 'production') === 'sandbox'
});

const pakasirRequest = (method, reqPath, body, cfg) => new Promise((resolve, reject) => {
  if (!cfg.apiKey || !cfg.slug) return reject(new Error('API Key atau Slug project PakKasir belum dikonfigurasi'));
  const payload = body ? JSON.stringify(body) : null;
  const headers = { 'X-Api-Key': cfg.apiKey, 'Accept': 'application/json' };
  if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
  const req = https.request({ hostname: 'app.pakasir.com', port: 443, path: reqPath, method, headers, timeout: 15000 }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      let json = null;
      try { json = JSON.parse(data); } catch (_) {}
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const msg = (json && (json.message || json.error)) || `HTTP ${res.statusCode}: ${String(data).slice(0, 100)}`;
        const err = new Error(`Pakasir: ${msg}`);
        err.status = res.statusCode;
        return reject(err);
      }
      if (!json) return reject(new Error('Gagal parse response PakKasir'));
      resolve(json);
    });
  });
  req.on('timeout', () => { req.destroy(); reject(new Error('PakKasir timeout')); });
  req.on('error', e => reject(new Error('Network error: ' + e.message)));
  if (payload) req.write(payload);
  req.end();
});

// Buat transaksi QRIS (v2 bersifat find-or-create: order_id + body sama => response sama)
const createQRISPayment = async (orderId, amount, settings) => {
  const cfg = getPakasirCfg(settings);
  const amt = parseInt(amount, 10);
  if (!Number.isInteger(amt) || amt < PAKASIR_QRIS_MIN) throw new Error(`Nominal QRIS minimal Rp ${PAKASIR_QRIS_MIN.toLocaleString('id-ID')}`);
  if (amt > PAKASIR_QRIS_MAX) throw new Error(`Nominal QRIS maksimal Rp ${PAKASIR_QRIS_MAX.toLocaleString('id-ID')}`);
  const r = await pakasirRequest('POST',
    `/api/v2/create-transaction/${encodeURIComponent(cfg.slug)}/${encodeURIComponent(orderId)}`,
    { method: 'qris', amount: amt }, cfg);
  if (!r.qr_string) throw new Error(r.message || `Pakasir error: ${JSON.stringify(r).slice(0, 100)}`);
  return {
    txn_id: r.txn_id || null,
    qr_string: r.qr_string,
    fee: r.fee || 0,
    total_payment: r.total_payment || amt,
    expired_at: r.expired_at || null,
    is_sandbox: !!r.is_sandbox
  };
};

// Status transaksi v2: { txn_id, order_id, amount, is_sandbox, status: pending|completed|canceled, completed_at }
const getPakasirStatus = (txnId, settings) => {
  const cfg = getPakasirCfg(settings);
  return pakasirRequest('GET',
    `/api/v2/transaction-status/${encodeURIComponent(cfg.slug)}/${encodeURIComponent(txnId)}`, null, cfg);
};

// Transaksi lama (dibuat via API v1) belum punya txn_id. Karena endpoint create v2
// bersifat find-or-create, panggil lagi dengan order_id + amount yang sama untuk
// mendapatkan txn_id-nya, lalu simpan supaya tidak perlu diulang.
const ensurePakasirTxnId = async (transaction, settings) => {
  if (transaction.pakasirTxnId) return transaction.pakasirTxnId;
  const r = await createQRISPayment(transaction.orderId, transaction.price, settings);
  if (!r.txn_id) throw new Error('Pakasir tidak mengembalikan txn_id');
  transaction.pakasirTxnId = r.txn_id;
  return r.txn_id;
};

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

// Kirim notifikasi WhatsApp otomatis ke admin via Fonnte (jika token dikonfigurasi)
const sendWhatsAppNotif = (target, message, settings) => {
  return new Promise((resolve) => {
    const token = settings?.fonnteToken?.trim() || '';
    if (!token || !target) return resolve(false);
    const body = `target=${encodeURIComponent(target)}&message=${encodeURIComponent(message)}`;
    const req = https.request({
      hostname: 'api.fonnte.com', port: 443,
      path: '/send', method: 'POST',
      headers: {
        'Authorization': token,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 10000
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.write(body); req.end();
  });
};

// Routes - Public
// ══════════════════════════════════════════════════════════════════
// SETUP ENDPOINT — Reset admin password + push semua settings
// Akses: /yoosky-setup?secret=SETUP_SECRET (dari env var)
// Set SETUP_SECRET di Vercel env vars, lalu akses URL-nya via browser.
// Setelah berhasil, HAPUS SETUP_SECRET dari env Vercel untuk keamanan.
// ══════════════════════════════════════════════════════════════════
app.get('/yoosky-setup', async (req, res) => {
  const secret = process.env.SETUP_SECRET;
  if (!secret || req.query.secret !== secret) {
    return res.status(403).send('❌ Akses ditolak. Set SETUP_SECRET di env Vercel dulu.');
  }

  try {
    const currentSettings = await db.readFresh('settings.json') || {};

    // JANGAN hardcode password fallback di sini juga — endpoint ini bisa
    // dipicu ulang kapan saja oleh siapapun yang tahu SETUP_SECRET, jadi
    // fallback HARUS random per-run, bukan string tetap yang bisa dibaca
    // dari source code (lihat penjelasan yang sama di initDB()).
    const newUsername = process.env.INITIAL_ADMIN_USERNAME || 'admin';
    const newPassword = process.env.INITIAL_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const newHash     = bcrypt.hashSync(newPassword, 12);

    const updatedSettings = {
      ...currentSettings,
      siteName:      'YOOSKY STORE',
      gamePanelName: 'YOOSKY STORE',
      about:         'YOOSKY STORE menyediakan layanan key mod aplikasi premium terbaik #1 indonesia.',
      marqueeText:   'LAYANAN GAME MOD MENU PREMIUM - PROSES CEPAT & AMAN',
      contact: {
        ...(currentSettings.contact || {}),
        whatsapp:  '6281549460894',
        telegram:  'YooskyModz',
        email:     'support@yooskystore.com',
        waChannel: 'https://whatsapp.com/channel/0029Vb7MKnEKbYMGZcDUAj0C',
        waGroup:   'https://chat.whatsapp.com/KbD6Yyyt5c8A9lZyykwSap',
      },
      adminUsername: newUsername,
      adminPassword: newHash,
      logoUrl: currentSettings.logoUrl || '/uploads/logo-ys.png',
    };

    await db.writeDB('settings.json', updatedSettings);

    // Verify
    const saved   = await db.readFresh('settings.json');
    const verify  = bcrypt.compareSync(newPassword, saved.adminPassword);

    res.send(`
      <!DOCTYPE html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Setup Result</title>
      <style>body{font-family:monospace;background:#050c26;color:#e2e8f0;padding:24px;max-width:500px;margin:0 auto;}
      .ok{color:#4ade80;} .err{color:#f87171;} .box{background:#0d1a4a;border:1px solid rgba(37,99,235,.3);border-radius:10px;padding:20px;margin:16px 0;}
      h2{color:#60a5fa;} a{color:#60a5fa;}</style></head><body>
      <h2>${verify ? '✅ SETUP BERHASIL' : '❌ SETUP GAGAL'}</h2>
      <div class="box">
        <p class="ok">✅ adminUsername : <strong>${saved.adminUsername}</strong></p>
        <p class="${verify?'ok':'err'}">${verify?'✅':'❌'} password hash  : ${verify?'MATCH — password benar':'TIDAK MATCH — ada masalah!'}</p>
        <p class="ok">✅ whatsapp      : ${saved.contact?.whatsapp}</p>
        <p class="ok">✅ telegram      : ${saved.contact?.telegram}</p>
        <p class="ok">✅ waChannel     : ${saved.contact?.waChannel}</p>
        <p class="ok">✅ waGroup       : ${saved.contact?.waGroup}</p>
      </div>
      <div class="box">
        <p>🔐 <strong>Login Admin:</strong></p>
        <p>URL&nbsp;&nbsp;&nbsp;&nbsp;: <a href="/vpr-secure-panel-8x">/vpr-secure-panel-8x</a></p>
        <p>Username: <strong>${newUsername}</strong></p>
        <p>Password: <strong>${newPassword}</strong></p>
      </div>
      <p style="color:rgba(148,163,184,.5);font-size:11px;">⚠️ Setelah berhasil login, HAPUS SETUP_SECRET dari env Vercel!</p>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`❌ Error: ${err.message}`);
  }
});

app.get('/', async (req, res) => {
  // FIX (egress): route publik dengan traffic tinggi -- pakai readSmart
  // (cache ber-TTL), BUKAN readFresh (selalu fetch Supabase). readFresh di
  // sini dulu bikin setiap visitor menarik ulang seluruh blob products.json
  // dari Supabase, menghabiskan kuota cached egress free tier dengan cepat.
  const products = (await readSmart('products.json')).filter(p => p.status === 'active');

  // ── Leaderboard real-time (hanya dari transaksi sukses) ──
  const transactions = readDB('transactions.json');
  const users = readDB('users.json');
  const userStats = {};
  transactions.forEach(t => {
    if (t.status === 'done' && t.userId) {
      if (!userStats[t.userId]) userStats[t.userId] = { userId: t.userId, totalTransactions: 0, totalSpent: 0 };
      userStats[t.userId].totalTransactions++;
      userStats[t.userId].totalSpent += t.price;
    }
  });
  const realEntries = Object.values(userStats).map(stat => {
    const u = users.find(u => u.id === stat.userId);
    return { username: u?.username || 'User', totalTransactions: stat.totalTransactions, totalSpent: stat.totalSpent };
  });
  const leaderboardEntries = realEntries
    .sort((a, b) => b.totalTransactions - a.totalTransactions || b.totalSpent - a.totalSpent)
    .slice(0, 8);

  // ── Server-side fake testimonials ──
  const fakeTestimonials = [
    { id:'fake1', name:'Rizky F.',    rating:5, text:'Mod FF-nya mantap, udah 3 bulan pakai dan aman-aman aja. Fitur lengkap dari ESP sampai fly hack. CS juga responsif banget!', productName:'FREE FIRE MAX',      date:'2025-05-20', verified:true },
    { id:'fake2', name:'Andi S.',     rating:5, text:'ML mod-nya lengkap banget! Map hack, drone view, sampai skin all hero ada. Auto update jadi nggak perlu repot tiap update.', productName:'MOBILE LEGENDS',    date:'2025-05-18', verified:true },
    { id:'fake3', name:'Dimas P.',    rating:5, text:'Support fast response! Pas ada masalah langsung dibantu sampai beres. PUBG mod-nya juga smooth, nggak lag sama sekali.', productName:'PUBG MOBILE',   date:'2025-05-15', verified:true },
    { id:'fake4', name:'farhan',      rating:5, text:'Beli sertifikat anti-banned udah 2x dan alhamdulillah akun tetap aman. Worth it banget harganya segitu.', productName:'SERTIFIKAT', date:'2025-05-10', verified:true },
    { id:'fake5', name:'Wanda M.',    rating:4, text:'Produknya bagus, pengiriman key cepet banget. Cuma kadang agak lag di device lama tapi overall oke lah.', productName:'MOBILE LEGENDS',    date:'2025-05-08', verified:true },
    { id:'fake6', name:'ACA',         rating:5, text:'Udah lama langganan di sini, belum pernah kecewa. Proses beli gampang, bayar QRIS langsung dapat key. Recommended!', productName:'FREE FIRE MAX',      date:'2025-05-05', verified:true },
    { id:'fake7', name:'bintang',     rating:5, text:'Lifetime PUBGM worth it banget. Udah 6 bulan masih lancar jaya, fitur no recoil-nya mantul.', productName:'PUBG MOBILE',   date:'2025-04-28', verified:true },
    { id:'fake8', name:'Rizky',       rating:4, text:'Kalau FF mod-nya top. Pernah ada issue tapi langsung di-handle sama admin. Keep up the good work!', productName:'FREE FIRE MAX',      date:'2025-04-20', verified:true },
    { id:'fake9', name:'Kevin',       rating:5, text:'CODM mod anti-recoil smooth banget. Rank dari Silver langsung naik ke Platinum dalam seminggu haha.', productName:'CODM',    date:'2025-04-15', verified:true },
    { id:'fake10',name:'abil',        rating:5, text:'Ini toko mod menu terpercaya yang pernah aku coba. Transaksi aman, key langsung masuk, CS ramah.', productName:'FREE FIRE MAX',      date:'2025-04-10', verified:true },
    { id:'fake11',name:'Hergi',       rating:5, text:'Valorant ESP-nya akurat banget. Sudah 2 bulan pake dan belum ada masalah sama sekali. Pelayanan top!', productName:'VALORANT', date:'2025-04-05', verified:true },
    { id:'fake12',name:'rehan',       rating:5, text:'HOK mod-nya mantap, map hack dan skin unlock semua ada. Proses beli cepet dan key langsung terkirim.', productName:'HOK',     date:'2025-03-28', verified:true },
  ];
  const realTestimonials = readDB('testimonials.json').filter(t => t.verified);
  const testiUsernames = new Set(realTestimonials.map(t => (t.username||'').toLowerCase()));
  const paddedFake = fakeTestimonials.filter(f => !testiUsernames.has((f.name||'').toLowerCase()));
  const testimonialsForHome = [...realTestimonials, ...paddedFake].slice(0, 12);
  const avgRating = testimonialsForHome.length
    ? (testimonialsForHome.reduce((s, t) => s + (t.rating || 0), 0) / testimonialsForHome.length).toFixed(1)
    : '4.9';
  const ratingCounts = {1:0,2:0,3:0,4:0,5:0};
  testimonialsForHome.forEach(t => { if (t.rating >= 1 && t.rating <= 5) ratingCounts[t.rating]++; });
  const totalSold = products.reduce((s, p) => s + (p.sold || 0), 0);
  // Pakai res.locals.settings yang sudah di-fetch oleh middleware (readFresh fallback)
  const settings = res.locals.settings || readDB('settings.json');
  const user = res.locals.user || getSessionUser(req);

  // Popular products: if admin configured popularProductIds, use those; else show all products
  const popularProductIds = settings.popularProductIds || [];
  let popularProducts;
  if (popularProductIds.length > 0) {
    popularProducts = products.filter(p => popularProductIds.includes(p.id));
    // Append any active products not in the popular list
    const remaining = products.filter(p => !popularProductIds.includes(p.id));
    popularProducts = [...popularProducts, ...remaining];
  } else {
    popularProducts = [...products].sort((a, b) => (b.sold || 0) - (a.sold || 0));
  }

  // SECURITY: strip keys sebelum dikirim ke view — home.ejs embed popularProducts
  // ke dalam <script> via JSON.stringify, jadi keys harus dihapus dari sini.
  const popularProductsSafe = popularProducts.map(({ keys, ...p }) => ({
    ...p, stockCount: (keys || []).length
  }));

  res.render('pages/home', {
    products,
    popularProducts: popularProductsSafe,
    settings,
    user,
    categories: settings.categories || [],
    categoryLabels: settings.categoryLabels || {},
    resellerSettings: {
      enabled: settings.resellerEnabled !== false,
      price: settings.resellerPrice || 50000,
      discount: settings.resellerDiscount || 20
    },
    leaderboardEntries,
    testimonialsForHome,
    avgRating,
    ratingCounts,
    totalSold
  });
});

// Auth routes
app.get('/login', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.render('pages/login', {
    error: null,
    redirect: req.query.redirect || '/',
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
  });
});

app.post('/login', async (req, res) => {
  const ip = req.ip;
  const { blocked, wait } = checkLoginBlocked(ip);
  if (blocked) {
    return res.render('pages/login', {
      error: `Terlalu banyak percobaan login. Coba lagi dalam ${wait} menit.`,
      redirect: req.body.redirect || '/',
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
    });
  }

  // ── Verifikasi Cloudflare Turnstile ─────────────────────────────────────
  if (process.env.TURNSTILE_SECRET_KEY) {
    const token = req.body['cf-turnstile-response'];
    if (!token) {
      return res.render('pages/login', {
        error: 'Verifikasi keamanan diperlukan. Mohon selesaikan captcha.',
        redirect: req.body.redirect || '/',
        turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
      });
    }
    const valid = await verifyTurnstile(token);
    if (!valid) {
      return res.render('pages/login', {
        error: 'Verifikasi keamanan gagal. Coba lagi.',
        redirect: req.body.redirect || '/',
        turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
      });
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  const { username, password } = req.body;
  const settings = readDB('settings.json');

  // Admin login diblokir dari /login — gunakan halaman khusus
  if (username === settings.adminUsername) {
    recordLoginFail(ip);
    return res.render('pages/login', {
      error: 'Username atau password salah.',
      redirect: req.body.redirect || '/',
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
    });
  }

  // Check user
  const users = readDB('users.json');
  const user = users.find(u => u.username === username);

  if (user && await bcrypt.compare(password, user.password)) {
    clearLoginFail(ip);
    req.session.userId = user.id;
    req.session.isAdmin = (user.role === 'admin');
    return res.redirect(req.body.redirect || (req.session.isAdmin ? '/admin' : '/'));
  }

  recordLoginFail(ip);
  const remaining = LOGIN_MAX_FAIL - (loginFailMap.get(ip)?.count || 0);
  const errMsg = remaining > 0
    ? `Username atau password salah. Sisa percobaan: ${remaining}`
    : `Terlalu banyak percobaan login. Coba lagi dalam 15 menit.`;
  res.render('pages/login', {
    error: errMsg,
    redirect: req.body.redirect || '/',
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
  });
});

app.get('/register', (req, res) => {
  if (req.session?.userId) return res.redirect('/');
  res.render('pages/register', { error: null });
});

app.post('/register', async (req, res) => {
  const { username, password, confirmPassword, wa } = req.body;

  if (!username || !password || !wa) {
    return res.render('pages/register', { error: 'Semua field wajib diisi' });
  }

  if (confirmPassword && password !== confirmPassword) {
    return res.render('pages/register', { error: 'Konfirmasi password tidak cocok' });
  }

  if (username === 'Abdurahman Mulvi') {
    return res.render('pages/register', { error: 'Username tidak diizinkan' });
  }

  const users = readDB('users.json');

  if (users.find(u => u.username === username)) {
    return res.render('pages/register', { error: 'Username sudah digunakan' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = {
    id: uuidv4(),
    username,
    password: hashedPassword,
    wa,
    photo: null,
    balance: 0,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  await writeDB('users.json', users);

  req.session.userId = newUser.id;
  req.session.isAdmin = false;

  res.redirect('/');
});

app.get('/logout', async (req, res) => {
  if (req.session?.isAdmin && req.session?.adminSessionId) {
    await releaseAdminLock(req.session.adminSessionId);
  }
  req.session = null;
  res.redirect('/');
});

// ══ YOOSKY STORE: ADMIN SECRET LOGIN GATE (hidden from public) ══
app.get('/vpr-secure-panel-8x', (req, res) => {
  if (req.session?.isAdmin) return res.redirect('/admin');
  const kicked = req.query.kicked === '1';
  res.render('pages/admin-login', {
    error: kicked ? 'Anda logout otomatis karena ada login admin dari perangkat lain.' : null,
    lockedInfo: null,
    username: ''
  });
});

app.post('/vpr-secure-panel-8x', async (req, res) => {
  const ip = req.ip;
  const { blocked, wait } = checkLoginBlocked(ip);
  if (blocked) {
    return res.render('pages/admin-login', {
      error: `Terlalu banyak percobaan. Coba lagi dalam ${wait} menit.`,
      lockedInfo: null, username: ''
    });
  }
  const { username, password, forceTakeover } = req.body;

  // ── FIX: readFresh() ambil langsung dari Supabase, bypass cache ──
  // Ini penting karena di Vercel tiap instance punya cache kosong
  const settings = await db.readFresh('settings.json');

  if (!settings || !settings.adminUsername) {
    return res.render('pages/admin-login', {
      error: 'Konfigurasi admin belum tersedia. Coba beberapa saat lagi.',
      lockedInfo: null, username: ''
    });
  }

  if (username === settings.adminUsername) {
    const match = await bcrypt.compare(password, settings.adminPassword);
    if (match) {
      // ── Single-Device Lock: cek apakah panel sedang dipakai device lain ──
      const currentLock = await db.readFresh('admin-lock.json');
      if (isLockActive(currentLock) && forceTakeover !== '1') {
        const minutesAgo = Math.max(1, Math.round((Date.now() - new Date(currentLock.lastSeen).getTime()) / 60000));
        return res.render('pages/admin-login', {
          error: null,
          username,
          lockedInfo: {
            device: currentLock.device || 'Perangkat tidak diketahui',
            minutesAgo
          }
        });
      }
      clearLoginFail(ip);
      req.session.userId = 'admin';
      req.session.isAdmin = true;
      req.session.adminSessionId = await acquireAdminLock(req);
      return res.redirect('/admin');
    }
  }
  recordLoginFail(ip);
  const remaining = LOGIN_MAX_FAIL - (loginFailMap.get(ip)?.count || 0);
  res.render('pages/admin-login', {
    error: remaining > 0
      ? `Username atau password salah. Sisa percobaan: ${remaining}`
      : 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.',
    lockedInfo: null, username: ''
  });
});


// ── RESELLER ──
app.get('/reseller', (req, res) => {
  // Pakai res.locals.settings yang sudah di-fetch oleh middleware (readFresh fallback)
  const settings = res.locals.settings || readDB('settings.json');
  const user = res.locals.user || getSessionUser(req);
  res.render('pages/reseller', { layout: false, settings, user });
});

app.post('/reseller/join', requireAuth, async (req, res) => {
  try {
    if (req.session.isAdmin) return res.json({ success: false, message: 'Admin tidak perlu join reseller' });
    const users = readDB('users.json');
    const user = users.find(u => u.id === req.session.userId);
    if (!user) return res.json({ success: false, message: 'User tidak ditemukan' });
    if (user.is_reseller) return res.json({ success: false, message: 'Kamu sudah menjadi Reseller VIP!' });

    const settings = await readFresh('settings.json');
    const price = settings.resellerPrice || 50000;
    const orderId = `RES-${Date.now()}`;
    const refId = uuidv4();
    const orderCode = generateOrderCode();
    const qrisMode = settings.qrisMode || 'static';

    let qrString = null, isStatic = false, pakasirTxnId = null;

    if (qrisMode === 'static') {
      if (!settings.qrisStaticImage) return res.json({ success: false, message: 'Admin belum mengatur QRIS. Hubungi admin.' });
      isStatic = true;
    } else {
      try {
        const r = await createQRISPayment(orderId, price, settings);
        qrString = r.qr_string;
        pakasirTxnId = r.txn_id;
      } catch (e) {
        if (settings.qrisStaticImage) { isStatic = true; }
        else return res.json({ success: false, message: 'QRIS error: ' + e.message });
      }
    }

    const transactions = readDB('transactions.json');
    transactions.push({
      id: refId, orderId, code: orderCode,
      userId: user.id, type: 'reseller',
      productName: 'Upgrade Reseller VIP',
      customerName: user.username, wa: user.wa,
      price, totalPayment: price, qrString, isStatic, pakasirTxnId,
      status: 'pending', key: null,
      createdAt: new Date().toISOString(), time: formatDate()
    });
    await writeDB('transactions.json', transactions);

    res.json({ success: true, refId, orderId, qrString, orderCode, isStatic,
      qrisStaticImage: isStatic ? settings.qrisStaticImage : null });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ── WALLET (SALDO RESELLER) ──
// Reseller top-up saldo via QRIS. Setelah dibayar & dikonfirmasi (lihat
// /check-payment/:refId), saldo otomatis bertambah dan bisa langsung dipakai
// untuk beli key tanpa scan QRIS lagi (lihat /wallet/buy).
app.post('/wallet/topup', requireAuth, async (req, res) => {
  try {
    if (req.session.isAdmin) return res.json({ success: false, message: 'Admin tidak memiliki wallet' });
    const users = readDB('users.json');
    const user = users.find(u => u.id === req.session.userId);
    if (!user) return res.json({ success: false, message: 'User tidak ditemukan' });
    if (!user.is_reseller) return res.json({ success: false, message: 'Top up saldo khusus untuk Reseller VIP. Gabung reseller dulu yuk!' });

    const settings = await readFresh('settings.json');
    const minDeposit = settings.resellerMinDeposit || 50000;
    const amount = parseInt(req.body.amount);
    if (isNaN(amount) || amount < minDeposit) {
      return res.json({ success: false, message: `Minimal top up Rp ${minDeposit.toLocaleString('id-ID')}` });
    }

    const orderId = `DEP-${Date.now()}`;
    const refId = uuidv4();
    const orderCode = generateOrderCode();
    const qrisMode = settings.qrisMode || 'static';

    let qrString = null, isStatic = false, totalPayment = amount, expiredAt = null, pakasirTxnId = null;

    if (qrisMode === 'static') {
      if (!settings.qrisStaticImage) return res.json({ success: false, message: 'Admin belum mengatur QRIS. Hubungi admin.' });
      isStatic = true;
    } else {
      try {
        const r = await createQRISPayment(orderId, amount, settings);
        qrString = r.qr_string;
        pakasirTxnId = r.txn_id;
        // total_payment dari Pakasir = amount + fee mereka (kalau ada). Ini
        // CUMA buat ditampilkan ke user biar nominal yang ditampilkan sama
        // persis dengan yang diminta di QR code-nya. Saldo yang dikreditkan
        // tetap pakai `amount` asli (lihat field `amount` di transaksi di
        // bawah) supaya fee Pakasir tidak ikut numpang masuk ke saldo user.
        totalPayment = r.total_payment || amount;
        expiredAt = r.expired_at || null;
      } catch (e) {
        if (settings.qrisStaticImage) { isStatic = true; }
        else return res.json({ success: false, message: 'QRIS error: ' + e.message });
      }
    }

    const transactions = readDB('transactions.json');
    transactions.push({
      id: refId, orderId, code: orderCode,
      userId: user.id, type: 'deposit',
      productName: 'Top Up Saldo Reseller',
      amount,
      customerName: user.username, wa: user.wa,
      price: amount, totalPayment, expiredAt, qrString, isStatic, pakasirTxnId,
      status: 'pending', key: null,
      createdAt: new Date().toISOString(), time: formatDate()
    });
    await writeDB('transactions.json', transactions);

    res.json({ success: true, refId, orderId, qrString, orderCode, isStatic, totalPayment, expiredAt,
      qrisStaticImage: isStatic ? settings.qrisStaticImage : null });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Beli key langsung pakai saldo wallet (khusus reseller) — tanpa scan QRIS,
// saldo langsung terpotong dan key langsung diberikan.
app.post('/wallet/buy', requireAuth, async (req, res) => {
  // Cegah race condition double-spend: tolak request kedua kalau request
  // sebelumnya dari user yang sama masih diproses (lihat komentar di
  // deklarasi walletLocks).
  if (walletLocks.has(req.session.userId)) {
    return res.json({ success: false, message: 'Transaksi sebelumnya masih diproses, tunggu sebentar...' });
  }
  walletLocks.add(req.session.userId);
  try {
    if (req.session.isAdmin) return res.json({ success: false, message: 'Admin tidak bisa membeli produk' });
    const { productId, duration, customerName, wa, voucherCode } = req.body;

    const users = await readFresh('users.json');
    const user = users.find(u => u.id === req.session.userId);
    if (!user) return res.json({ success: false, message: 'User tidak ditemukan' });
    if (!user.is_reseller) return res.json({ success: false, message: 'Fitur beli pakai saldo khusus Reseller VIP' });

    const products = await readFresh('products.json');
    const product = products.find(p => p.id === productId);
    if (!product || product.status !== 'active') return res.json({ success: false, message: 'Produk tidak ditemukan' });
    if (!product.keys || product.keys.length === 0) return res.json({ success: false, message: 'Stok habis' });

    // Resolusi paket (harga + durasi hari/jam) — sama seperti /create-order
    const pkg = dur.resolvePackage(product, duration);
    if (!pkg) return res.json({ success: false, message: 'Durasi tidak valid' });
    if (dur.stockFor(product.keys, pkg.value, pkg.unit) === 0) return res.json({ success: false, message: 'Stok paket ini habis' });
    let price = pkg.price;
    const selectedDays = pkg.value, selectedUnit = pkg.unit;

    const settings = await readFresh('settings.json');
    // Prioritas harga: reseller_price manual per-paket → global diskon %
    if (pkg.resellerPrice != null && pkg.resellerPrice >= 0) {
      price = pkg.resellerPrice;
    } else {
      const disc = settings.resellerDiscount || 20;
      price = Math.round(price * (1 - disc / 100));
    }

    // Terapkan voucher (setelah diskon reseller) — opsional, sama seperti /create-order
    let voucherDiscount = 0, appliedVoucher = null, originalPrice = price;
    if (voucherCode && voucherCode.trim()) {
      const vResult = await validateVoucher(voucherCode, price, req.session.userId);
      if (vResult.valid) {
        voucherDiscount = vResult.discount;
        price = vResult.finalPrice;
        appliedVoucher = vResult.voucher;
      } else {
        return res.json({ success: false, message: 'Voucher: ' + vResult.error });
      }
    }

    const balance = user.balance || 0;
    if (balance < price) {
      return res.json({ success: false, message: 'insufficient_balance', shortfall: price - balance,
        needed: price, balance, plainMessage: `Saldo tidak cukup. Kurang Rp ${(price - balance).toLocaleString('id-ID')}, top up dulu yuk!` });
    }

    // Ambil key sesuai durasi (KEY:7 = 7 hari, KEY:12h = 12 jam), fallback key generik
    const key = dur.takeKey(product.keys, selectedDays, selectedUnit);
    if (!key) return res.json({ success: false, message: 'Stok habis' });

    // Potong saldo & catat transaksi — lakukan setelah key berhasil diambil
    user.balance = balance - price;
    product.sold = (product.sold || 0) + 1;
    await writeDB('users.json', users);
    await writeDB('products.json', products);

    const refId = uuidv4();
    const orderCode = generateOrderCode();
    const transactions = await readFresh('transactions.json');
    transactions.push({
      id: refId, orderId: `WLT-${Date.now()}`, code: orderCode,
      userId: user.id, productId: product.id, productName: product.name,
      duration, selectedDays, selectedUnit,
      originalPrice: voucherDiscount > 0 ? originalPrice : undefined,
      voucherCode: appliedVoucher ? appliedVoucher.code : undefined,
      voucherDiscount: voucherDiscount > 0 ? voucherDiscount : undefined,
      price, totalPayment: price, paymentMethod: 'wallet',
      customerName: customerName || user.username, wa: wa || user.wa,
      status: 'done', key, paidAt: new Date().toISOString(),
      createdAt: new Date().toISOString(), time: formatDate()
    });
    await writeDB('transactions.json', transactions);

    if (appliedVoucher) {
      const vouchers = await readFresh('vouchers.json');
      const v = vouchers.find(v => v.id === appliedVoucher.id);
      if (v) {
        v.usedCount = (v.usedCount || 0) + 1;
        v.usages = v.usages || [];
        v.usages.push({ userId: req.session.userId, usedAt: new Date().toISOString(), orderId: refId });
        await writeDB('vouchers.json', vouchers);
      }
    }

    const notifs = readDB('notifications.json');
    notifs.unshift({ id: uuidv4(), type: 'purchase', buyerName: customerName || user.username,
      buyerPhoto: user.photo || null, productName: product.name,
      price, time: new Date().toISOString(), timeStr: formatDate() });
    await writeDB('notifications.json', notifs.slice(0, 50));

    res.json({ success: true, key, code: orderCode, balance: user.balance, voucherDiscount: voucherDiscount || undefined });
  } catch (e) {
    console.error('[wallet/buy] error:', e.message);
    res.json({ success: false, message: 'Terjadi kesalahan: ' + e.message });
  } finally {
    walletLocks.delete(req.session.userId);
  }
});

// ── PROFILE PHOTO ──
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = isVercel ? '/tmp/avatars' : path.join(__dirname, 'public', 'uploads', 'avatars');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `${req.session.userId}-${Date.now()}${path.extname(file.originalname)}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg','image/jpg','image/png','image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Format harus JPEG/PNG/WebP'));
  }
});

app.post('/profile/photo', requireAuth, avatarUpload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, message: 'File tidak valid' });

    // Admin tidak punya entry di users.json
    if (req.session.userId === 'admin') {
      return res.json({ success: false, message: 'Admin tidak bisa ganti foto profil dari sini' });
    }

    const users = readDB('users.json');
    const user  = users.find(u => u.id === req.session.userId);
    if (!user) return res.json({ success: false, message: 'User tidak ditemukan' });

    // Hapus foto lama jika ada
    if (user.photo) {
      const oldPath = path.join(__dirname, 'public', user.photo.replace(/^\//, ''));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    if (!isVercel) { user.photo = `/uploads/avatars/${req.file.filename}`; }
    else { try { user.photo = await db.uploadImage(require('fs').readFileSync(req.file.path), req.file.originalname, req.file.mimetype); } catch (e) { return res.json({ success: false, message: 'Upload gagal: ' + e.message }); } }
    await writeDB('users.json', users);
    res.json({ success: true, photo: user.photo });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ── BANNER CAROUSEL ──
const bannerCarouselUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = isVercel ? '/tmp/banners' : path.join(__dirname, 'public', 'uploads', 'banners');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `banner-${Date.now()}${path.extname(file.originalname)}`);
    }
  }),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg','image/jpg','image/png','image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Format harus JPEG/PNG/WebP'));
  }
});

app.get('/api/banners', async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=120');
  // readSmart (cache ber-TTL), bukan readFresh: endpoint publik ini dipanggil
  // tiap kali homepage dibuka.
  const settings = await readSmart('settings.json');
  if (normalizeBanners(settings)) await writeDB('settings.json', settings);
  res.json((settings.banners || []).filter(b => b.active !== false));
});

app.post('/admin/banners/add', requireAdmin, bannerCarouselUpload.single('bannerImg'), async (req, res) => {
  try {
    const { title, subtitle, link, imageUrl } = req.body;
    const settings = await readFresh('settings.json');
    if (!settings.banners) settings.banners = [];
    let imgSrc = imageUrl?.trim() || '';
    if (req.file) {
      if (!isVercel) {
        imgSrc = `/uploads/banners/${req.file.filename}`;
      } else {
        try {
          imgSrc = await db.uploadImage(require('fs').readFileSync(req.file.path), req.file.originalname, req.file.mimetype);
        } catch (uploadErr) {
          // PENTING (biaya): JANGAN diam-diam embed base64 ke settings.json.
          // settings.json di-load ULANG di HAMPIR SETIAP request (lihat
          // middleware "Inject settings" di atas) -> kalau ada banner base64
          // beberapa ratus KB nyangkut di sana, itu ke-transfer berkali-kali
          // ke SETIAP pengunjung SETIAP halaman -> jebol Fast Data Transfer
          // Vercel dan bandwidth Supabase dalam hitungan jam.
          // Solusi: kalau upload ke Supabase Storage gagal, tolak upload dan
          // suruh admin cek konfigurasi storage (bucket 'product-images'
          // harus ada & public), daripada nyimpen data raksasa ke blob.
          console.error('[banner-upload] Supabase Storage gagal, upload ditolak:', uploadErr.message);
          return res.json({
            success: false,
            message: 'Upload ke storage gagal (cek SUPABASE_URL/SERVICE_ROLE_KEY & bucket "product-images"). Base64 fallback dimatikan supaya tidak membengkakkan kuota — coba lagi setelah storage dibetulkan.'
          });
        }
      }
    }
    if (!imgSrc) return res.json({ success: false, message: 'Gambar banner wajib diisi' });
    settings.banners.push({
      id: uuidv4(),
      imageUrl: imgSrc,
      title: title?.trim() || '',
      subtitle: subtitle?.trim() || '',
      link: link?.trim() || '/',
      active: true,
      createdAt: new Date().toISOString()
    });
    await writeDB('settings.json', settings);
    res.json({ success: true, banners: settings.banners });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/admin/banners/delete/:id', requireAdmin, async (req, res) => {
  try {
    const settings = await readFresh('settings.json');
    const old = (settings.banners || []).find(b => b.id === req.params.id);
    if (old?.imageUrl?.startsWith('/uploads/banners/')) {
      const fp = path.join(__dirname, 'public', old.imageUrl);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    settings.banners = (settings.banners || []).filter(b => b.id !== req.params.id);
    await writeDB('settings.json', settings);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/admin/banners/toggle/:id', requireAdmin, async (req, res) => {
  try {
    const settings = await readFresh('settings.json');
    const b = (settings.banners || []).find(b => b.id === req.params.id);
    if (b) b.active = !b.active;
    await writeDB('settings.json', settings);
    res.json({ success: true, active: b?.active });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ── QRIS STATIS UPLOAD ──
const qrisUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = isVercel ? '/tmp' : path.join(__dirname, 'public', 'uploads');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `qris-static${path.extname(file.originalname)}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg','image/jpg','image/png','image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Format harus JPEG/PNG/WebP'));
  }
});

app.post('/admin/qris/upload', requireAdmin, qrisUpload.single('qrisImage'), async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, message: 'File tidak valid' });
    const settings = await readFresh('settings.json');
    if (!isVercel) {
      settings.qrisStaticImage = `/uploads/${req.file.filename}`;
    } else {
      try { settings.qrisStaticImage = await db.uploadImage(require('fs').readFileSync(req.file.path), req.file.originalname, req.file.mimetype); } catch (e) { return res.json({ success: false, message: e.message }); }
    }
    await writeDB('settings.json', settings);
    res.json({ success: true, path: settings.qrisStaticImage });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/profile/me', requireAuth, (req, res) => {
  if (req.session.isAdmin) {
    const s = readDB('settings.json');
    return res.json({ success: true, user: { id: 'admin', username: s.adminUsername || 'Admin', isAdmin: true, is_reseller: false, photo: null } });
  }
  const users = readDB('users.json');
  const user  = users.find(u => u.id === req.session.userId);
  if (!user) return res.json({ success: false });
  const { password: _, ...safe } = user;
  res.json({ success: true, user: safe });
});

// ── User Dashboard ──
app.get('/dashboard', requireAuth, (req, res) => {
  const transactions = readDB('transactions.json');
  const user = getSessionUser(req);
  const settings = readDB('settings.json');

  // Filter transaksi milik user ini
  const myTransactions = transactions.filter(t => t.userId === req.session.userId);
  const totalOrders = myTransactions.length;
  const successOrders = myTransactions.filter(t => t.status === 'done').length;
  const pendingOrders = myTransactions.filter(t => t.status === 'pending').length;
  const totalSpent = myTransactions.filter(t => t.status === 'done').reduce((s, t) => s + (t.price || 0), 0);
  const doneTransactions = myTransactions.filter(t => t.status === 'done').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const recentTransactions = myTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 20);

  res.render('pages/dashboard', {
    user, settings,
    stats: { totalOrders, successOrders, pendingOrders, totalSpent },
    doneTransactions,
    transactions: recentTransactions,
    walletTransactions: myTransactions.filter(t => t.type === 'deposit' || t.type === 'adjustment').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 15)
  });
});

// Product routes
app.get('/buy/:id', requireAuth, (req, res) => {
  const products = readDB('products.json');
  const product = products.find(p => p.id === req.params.id);

  if (!product || product.status !== 'active') {
    return res.redirect('/');
  }

  // Pakai res.locals.settings yang sudah di-fetch oleh middleware (readFresh fallback)
  const settings = res.locals.settings || readDB('settings.json');
  const user = res.locals.user || getSessionUser(req);

  const isReseller = !!(user?.is_reseller);
  const resellerDiscount = settings.resellerDiscount || 20;
  const allKeys = product.keys || [];
  if (product.items) {
    product.items = product.items.map(item => {
      const pd = dur.fromLabel(item.l);           // { value, unit } hari/jam, null kalau label tak berpola
      const stok = pd ? dur.stockFor(allKeys, pd.value, pd.unit) : dur.countGeneric(allKeys);
      // Prioritas harga reseller: 1) harga manual per-produk jika ada,
      // 2) harga dari pricingOptions, 3) fallback ke global diskon %
      let computedResellerPrice = null;
      if (isReseller) {
        if (item.reseller_price != null && item.reseller_price >= 0) {
          computedResellerPrice = item.reseller_price;
        } else {
          const pOpt = pd ? (product.pricingOptions || []).find(o => parseInt(o.days, 10) === pd.value && dur.normUnit(o.unit) === pd.unit) : null;
          if (pOpt?.reseller_price != null && pOpt.reseller_price >= 0) {
            computedResellerPrice = pOpt.reseller_price;
          } else {
            computedResellerPrice = Math.round(item.p * (1 - resellerDiscount / 100));
          }
        }
      }
      return { ...item, stok, reseller_price: computedResellerPrice };
    });
  }

  // Cek apakah user sudah pernah membeli (transaksi sukses) produk ini
  const transactions = readDB('transactions.json');
  const hasPurchased = transactions.some(t =>
    t.userId === user?.id &&
    t.productId === product.id &&
    t.status === 'done'
  );

  res.render('pages/buy', { product, settings, user, isReseller, hasPurchased });
});

app.post('/create-order', requireAuth, async (req, res) => {
  try {
    const { productId, duration, customerName, wa, voucherCode } = req.body;
    const products = await readFresh('products.json');
    const product = products.find(p => p.id === productId);

    if (!product || product.status !== 'active') return res.json({ success: false, message: 'Produk tidak ditemukan' });
    if (!product.keys || product.keys.length === 0) return res.json({ success: false, message: 'Stok habis' });

    // Resolusi paket (harga + durasi hari/jam) — lihat duration.js
    const pkg = dur.resolvePackage(product, duration);
    if (!pkg) return res.json({ success: false, message: 'Durasi tidak valid' });
    if (dur.stockFor(product.keys, pkg.value, pkg.unit) === 0) return res.json({ success: false, message: 'Stok paket ini habis' });
    let price = pkg.price;
    const selectedDays = pkg.value, selectedUnit = pkg.unit;

    const settings = readDB('settings.json');
    // Harga reseller: harga manual per-paket jika ada, fallback global diskon %
    const orderUser = getSessionUser(req);
    if (orderUser?.is_reseller) {
      if (pkg.resellerPrice != null && pkg.resellerPrice >= 0) {
        price = pkg.resellerPrice;
      } else {
        const disc = settings.resellerDiscount || 20;
        price = Math.round(price * (1 - disc / 100));
      }
    }

    // Terapkan voucher (setelah diskon reseller)
    let voucherDiscount = 0, appliedVoucher = null, originalPrice = price;
    if (voucherCode && voucherCode.trim()) {
      const vResult = await validateVoucher(voucherCode, price, req.session.userId);
      if (vResult.valid) {
        voucherDiscount = vResult.discount;
        price = vResult.finalPrice;
        appliedVoucher = vResult.voucher;
      } else {
        return res.json({ success: false, message: 'Voucher: ' + vResult.error });
      }
    }

    const qrisMode = settings.qrisMode || 'static';
    const orderId = `VR-${Date.now()}`;
    const refId = uuidv4();
    const orderCode = generateOrderCode();

    let qrString = null, isStatic = false, totalPayment = price, expiredAt = null, pakasirTxnId = null;

    if (qrisMode === 'static') {
      if (!settings.qrisStaticImage) return res.json({ success: false, message: 'Upload gambar QRIS di admin panel terlebih dahulu.' });
      isStatic = true;
    } else {
      try {
        const r = await createQRISPayment(orderId, price, settings);
        qrString = r.qr_string;
        pakasirTxnId = r.txn_id;
        totalPayment = r.total_payment || price;
        expiredAt = r.expired_at || null;
      } catch (error) {
        if (settings.qrisStaticImage) { isStatic = true; }
        else return res.json({ success: false, message: 'QRIS API error: ' + error.message });
      }
    }

    const transactions = await readFresh('transactions.json');

    // Cegah transaksi duplikat: tolak jika ada pending untuk produk yang sama dalam 30 menit
    const existingPending = transactions.find(t =>
      t.userId === req.session.userId &&
      t.productId === productId &&
      t.status === 'pending' &&
      (Date.now() - new Date(t.createdAt).getTime()) < 30 * 60 * 1000
    );
    if (existingPending) {
      return res.json({ success: false, message: 'Kamu masih memiliki pesanan pending untuk produk ini. Selesaikan pembayaran atau tunggu 30 menit.' });
    }

    transactions.push({
      id: refId, orderId, code: orderCode,
      userId: req.session.userId, productId: product.id, productName: product.name,
      duration, selectedDays, selectedUnit,
      originalPrice: voucherDiscount > 0 ? originalPrice : undefined,
      voucherCode: appliedVoucher ? appliedVoucher.code : undefined,
      voucherDiscount: voucherDiscount > 0 ? voucherDiscount : undefined,
      price, totalPayment,
      customerName, wa, qrString, isStatic, pakasirTxnId,
      status: 'pending', key: null,
      createdAt: new Date().toISOString(), time: formatDate()
    });
    await writeDB('transactions.json', transactions);

    // Catat pemakaian voucher jika dipakai
    if (appliedVoucher) {
      const vouchers = await readFresh('vouchers.json');
      const v = vouchers.find(v => v.id === appliedVoucher.id);
      if (v) {
        v.usedCount = (v.usedCount || 0) + 1;
        v.usages = v.usages || [];
        v.usages.push({ userId: req.session.userId, usedAt: new Date().toISOString(), orderId: refId });
        await writeDB('vouchers.json', vouchers);
      }
    }

    res.json({ success: true, refId, orderId, qrString, orderCode, isStatic, totalPayment, expiredAt,
      voucherDiscount: voucherDiscount || undefined,
      qrisStaticImage: isStatic ? settings.qrisStaticImage : null });
  } catch (error) {
    console.error('[create-order] error:', error.message);
    res.json({ success: false, message: 'Terjadi kesalahan: ' + error.message });
  }
});

const gatewayCheckAt = new Map(); // refId -> timestamp panggilan terakhir ke gateway
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of gatewayCheckAt) if (v < cutoff) gatewayCheckAt.delete(k);
}, 10 * 60 * 1000).unref();

const buildDoneResponse = (transaction) => {
  if (transaction.type === 'reseller') return { success: true, status: 'done', type: 'reseller' };
  if (transaction.type === 'deposit') {
    const u = readDB('users.json').find(u => u.id === transaction.userId);
    return { success: true, status: 'done', type: 'deposit', balance: u?.balance || 0 };
  }
  return { success: true, status: 'done', key: transaction.key, code: transaction.code, outOfStock: !!transaction.outOfStock };
};

// Penuhi transaksi yang SUDAH terbukti dibayar (dipanggil dari polling /check-payment
// maupun webhook Pakasir). Idempotent: kalau sudah 'done' langsung kembalikan hasilnya.
// Pemanggil WAJIB memegang lock processingOrders untuk refId ini.
async function fulfillPaid(refId, settings) {
  const transactions = await readFresh('transactions.json');
  const transaction = transactions.find(t => t.id === refId);
  if (!transaction) return { success: false, message: 'Transaksi tidak ditemukan' };
  if (transaction.status === 'done') return buildDoneResponse(transaction);

  // Upgrade reseller
  if (transaction.type === 'reseller') {
    const users = await readFresh('users.json');
    const u = users.find(u => u.id === transaction.userId);
    if (u) {
      u.is_reseller = true;
      u.role = 'reseller';
      u.reseller_since = new Date().toISOString();
      u.reseller_code = 'RSL-' + u.username.toUpperCase().slice(0, 4) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
      await writeDB('users.json', users);
    }
    transaction.status = 'done';
    transaction.paidAt = new Date().toISOString();
    await writeDB('transactions.json', transactions);
    return { success: true, status: 'done', type: 'reseller' };
  }

  // Top up saldo wallet
  if (transaction.type === 'deposit') {
    const users = await readFresh('users.json');
    const u = users.find(u => u.id === transaction.userId);
    if (u) {
      u.balance = (u.balance || 0) + (transaction.amount || transaction.price || 0);
      await writeDB('users.json', users);
    }
    transaction.status = 'done';
    transaction.paidAt = new Date().toISOString();
    await writeDB('transactions.json', transactions);
    return { success: true, status: 'done', type: 'deposit', balance: u?.balance || 0 };
  }

  // Produk biasa: ambil key sesuai durasi (hari/jam)
  const products = await readFresh('products.json');
  const product = products.find(p => p.id === transaction.productId);
  const key = product ? dur.takeKey(product.keys, transaction.selectedDays, transaction.selectedUnit) : null;
  let outOfStock = false;

  if (key) {
    product.sold = (product.sold || 0) + 1;
    await writeDB('products.json', products);
  } else {
    // Stok habis — jangan kirim key palsu. Tandai transaksi & beri tahu admin via WA.
    outOfStock = true;
  }

  transaction.status = 'done';
  transaction.key = key;
  transaction.outOfStock = outOfStock;
  transaction.paidAt = new Date().toISOString();
  await writeDB('transactions.json', transactions);

  if (outOfStock) {
    const durTxt = transaction.selectedDays ? ` (${dur.human(transaction.selectedDays, transaction.selectedUnit)})` : '';
    const waMsg = `⚠️ STOK HABIS - Pesanan butuh diproses manual!\n\n` +
      `Order: ${transaction.code}\n` +
      `Produk: ${transaction.productName}${durTxt}\n` +
      `Customer: ${transaction.customerName} (${transaction.wa || '-'})\n` +
      `Total: Rp ${Number(transaction.price).toLocaleString('id-ID')}\n\n` +
      `Pembayaran sudah masuk tapi stok key kosong. Segera restock & kirim key manual ke pembeli.`;
    sendWhatsAppNotif(settings.contact?.whatsapp, waMsg, settings).catch(() => {});
  }

  const notifs = await readFresh('notifications.json');
  const buyer = readDB('users.json').find(u => u.id === transaction.userId);
  notifs.unshift({ id: uuidv4(), type: 'purchase', buyerName: transaction.customerName,
    buyerPhoto: buyer?.photo || null, productName: transaction.productName,
    price: transaction.price, time: transaction.paidAt, timeStr: formatDate(new Date(transaction.paidAt)) });
  await writeDB('notifications.json', notifs.slice(0, 50));

  return { success: true, status: 'done', key, code: transaction.code, outOfStock };
}

// Cek status ke Pakasir v2 dan validasi: harus 'completed', nominal sama dengan
// transaksi kita, order_id cocok, dan bukan transaksi sandbox (kecuali mode sandbox).
// return 'paid' | 'expired' | 'pending'
async function verifyPakasirPaid(transaction, settings, knownTxnId) {
  const txnId = knownTxnId || await ensurePakasirTxnId(transaction, settings);
  const r = await getPakasirStatus(txnId, settings);
  const status = String(r.status || '').toLowerCase();
  if (status === 'canceled' || status === 'cancelled' || status === 'expired') return 'expired';
  if (status !== 'completed') {
    if (status !== 'pending') console.warn(`[pakasir] Status tidak dikenali untuk order ${transaction.orderId}: "${status}"`);
    return 'pending';
  }
  if (r.order_id && r.order_id !== transaction.orderId) {
    console.error(`[pakasir] order_id tidak cocok: ${r.order_id} != ${transaction.orderId}`);
    return 'pending';
  }
  if (r.amount != null && Number(r.amount) !== Number(transaction.price)) {
    console.error(`[pakasir] Nominal tidak cocok untuk ${transaction.orderId}: pakasir=${r.amount} kita=${transaction.price}`);
    return 'pending';
  }
  if (r.is_sandbox && !getPakasirCfg(settings).sandboxOk) {
    console.warn(`[pakasir] Transaksi sandbox ${transaction.orderId} diabaikan (mode production).`);
    return 'pending';
  }
  return 'paid';
}

app.get('/check-payment/:refId', requireAuth, async (req, res) => {
  const refId = req.params.refId;
  // Cegah race condition: jika transaksi sedang diproses, kembalikan pending
  if (processingOrders.has(refId)) {
    return res.json({ success: true, status: 'pending' });
  }
  processingOrders.add(refId);
  try {
    const transactions = readDB('transactions.json');
    const transaction = transactions.find(t => t.id === refId);
    if (!transaction) return res.json({ success: false, message: 'Transaksi tidak ditemukan' });
    if (transaction.status === 'done') return res.json(buildDoneResponse(transaction));
    if (transaction.status === 'expired') return res.json({ success: true, status: 'expired' });

    // Static QRIS: tunggu konfirmasi manual admin
    if (transaction.isStatic) return res.json({ success: true, status: 'pending_static' });

    // Pakasir v2: maks 1x per 4 detik per transaksi (+ hemat CPU function)
    const lastGw = gatewayCheckAt.get(refId) || 0;
    if (Date.now() - lastGw < 4000) return res.json({ success: true, status: 'pending' });
    gatewayCheckAt.set(refId, Date.now());

    const settings = await readFresh('settings.json');
    let verdict = 'pending';
    try {
      const hadTxnId = !!transaction.pakasirTxnId;
      verdict = await verifyPakasirPaid(transaction, settings);
      if (!hadTxnId && transaction.pakasirTxnId) await writeDB('transactions.json', transactions);
    } catch (e) {
      console.error(`[check-payment] Gagal cek status order ${transaction.orderId}:`, e.message);
    }

    if (verdict === 'expired') {
      transaction.status = 'expired';
      await writeDB('transactions.json', transactions);
      return res.json({ success: true, status: 'expired' });
    }
    if (verdict === 'paid') {
      return res.json(await fulfillPaid(refId, settings));
    }
    res.json({ success: true, status: transaction.status });
  } catch (error) {
    console.error('[check-payment] error:', error.message);
    res.json({ success: false, message: error.message });
  } finally {
    processingOrders.delete(refId);
  }
});

// ── Webhook Pakasir v2 ─────────────────────────────────────────────
// Set "Webhook URL" di dashboard project Pakasir ke:
//   https://DOMAIN-KAMU/api/webhooks/pakasir
// Header X-Secret dicocokkan dengan secret di Admin → Setting (jika diisi).
// Payload TIDAK dipercaya begitu saja: status dicek ulang ke API transaction-status
// (sumber kebenaran) dan nominal harus sama dengan transaksi kita.
// Selalu balas 200 untuk payload yang valid-tapi-diabaikan supaya Pakasir tidak retry;
// balas 5xx hanya kalau verifikasi gagal sementara (agar dicoba lagi).
const pakasirWebhook = async (req, res) => {
  try {
    const settings = await readFresh('settings.json');
    const cfg = getPakasirCfg(settings);
    if (cfg.webhookSecret && !safeEqual(req.get('X-Secret') || '', cfg.webhookSecret)) {
      return res.status(401).json({ success: false, message: 'Invalid secret' });
    }
    const b = req.body || {};
    const orderId = String(b.order_id || '');
    if (!orderId || String(b.status || '').toLowerCase() !== 'completed') {
      return res.json({ success: true, ignored: true });
    }

    const transactions = await readFresh('transactions.json');
    const t = transactions.find(x => x.orderId === orderId);
    if (!t) return res.json({ success: true, ignored: true });
    if (t.status === 'done') return res.json({ success: true, already: true });
    if (Number(b.amount) !== Number(t.price)) {
      console.error(`[pakasir-webhook] Nominal tidak cocok ${orderId}: webhook=${b.amount} kita=${t.price}`);
      return res.json({ success: true, ignored: true });
    }
    if (processingOrders.has(t.id)) return res.json({ success: true, processing: true });

    processingOrders.add(t.id);
    try {
      const verdict = await verifyPakasirPaid(t, settings, b.txn_id || t.pakasirTxnId);
      if (verdict !== 'paid') return res.json({ success: true, ignored: true });
      await fulfillPaid(t.id, settings);
    } finally {
      processingOrders.delete(t.id);
    }
    res.json({ success: true });
  } catch (e) {
    console.error('[pakasir-webhook] error:', e.message);
    res.status(500).json({ success: false });
  }
};
app.post('/api/webhooks/pakasir', pakasirWebhook);
app.post('/pakasir-webhook', pakasirWebhook);

app.get('/invoice', (req, res) => {
  if (!checkInvoiceRateLimit(req.ip)) {
    return res.render('pages/invoice', { transaction: null, error: 'Terlalu banyak pencarian. Coba lagi dalam 5 menit.' });
  }
  const { code } = req.query;
  if (code) {
    const transactions = readDB('transactions.json');
    const transaction = transactions.find(t => t.code === code.toUpperCase());
    return res.render('pages/invoice', { transaction: transaction || null, error: transaction ? null : 'Pesanan tidak ditemukan' });
  }
  res.render('pages/invoice', { transaction: null, error: null });
});

app.post('/invoice', (req, res) => {
  if (!checkInvoiceRateLimit(req.ip)) {
    return res.render('pages/invoice', { transaction: null, error: 'Terlalu banyak pencarian. Coba lagi dalam 5 menit.' });
  }
  const { code } = req.body;
  const transactions = readDB('transactions.json');
  const transaction = transactions.find(t => t.code === code.toUpperCase());

  if (!transaction) {
    return res.render('pages/invoice', { transaction: null, error: 'Pesanan tidak ditemukan' });
  }

  res.render('pages/invoice', { transaction, error: null });
});

// Admin routes
// Heartbeat dari tab admin yang masih terbuka — requireAdmin di atasnya
// sudah otomatis menolak (sessionRevoked) kalau lock sudah diambil device
// lain, dan otomatis memperpanjang lastSeen kalau masih sah.
app.post('/admin/session/heartbeat', requireAdmin, (req, res) => {
  res.json({ success: true });
});

// Status koneksi Supabase, dipakai widget "Status Database" di Settings.
// BUG SEBELUMNYA: frontend sudah fetch('/admin/db-status') tapi route ini
// belum pernah didaftarkan → selalu 404 → ketangkep catch(e){} kosong di
// frontend → teks "Memeriksa koneksi..." nyangkut selamanya, padahal
// koneksi Supabase-nya sendiri sebenarnya baik-baik saja.
app.get('/admin/db-status', requireAdmin, async (req, res) => {
  try {
    const status = await db.getDbStatus();
    res.json(status);
  } catch (e) {
    res.json({ connected: false, errorMsg: e.message });
  }
});

app.get('/admin', requireAdmin, async (req, res) => {
  // ── FIX: readFresh() bypass cache per-instance Vercel ──
  // Sebelumnya pakai readDB (cache lokal tiap instance), jadi setelah
  // tambah/edit produk di satu instance, refresh halaman bisa nyasar ke
  // instance lain yang cache-nya masih lama → produk kelihatan hilang/berubah.
  const [products, transactions, users, settings] = await Promise.all([
    readFresh('products.json'),
    readFresh('transactions.json'),
    readFresh('users.json'),
    readFresh('settings.json')
  ]);
  if (normalizeBanners(settings)) await writeDB('settings.json', settings);

  const stats = {
    totalProducts: products.length,
    activeProducts: products.filter(p => p.status === 'active').length,
    totalTransactions: transactions.length,
    pendingTransactions: transactions.filter(t => t.status === 'pending').length,
    doneTransactions: transactions.filter(t => t.status === 'done').length,
    totalUsers: users.length,
    totalResellers: users.filter(u => u.is_reseller).length,
    totalRevenue: transactions.filter(t => t.status === 'done').reduce((sum, t) => sum + t.price, 0)
  };

  // Data chart: 7 hari terakhir
  const chartData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayTrx = transactions.filter(t => t.status === 'done' && t.createdAt && t.createdAt.slice(0, 10) === dateStr);
    chartData.push({
      date: d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }),
      count: dayTrx.length,
      revenue: dayTrx.reduce((s, t) => s + t.price, 0)
    });
  }

  res.render('pages/admin', {
    layout: false,
    products,
    transactions: transactions.slice(-20).reverse(),
    users,
    settings,
    stats,
    chartData
  });
});

// Helper: parse pricingOptions (hari + jam) — lihat duration.js
const parsePricingOptions = dur.parsePricingOptions;

// Helper: validasi URL gambar (cegah XSS via javascript:/data: protocol)
const isValidImageUrl = (url) => {
  if (!url) return true;
  const lower = url.toLowerCase().trim();
  return !lower.startsWith('javascript:') && !lower.startsWith('data:') && !lower.startsWith('vbscript:');
};

app.post('/admin/product/add', requireAdmin, (req, res, next) => {
  upload.single('image')(req, res, err => {
    if (err) return res.json({ success: false, message: 'Upload error: ' + err.message });
    next();
  });
}, async (req, res) => {
  try {
    const {name,category,description,imageUrl:imgUrl,pricingDays,pricingPrices,pricingResellerPrices,pricingUnits,keys,status}=req.body;
    if(!name)return res.json({success:false,message:'Nama produk wajib diisi'});
    if(imgUrl && !isValidImageUrl(imgUrl)) return res.json({success:false,message:'URL gambar tidak valid'});
    const products=await readFresh('products.json');
    const pricingOptions=parsePricingOptions(pricingDays,pricingPrices,pricingResellerPrices,pricingUnits);
    if(!pricingOptions.length)return res.json({success:false,message:'Tambahkan minimal 1 opsi harga'});
    const keyArray=keys?keys.split('\n').map(k=>k.trim()).filter(k=>k):[];
    let image = imgUrl?.trim() || '';
    if (req.file) {
      if (!isVercel) {
        image = `/uploads/products/${req.file.filename}`;
      } else {
        try {
          image = await db.uploadImage(require('fs').readFileSync(req.file.path), req.file.originalname, req.file.mimetype);
        } catch { image = imgUrl?.trim() || '/images/placeholder.jpg'; }
      }
    }
    if (!image) image = '/images/placeholder.jpg';
    const items=pricingOptions.map(o=>({l:dur.makeLabel(name,o.days,o.unit),p:o.price,reseller_price:o.reseller_price}));
    const newProduct={id:uuidv4(),name,category:category||'freefire',description:description||'',image,pricingOptions,items,status:status==='inactive'?'inactive':'active',keys:keyArray,sold:0,createdAt:new Date().toISOString()};
    products.push(newProduct);await writeDB('products.json',products);
    res.json({success:true,product:newProduct});
  }catch(error){res.json({success:false,message:error.message});}
});

app.post('/admin/product/edit/:id', requireAdmin, (req, res, next) => {
  upload.single('image')(req, res, err => {
    if (err) return res.json({ success: false, message: 'Upload error: ' + err.message });
    next();
  });
}, async (req, res) => {
  try {
    const {name,category,description,imageUrl:imgUrl,pricingDays,pricingPrices,pricingResellerPrices,pricingUnits,keys,keysMode,status}=req.body;
    const products=await readFresh('products.json');
    const product=products.find(p=>p.id===req.params.id);
    if(!product)return res.json({success:false,message:'Produk tidak ditemukan'});
    if(imgUrl && !isValidImageUrl(imgUrl)) return res.json({success:false,message:'URL gambar tidak valid'});
    if(name)product.name=name;if(category)product.category=category;
    if(description!==undefined)product.description=description;if(status)product.status=status;
    if(pricingDays){const opts=parsePricingOptions(pricingDays,pricingPrices,pricingResellerPrices,pricingUnits);if(opts.length){product.pricingOptions=opts;product.items=opts.map(o=>({l:dur.makeLabel(product.name,o.days,o.unit),p:o.price,reseller_price:o.reseller_price}));}}
    if(keys!==undefined&&keys!==null){const nk=keys.split('\n').map(k=>k.trim()).filter(k=>k);product.keys=keysMode==='append'?[...(product.keys||[]),...nk]:nk;}
    if (req.file) {
      if (!isVercel) product.image=`/uploads/products/${req.file.filename}`;
      else { try { product.image = await db.uploadImage(require('fs').readFileSync(req.file.path), req.file.originalname, req.file.mimetype); } catch {} }
    }
    else if(imgUrl?.trim()) product.image=imgUrl.trim();
    await writeDB('products.json',products);res.json({success:true,product});
  }catch(error){res.json({success:false,message:error.message});}
});

app.post('/admin/product/keys/:id', requireAdmin, async (req, res) => {
  try {
    const{keys,mode}=req.body;const products=await readFresh('products.json');
    const product=products.find(p=>p.id===req.params.id);
    if(!product)return res.json({success:false,message:'Produk tidak ditemukan'});
    const nk=(keys||'').split('\n').map(k=>k.trim()).filter(k=>k);
    product.keys=mode==='replace'?nk:[...(product.keys||[]),...nk];
    await writeDB('products.json',products);res.json({success:true,keyCount:product.keys.length});
  }catch(e){res.json({success:false,message:e.message});}
});

app.post('/admin/product/delete/:id', requireAdmin, async (req, res) => {
  try {
    let products = await readFresh('products.json');
    products = products.filter(p => p.id !== req.params.id);
    await writeDB('products.json', products);
    res.json({ success: true, message: 'Produk berhasil dihapus' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/admin/user/delete/:id', requireAdmin, async (req, res) => {
  try {
    let users = await readFresh('users.json');
    users = users.filter(u => u.id !== req.params.id);
    await writeDB('users.json', users);
    res.json({ success: true, message: 'User berhasil dihapus' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/admin/transaction/delete/:id', requireAdmin, async (req, res) => {
  try {
    let transactions = await readFresh('transactions.json');
    transactions = transactions.filter(t => t.id !== req.params.id);
    await writeDB('transactions.json', transactions);
    res.json({ success: true, message: 'Transaksi berhasil dihapus' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/admin/transaction/status/:id', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const transactions = await readFresh('transactions.json');
    const trx = transactions.find(t => t.id === req.params.id);
    if (!trx) return res.json({ success: false, message: 'Transaksi tidak ditemukan' });
    trx.status = status;
    trx.updatedBy = 'admin';
    trx.updatedAt = new Date().toISOString();
    await writeDB('transactions.json', transactions);
    res.json({ success: true, message: 'Status berhasil diubah' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/admin/product/toggle/:id', requireAdmin, async (req, res) => {
  try {
    const products = await readFresh('products.json');
    const product = products.find(p => p.id === req.params.id);

    if (!product) {
      return res.json({ success: false, message: 'Produk tidak ditemukan' });
    }

    product.status = product.status === 'active' ? 'inactive' : 'active';
    await writeDB('products.json', products);

    res.json({ success: true, message: 'Status produk berhasil diubah', status: product.status });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/admin/product/add-keys/:id', requireAdmin, async (req, res) => {
  try {
    const { keys } = req.body;
    const products = await readFresh('products.json');
    const product = products.find(p => p.id === req.params.id);

    if (!product) {
      return res.json({ success: false, message: 'Produk tidak ditemukan' });
    }

    const newKeys = keys.split('\n').map(k => k.trim()).filter(k => k);
    product.keys = product.keys || [];
    product.keys.push(...newKeys);

    await writeDB('products.json', products);
    res.json({ success: true, message: `${newKeys.length} key berhasil ditambahkan`, keyCount: product.keys.length });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/admin/settings/update', requireAdmin, async (req, res) => {
  try {
    const settings = await readFresh('settings.json');
    const { siteName, gamePanelName, about, marqueeText, whatsapp, telegram, email, downloadUrl, adminUsername, categories, categoryLabels, logoUrl, fonnteToken } = req.body;

    if (siteName)      settings.siteName      = siteName;
    if (gamePanelName) settings.gamePanelName = gamePanelName;
    if (about !== undefined) settings.about   = about;
    if (marqueeText)   settings.marqueeText   = marqueeText;
    if (adminUsername) settings.adminUsername = adminUsername;
    if (logoUrl !== undefined) settings.logoUrl = logoUrl;
    if (fonnteToken !== undefined) settings.fonnteToken = fonnteToken;

    settings.contact = settings.contact || {};
    if (whatsapp !== undefined) settings.contact.whatsapp = whatsapp;
    if (telegram !== undefined) settings.contact.telegram = telegram;
    if (email    !== undefined) settings.contact.email    = email;
    if (downloadUrl !== undefined) settings.contact.downloadUrl = downloadUrl.trim();

    // Handle categories update from JSON string or array
    if (categories) {
      try {
        settings.categories = JSON.parse(categories);
      } catch(e) {
        if (Array.isArray(categories)) settings.categories = categories;
      }
    }
    if (categoryLabels) {
      try {
        settings.categoryLabels = JSON.parse(categoryLabels);
      } catch(e) {
        if (typeof categoryLabels === 'object') settings.categoryLabels = categoryLabels;
      }
    }

    await writeDB('settings.json', settings);
    res.json({ success: true, message: 'Pengaturan berhasil diupdate' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/admin/settings/pakasir', requireAdmin, async (req, res) => {
  try {
    const settings = await readFresh('settings.json');
    const { apiKey, project, mode, webhookSecret, qrisMode } = req.body;
    const cur = settings.pakasir || {};

    // v2: `project` = slug project di dashboard Pakasir. Hostname API tetap
    // app.pakasir.com (field apiBaseUrl lama sudah tidak dipakai).
    settings.pakasir = {
      apiKey: apiKey !== undefined ? String(apiKey).trim() : (cur.apiKey || ''),
      project: project !== undefined ? String(project).trim() : (cur.project || ''),
      mode: (mode === 'sandbox' || mode === 'production') ? mode : (cur.mode || 'production'),
      webhookSecret: webhookSecret !== undefined ? String(webhookSecret).trim() : (cur.webhookSecret || '')
    };

    if (qrisMode) settings.qrisMode = qrisMode;

    await writeDB('settings.json', settings);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/admin/qris/test', requireAdmin, async (req, res) => {
  try {
    const { apiKey, project } = req.body;
    const testSettings = { pakasir: { apiKey, project } };
    try {
      // Rp 1.000 >= minimum QRIS v2 (Rp 500). v2 find-or-create, order_id unik tiap test.
      const r = await createQRISPayment('test-' + Date.now(), 1000, testSettings);
      res.json({ success: true, txn_id: r.txn_id });
    } catch (e) {
      res.json({ success: false, message: e.message });
    }
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/admin/settings/password', requireAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.json({ success: false, message: 'Password minimal 6 karakter' });
    }

    const settings = await readFresh('settings.json');
    settings.adminPassword = await bcrypt.hash(newPassword, 12);

    await writeDB('settings.json', settings);
    res.json({ success: true, message: 'Password admin berhasil diubah' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/admin/settings/popular-products', requireAdmin, async (req, res) => {
  try {
    const { popularProductIds } = req.body;
    const settings = await readFresh('settings.json');
    settings.popularProductIds = Array.isArray(popularProductIds) ? popularProductIds : [];
    await writeDB('settings.json', settings);
    res.json({ success: true, popularProductIds: settings.popularProductIds });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/admin/settings/reseller', requireAdmin, async (req, res) => {
  try {
    const { resellerEnabled, resellerPrice, resellerDiscount, resellerNote, resellerMinDeposit } = req.body;
    const settings = await readFresh('settings.json');
    settings.resellerEnabled = resellerEnabled === 'true' || resellerEnabled === true;
    if (resellerPrice !== undefined && resellerPrice !== '') {
      const price = parseInt(resellerPrice);
      if (isNaN(price) || price < 0) return res.json({ success: false, message: 'Harga reseller tidak valid' });
      settings.resellerPrice = price;
    }
    if (resellerDiscount !== undefined && resellerDiscount !== '') {
      const discount = parseInt(resellerDiscount);
      if (isNaN(discount) || discount < 0 || discount > 100) return res.json({ success: false, message: 'Diskon harus antara 0-100%' });
      settings.resellerDiscount = discount;
    }
    if (resellerMinDeposit !== undefined && resellerMinDeposit !== '') {
      const minDep = parseInt(resellerMinDeposit);
      if (isNaN(minDep) || minDep < 0) return res.json({ success: false, message: 'Minimal deposit tidak valid' });
      settings.resellerMinDeposit = minDep;
    }
    if (resellerNote !== undefined) settings.resellerNote = resellerNote;
    await writeDB('settings.json', settings);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/admin/user/toggle-reseller/:id', requireAdmin, async (req, res) => {
  try {
    const users = await readFresh('users.json');
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.json({ success: false, message: 'User tidak ditemukan' });
    user.is_reseller = !user.is_reseller;
    user.role = user.is_reseller ? 'reseller' : 'user';
    if (user.is_reseller) {
      user.reseller_since = user.reseller_since || new Date().toISOString();
      user.reseller_code = user.reseller_code || ('RSL-' + user.username.toUpperCase().slice(0, 4) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase());
    }
    await writeDB('users.json', users);
    res.json({ success: true, is_reseller: user.is_reseller });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Admin koreksi/tambah saldo wallet user secara manual (mis. transfer di luar QRIS)
app.post('/admin/user/adjust-balance/:id', requireAdmin, async (req, res) => {
  try {
    const amount = parseInt(req.body.amount);
    if (isNaN(amount) || amount === 0) return res.json({ success: false, message: 'Nominal tidak valid' });

    const users = await readFresh('users.json');
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.json({ success: false, message: 'User tidak ditemukan' });

    const newBalance = (user.balance || 0) + amount;
    if (newBalance < 0) return res.json({ success: false, message: 'Saldo tidak boleh minus' });
    user.balance = newBalance;
    await writeDB('users.json', users);

    const transactions = await readFresh('transactions.json');
    transactions.push({
      id: uuidv4(), orderId: `ADJ-${Date.now()}`, code: generateOrderCode(),
      userId: user.id, type: 'adjustment', productName: amount > 0 ? 'Penambahan Saldo (Admin)' : 'Pengurangan Saldo (Admin)',
      amount, price: Math.abs(amount), customerName: user.username, wa: user.wa,
      status: 'done', paidAt: new Date().toISOString(),
      createdAt: new Date().toISOString(), time: formatDate(), confirmedBy: 'admin'
    });
    await writeDB('transactions.json', transactions);

    res.json({ success: true, balance: user.balance });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});
app.post('/admin/transaction/confirm/:id', requireAdmin, async (req, res) => {
  try {
    const transactions = await readFresh('transactions.json');
    const transaction = transactions.find(t => t.id === req.params.id);
    if (!transaction) return res.json({ success: false, message: 'Transaksi tidak ditemukan' });
    if (transaction.status === 'done') return res.json({ success: false, message: 'Transaksi sudah selesai' });

    // Jika transaksi reseller, upgrade user
    if (transaction.type === 'reseller') {
      const users = await readFresh('users.json');
      const u = users.find(u => u.id === transaction.userId);
      if (u) {
        u.is_reseller = true;
        u.role = 'reseller';
        u.reseller_since = u.reseller_since || new Date().toISOString();
        u.reseller_code = u.reseller_code || ('RSL-' + u.username.toUpperCase().slice(0, 4) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase());
        await writeDB('users.json', users);
      }
      transaction.status = 'done';
      transaction.paidAt = new Date().toISOString();
      await writeDB('transactions.json', transactions);
      return res.json({ success: true, type: 'reseller' });
    }

    // Jika transaksi top up saldo wallet, kreditkan saldo user
    if (transaction.type === 'deposit') {
      const users = await readFresh('users.json');
      const u = users.find(u => u.id === transaction.userId);
      if (u) {
        u.balance = (u.balance || 0) + (transaction.amount || transaction.price || 0);
        await writeDB('users.json', users);
      }
      transaction.status = 'done';
      transaction.paidAt = new Date().toISOString();
      await writeDB('transactions.json', transactions);
      return res.json({ success: true, type: 'deposit', balance: u?.balance || 0 });
    }

    // Transaksi produk biasa: ambil key sesuai durasi (hari/jam)
    const products = await readFresh('products.json');
    const product = products.find(p => p.id === transaction.productId);
    const key = product ? dur.takeKey(product.keys, transaction.selectedDays, transaction.selectedUnit) : null;
    if (key) {
      product.sold = (product.sold || 0) + 1;
      await writeDB('products.json', products);
    }

    transaction.status = 'done';
    transaction.key = key;
    transaction.paidAt = new Date().toISOString();
    transaction.confirmedBy = 'admin';
    await writeDB('transactions.json', transactions);

    res.json({ success: true, key });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// Leaderboard route
app.get('/leaderboard', (req, res) => {
  const transactions = readDB('transactions.json');
  const users = readDB('users.json');
  const settings = readDB('settings.json');

  // Calculate leaderboard
  const userStats = {};

  transactions.forEach(t => {
    if (t.status === 'done' && t.userId) {
      if (!userStats[t.userId]) {
        userStats[t.userId] = {
          userId: t.userId,
          totalTransactions: 0,
          totalSpent: 0
        };
      }
      userStats[t.userId].totalTransactions++;
      userStats[t.userId].totalSpent += t.price;
    }
  });

  // Convert to array and add user info
  const leaderboard = Object.values(userStats).map(stat => {
    const user = users.find(u => u.id === stat.userId);
    return {
      ...stat,
      username: user?.username || 'Unknown',
      photo: user?.photo || null
    };
  });

  // Sort by total transactions descending
  leaderboard.sort((a, b) => b.totalTransactions - a.totalTransactions);

  // Add rank
  leaderboard.forEach((item, index) => {
    item.rank = index + 1;
  });

  const user = getSessionUser(req);

  res.render('pages/leaderboard', {
    leaderboard,
    settings,
    user
  });
});

// API endpoints
app.get('/api/products', async (req, res) => {
  if (!checkApiRateLimit(req.ip)) return res.status(429).json({ success: false, message: 'Terlalu banyak permintaan. Coba lagi nanti.' });
  // FIX (egress): endpoint publik paling sering dipanggil frontend -- ini
  // penyumbang terbesar cached egress karena dulu readFresh() menarik ulang
  // seluruh blob products dari Supabase di SETIAP request. readSmart pakai
  // cache ber-TTL sehingga data yang sama tidak ditransfer berulang.
  // Isi sama untuk semua pengunjung -> cache di edge Vercel 30 dtk.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
  const products = (await readSmart('products.json'))
    .filter(p => p.status === 'active')
    // SECURITY: jangan kirim keys ke publik — keys hanya dikirim setelah pembayaran sukses
    .map(({ keys, ...safe }) => ({ ...safe, stockCount: (keys || []).length }));
  res.json(products);
});

// ── Helper: validasi & hitung diskon voucher ──
const validateVoucher = async (code, price, userId) => {
  if (!code) return { valid: false, error: 'Kode kosong' };
  const vouchers = await readFresh('vouchers.json');
  const v = vouchers.find(v => v.code.toUpperCase() === code.trim().toUpperCase());
  if (!v) return { valid: false, error: 'Kode voucher tidak ditemukan' };
  if (!v.active) return { valid: false, error: 'Voucher tidak aktif' };
  if (v.expiresAt && new Date(v.expiresAt) < new Date()) return { valid: false, error: 'Voucher sudah kadaluarsa' };
  if (v.maxUses > 0 && v.usedCount >= v.maxUses) return { valid: false, error: 'Voucher sudah habis digunakan' };
  if (v.minPurchase > 0 && price < v.minPurchase) return { valid: false, error: `Minimal pembelian Rp ${v.minPurchase.toLocaleString('id-ID')}` };
  // Cegah reseller double-discount: kalau voucher punya flag excludeReseller,
  // tolak pemakaian oleh akun reseller (mereka sudah dapat diskon harga reseller).
  if (v.excludeReseller && userId) {
    const users = readDB('users.json');
    const u = users.find(u => u.id === userId);
    if (u?.is_reseller) return { valid: false, error: 'Voucher ini tidak berlaku untuk akun Reseller' };
  }
  if (v.perUserLimit > 0 && userId) {
    const userUses = (v.usages || []).filter(u => u.userId === userId).length;
    if (userUses >= v.perUserLimit) return { valid: false, error: 'Kamu sudah pernah memakai voucher ini' };
  }
  const discount = v.type === 'percent'
    ? Math.round(price * v.value / 100)
    : Math.min(v.value, price);
  const finalPrice = Math.max(price - discount, 0);
  return { valid: true, voucher: v, discount, finalPrice };
};

app.get('/api/stats', async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=300');
  const products = await readSmart('products.json');
  const testimonials = await readSmart('testimonials.json');
  const users = await readSmart('users.json');
  const active = products.filter(p => p.status === 'active');
  const totalSold = products.reduce((s, p) => s + (p.sold || 0), 0);
  const avgRating = testimonials.length
    ? (testimonials.reduce((s, t) => s + (t.rating || 0), 0) / testimonials.length).toFixed(1)
    : '0.0';
  res.json({
    totalSold,
    totalActiveProducts: active.length,
    totalUsers: users.length,
    avgRating: parseFloat(avgRating)
  });
});

// Cek voucher (user)
app.post('/api/voucher/check', requireAuth, async (req, res) => {
  const { code, price } = req.body;
  if (!code || !price) return res.json({ valid: false, error: 'Data tidak lengkap' });
  const result = await validateVoucher(code, parseInt(price), req.session.userId);
  if (!result.valid) return res.json({ valid: false, error: result.error });
  res.json({
    valid: true,
    code: result.voucher.code,
    type: result.voucher.type,
    value: result.voucher.value,
    description: result.voucher.description || '',
    discount: result.discount,
    finalPrice: result.finalPrice
  });
});

app.get('/api/transactions', requireAdmin, (req, res) => {
  const transactions = readDB('transactions.json');
  res.json(transactions);
});

app.get('/api/testimonials', async (req, res) => {
  if (!checkApiRateLimit(req.ip)) return res.status(429).json({ success: false, message: 'Terlalu banyak permintaan.' });
  // Data testimoni publik (sama untuk semua orang) -> cache edge 60 dtk.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=120');
  const testimonials = await readSmart('testimonials.json');
  const users = await readSmart('users.json');
  const featured = req.query.featured === 'true';
  const verifiedOnly = req.query.verified === 'true';
  const productId = req.query.product;

  let filtered = testimonials;

  if (featured) {
    filtered = filtered.filter(t => t.featured && t.verified);
  } else if (verifiedOnly) {
    filtered = filtered.filter(t => t.verified);
  }

  if (productId) {
    filtered = filtered.filter(t => t.product === productId || t.productName === productId);
  }

  // Sort by date descending
  filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Attach user photo if available
  filtered = filtered.map(t => {
    const u = users.find(u => u.username === t.username);
    return { ...t, photo: u?.photo || null };
  });

  // Pad with fake entries so page always looks alive
  const fakeTestimonials = [
    { id:'fake1', username:'Rizky F.',    name:'Rizky F.',    rating:5, text:'Mod FF-nya mantap, udah 3 bulan pakai dan aman-aman aja. Fitur lengkap dari ESP sampai fly hack. CS juga responsif banget!', product:'ff',         productName:'FREE FIRE MAX',      date:'2025-05-20', verified:true },
    { id:'fake2', username:'Andi S.',     name:'Andi S.',     rating:5, text:'ML mod-nya lengkap banget! Map hack, drone view, sampai skin all hero ada. Auto update jadi nggak perlu repot tiap update.', product:'ml',        productName:'MOBILE LEGENDS',    date:'2025-05-18', verified:true },
    { id:'fake3', username:'Dimas P.',    name:'Dimas P.',    rating:5, text:'Support fast response! Pas ada masalah langsung dibantu sampai beres. PUBG mod-nya juga smooth, nggak lag sama sekali.', product:'pubgm',     productName:'PUBG MOBILE',   date:'2025-05-15', verified:true },
    { id:'fake4', username:'farhan99',    name:'farhan',      rating:5, text:'Beli sertifikat anti-banned udah 2x dan alhamdulillah akun tetap aman. Worth it banget harganya segitu.', product:'sertifikat', productName:'SERTIFIKAT', date:'2025-05-10', verified:true },
    { id:'fake5', username:'gamer_mlbb',  name:'Wanda M.',    rating:4, text:'Produknya bagus, pengiriman key cepet banget. Cuma kadang agak lag di device lama tapi overall oke lah.', product:'ml',        productName:'MOBILE LEGENDS',    date:'2025-05-08', verified:true },
    { id:'fake6', username:'ACA XITERZ', name:'ACA',          rating:5, text:'Udah lama langganan di sini, belum pernah kecewa. Proses beli gampang, bayar QRIS langsung dapat key. Recommended!', product:'ff',       productName:'FREE FIRE MAX',      date:'2025-05-05', verified:true },
    { id:'fake7', username:'bintang_07',  name:'bintang',     rating:5, text:'Lifetime PUBGM worth it banget. Udah 6 bulan masih lancar jaya, fitur no recoil-nya mantul.', product:'pubgm',     productName:'PUBG MOBILE',   date:'2025-04-28', verified:true },
    { id:'fake8', username:'rizky_ff',    name:'Rizky',       rating:4, text:'Kalau FF mod-nya top. Pernah ada issue tapi langsung di-handle sama admin. Keep up the good work!', product:'ff',        productName:'FREE FIRE MAX',      date:'2025-04-20', verified:true },
    { id:'fake9', username:'keymaster',   name:'Kevin',       rating:5, text:'CODM mod anti-recoil smooth banget. Rank dari Silver langsung naik ke Platinum dalam seminggu haha.', product:'codm',     productName:'CODM',    date:'2025-04-15', verified:true },
    { id:'fake10',username:'abil',        name:'abil',        rating:5, text:'Ini toko mod menu terpercaya yang pernah aku coba. Transaksi aman, key langsung masuk, CS ramah.', product:'ff',        productName:'FREE FIRE MAX',      date:'2025-04-10', verified:true },
    { id:'fake11',username:'Hergi',       name:'Hergi',       rating:5, text:'Valorant ESP-nya akurat banget. Sudah 2 bulan pake dan belum ada masalah sama sekali. Pelayanan top!', product:'val',      productName:'VALORANT', date:'2025-04-05', verified:true },
    { id:'fake12',username:'rehan',       name:'rehan',       rating:5, text:'HOK mod-nya mantap, map hack dan skin unlock semua ada. Proses beli cepet dan key langsung terkirim.', product:'hok',     productName:'HOK',     date:'2025-03-28', verified:true },
    { id:'fake13',username:'Saell',       name:'Saell',       rating:5, text:'Beli Free Fire MAX bundle, prosesnya cepet banget! Cuma 2 menit key langsung masuk. Akun aman sampai sekarang.', product:'ff',         productName:'FREE FIRE MAX',      date:'2025-03-25', verified:true },
    { id:'fake14',username:'GamerKing99', name:'GamerKing99', rating:5, text:'MLBB mod-nya juara! Skin all hero gratis, map hack jalan mulus. Adminnya juga friendly, fast respon.', product:'ml',        productName:'MOBILE LEGENDS',    date:'2025-03-20', verified:true },
    { id:'fake15',username:'SkyyFire',    name:'SkyyFire',    rating:5, text:'PUBG mod smooth banget di HP kentang sekalipun. No lag, no crash. Harga juga affordable banget!', product:'pubgm',     productName:'PUBG MOBILE',   date:'2025-03-15', verified:true },
    { id:'fake16',username:'ShadowX',     name:'ShadowX',     rating:5, text:'Udah 4x beli di sini, selalu puas. Key original, legit, dan awet. Best store for mod menu!', product:'ff',        productName:'FREE FIRE MAX',      date:'2025-03-10', verified:true },
    { id:'fake17',username:'NightWolf',   name:'NightWolf',   rating:4, text:'PUBGM no recoil mantap, tapi kadang auto aim agak delay. Overall masih oke sih, worth the price.', product:'pubgm',     productName:'PUBG MOBILE',   date:'2025-03-05', verified:true },
    { id:'fake18',username:'LunarKing',   name:'LunarKing',   rating:5, text:'MLBB dron view works perfectly! Enemy location always visible. Rank naik terus dari season kemarin.', product:'ml',        productName:'MOBILE LEGENDS',    date:'2025-02-28', verified:true },
    { id:'fake19',username:'NeonVibes',   name:'NeonVibes',   rating:5, text:'FF aimbot-nya smooth, headshot mulus. UDAH 3 BULAN pakai dan belum pernah kena ban. Mantap!', product:'ff',        productName:'FREE FIRE MAX',      date:'2025-02-20', verified:true },
    { id:'fake20',username:'StormRider',  name:'StormRider',  rating:4, text:'Produk bagus, cuma pengiriman key agak lama pas weekend. Tapi overall puas, CS-nya ramah.', product:'pubgm',     productName:'PUBG MOBILE',   date:'2025-02-15', verified:true },
    { id:'fake21',username:'GhostByte',   name:'GhostByte',   rating:5, text:'FF wallhack jernih, bisa lihat musuh tembus dinding. Gameplay jadi lebih seru dan menang terus!', product:'ff',        productName:'FREE FIRE MAX',      date:'2025-02-10', verified:true },
    { id:'fake22',username:'CyberRush',   name:'CyberRush',   rating:5, text:'MLBB skin all hero unlocked, effect skill keliatan keren banget! Teman-teman pada kaget.', product:'ml',        productName:'MOBILE LEGENDS',    date:'2025-02-05', verified:true },
    { id:'fake23',username:'AlphaGod',    name:'AlphaGod',    rating:5, text:'PUBG mod versi terbaru udah support map Livik juga. Smooth, nggak ada glitch. Top banget!', product:'pubgm',     productName:'PUBG MOBILE',   date:'2025-01-28', verified:true },
    { id:'fake24',username:'IronPhoenix', name:'IronPhoenix', rating:5, text:'FF mod ini yang paling stabil dari semua yang pernah aku coba. Langganan bulanan, worth it!', product:'ff',        productName:'FREE FIRE MAX',      date:'2025-01-20', verified:true },
    { id:'fake25',username:'TurboAce',    name:'TurboAce',    rating:4, text:'MLBB drone view bagus, tapi agak boros battery. Overall recommend buat yang mau rank push.', product:'ml',        productName:'MOBILE LEGENDS',    date:'2025-01-15', verified:true },
    { id:'fake26',username:'NovaStar',    name:'NovaStar',    rating:5, text:'FF ESP wallhack akurat, bisa lihat posisi semua musuh. Combo sama aimbot auto winner!', product:'ff',        productName:'FREE FIRE MAX',      date:'2025-01-10', verified:true },
    { id:'fake27',username:'DragonByte',  name:'DragonByte',  rating:5, text:'PUBG no recoil + auto headshot combo mantap! Rank naik dari Gold ke Diamond dalam 2 minggu.', product:'pubgm',     productName:'PUBG MOBILE',   date:'2025-01-05', verified:true },
    { id:'fake28',username:'MegaBoss',    name:'MegaBoss',    rating:5, text:'Beli mod menu di sini gampang banget, bayar pakai QRIS langsung dapat key. Nggak ribet!', product:'ff',        productName:'FREE FIRE MAX',      date:'2024-12-28', verified:true },
    { id:'fake29',username:'PulseWave',   name:'PulseWave',   rating:4, text:'MLBB mod oke, tapi perlu update manual tiap patch baru. Harusnya auto update sih.', product:'ml',        productName:'MOBILE LEGENDS',    date:'2024-12-20', verified:true },
    { id:'fake30',username:'HyperCore',   name:'HyperCore',   rating:5, text:'PUBG speed hack works! Movement jadi cepat, musuh nggak bisa ngejar. Asik banget!', product:'pubgm',     productName:'PUBG MOBILE',   date:'2024-12-15', verified:true },
  ];

  // Filter fake by product if requested
  let finalFake = fakeTestimonials;
  if (productId) {
    finalFake = fakeTestimonials.filter(f => f.product === productId || f.productName === productId);
  }

  // Only add fake entries that don't duplicate real usernames
  const realUsernames = new Set(filtered.map(t => (t.username||'').toLowerCase()));
  const paddedFake = finalFake.filter(f => !realUsernames.has((f.username||'').toLowerCase()));

  // Merge: real first, then fake (capped so total stays reasonable)
  const maxDisplay = 30;
  const combined = [...filtered, ...paddedFake].slice(0, maxDisplay);

  res.json(combined);
});

app.post('/api/testimonials', requireAuth, async (req, res) => {
  try {
    const { productId, productName, rating, text } = req.body;
    if (!productId || !rating || !text) return res.json({ success: false, message: 'Data tidak lengkap' });
    const ratingNum = parseInt(rating);
    if (ratingNum < 1 || ratingNum > 5) return res.json({ success: false, message: 'Rating tidak valid' });
    if (!text.trim()) return res.json({ success: false, message: 'Ulasan tidak boleh kosong' });
    if (text.trim().length > 500) return res.json({ success: false, message: 'Ulasan maksimal 500 karakter' });

    // Hanya user yang sudah membeli (transaksi sukses/done) produk ini yang boleh kirim testimoni
    const transactions = readDB('transactions.json');
    const hasPurchased = transactions.some(t =>
      t.userId === req.session.userId &&
      t.productId === productId &&
      t.status === 'done'
    );
    if (!hasPurchased) {
      return res.json({ success: false, message: 'Hanya pembeli produk ini yang bisa memberikan rating/testimoni' });
    }

    const users = readDB('users.json');
    const user = users.find(u => u.id === req.session.userId);
    const testimonials = readDB('testimonials.json');

    testimonials.unshift({
      id: uuidv4(),
      product: productId,
      productName: productName || '',
      username: user?.username || 'Pengguna',
      rating: ratingNum,
      text: text.trim(),
      date: new Date().toISOString(),
      verified: true,
      featured: false
    });

    await writeDB('testimonials.json', testimonials);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/admin/testimonial/add', requireAdmin, async (req, res) => {
  try {
    const { name, username, rating, text, product, verified, featured } = req.body;
    const testimonials = await readFresh('testimonials.json');

    const newTestimonial = {
      id: `testi-${Date.now()}`,
      name,
      username: username || null,
      rating: parseInt(rating) || 5,
      text,
      product: product || null,
      date: new Date().toISOString(),
      verified: verified === true || verified === 'true',
      featured: featured === true || featured === 'true'
    };

    testimonials.push(newTestimonial);
    await writeDB('testimonials.json', testimonials);

    res.json({ success: true, message: 'Testimoni berhasil ditambahkan' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/admin/testimonial/delete/:id', requireAdmin, async (req, res) => {
  try {
    let testimonials = await readFresh('testimonials.json');
    testimonials = testimonials.filter(t => t.id !== req.params.id);
    await writeDB('testimonials.json', testimonials);
    res.json({ success: true, message: 'Testimoni berhasil dihapus' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/admin/testimonial/toggle-featured/:id', requireAdmin, async (req, res) => {
  try {
    const testimonials = await readFresh('testimonials.json');
    const testi = testimonials.find(t => t.id === req.params.id);
    if (!testi) return res.json({ success: false, message: 'Testimoni tidak ditemukan' });

    testi.featured = !testi.featured;
    await writeDB('testimonials.json', testimonials);
    res.json({ success: true, message: 'Status featured berhasil diubah' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.post('/admin/testimonial/toggle-verified/:id', requireAdmin, async (req, res) => {
  try {
    const testimonials = await readFresh('testimonials.json');
    const testi = testimonials.find(t => t.id === req.params.id);
    if (!testi) return res.json({ success: false, message: 'Testimoni tidak ditemukan' });

    testi.verified = !testi.verified;
    await writeDB('testimonials.json', testimonials);
    res.json({ success: true, message: testi.verified ? 'Testimoni berhasil diverifikasi' : 'Verifikasi dicabut' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

app.get('/api/notifications', (req, res) => {
  if (!checkApiRateLimit(req.ip)) return res.status(429).json({ success: false, message: 'Terlalu banyak permintaan.' });
  // PENTING (biaya): endpoint ini di-poll semua pengunjung tiap 30-90 detik.
  // Isinya sama untuk semua orang (bukan data per-user), jadi aman di-cache
  // singkat di Vercel Edge -> banyak polling akan dijawab dari edge cache,
  // bukan invoke function + roundtrip Supabase tiap kali.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=20, stale-while-revalidate=40');
  const notifs = readDB('notifications.json').slice(0, 20);
  // SECURITY: anonimkan nama pembeli — hanya tampilkan initial agar tidak bocor daftar username asli
  const anonymize = (name = '') => {
    if (!name) return '***';
    return name[0] + '*'.repeat(Math.max(name.length - 1, 2));
  };
  const enriched = notifs.map(({ id, type, productName, price, timeStr, buyerName }) => ({
    id, type, productName, price, timeStr,
    buyerName: anonymize(buyerName),
    buyerPhoto: null
  }));
  res.json(enriched);
});

app.get('/api/leaderboard', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=120');
  const transactions = readDB('transactions.json');
  const users = readDB('users.json');

  // Calculate real leaderboard
  const userStats = {};
  transactions.forEach(t => {
    if (t.status === 'done' && t.userId) {
      if (!userStats[t.userId]) userStats[t.userId] = { userId: t.userId, totalTransactions: 0, totalSpent: 0 };
      userStats[t.userId].totalTransactions++;
      userStats[t.userId].totalSpent += t.price;
    }
  });

  const realEntries = Object.values(userStats).map(stat => {
    const user = users.find(u => u.id === stat.userId);
    return { username: user?.username || 'User', totalTransactions: stat.totalTransactions, totalSpent: stat.totalSpent, isReal: true };
  });

  realEntries.sort((a, b) => b.totalTransactions - a.totalTransactions || b.totalSpent - a.totalSpent);
  realEntries.forEach((item, i) => { item.rank = i + 1; });

  res.json({ success: true, data: realEntries.slice(0, 10) });
});

// ═══════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════

// Admin Product Edit Page
app.get('/admin/product-edit', requireAdmin, async (req, res) => {
  const [products, settings] = await Promise.all([readFresh('products.json'), readFresh('settings.json')]);
  const productId = req.query.id;
  const product = productId ? products.find(p => p.id === productId) : null;
  res.render('pages/admin-product-edit', { product, products, settings });
});

// Admin Theme Settings Page
app.get('/admin/theme-settings', requireAdmin, async (req, res) => {
  const settings = await readFresh('settings.json');
  res.render('pages/admin-theme', { settings });
});

// Admin Product Management
app.get('/admin/products', requireAdmin, async (req, res) => {
  const products = await readFresh('products.json');
  res.json({ success: true, data: products });
});

// Admin Get Single Product
app.get('/admin/product/:id', requireAdmin, async (req, res) => {
  const products = await readFresh('products.json');
  const product = products.find(p => p.id === req.params.id);
  if (!product) return res.json({ success: false, message: 'Produk tidak ditemukan' });
  res.json({ success: true, data: product });
});

// Admin Update Product (image, status, keys)
app.post('/admin/product/:id', requireAdmin, async (req, res) => {
  try {
    const { items, bannerUrl, status, keys, keysMode, platforms } = req.body;
    const products = await readFresh('products.json');
    const productIndex = products.findIndex(p => p.id === req.params.id);

    if (productIndex === -1) return res.json({ success: false, message: 'Produk tidak ditemukan' });
    const p = products[productIndex];

    // Simpan ke image (yang dibaca frontend) DAN bannerUrl
    if (bannerUrl && bannerUrl.trim()) {
      p.image    = bannerUrl.trim();
      p.bannerUrl = bannerUrl.trim();
    }

    if (status) p.status = status;
    if (Array.isArray(platforms)) p.platforms = platforms;

    // Kelola harga / pricing options
    const { pricingOptions } = req.body;
    if (Array.isArray(pricingOptions) && pricingOptions.length > 0) {
      const validOpts = pricingOptions
        .map(o => {
          const rp = (o.reseller_price === null || o.reseller_price === undefined || o.reseller_price === '')
            ? null : parseInt(o.reseller_price);
          return {
            days: parseInt(o.days),
            unit: dur.normUnit(o.unit),
            price: parseInt(o.price),
            reseller_price: (rp !== null && !isNaN(rp) && rp >= 0) ? rp : null
          };
        })
        // price > 0 wajib — price 0 hampir selalu berarti input kosong/tak sengaja, bukan produk gratis
        .filter(o => o.days > 0 && !isNaN(o.price) && o.price > 0)
        // buang duplikat (durasi + unit sama)
        .filter((o, i, arr) => arr.findIndex(x => x.days === o.days && x.unit === o.unit) === i);
      if (validOpts.length > 0) {
        p.pricingOptions = validOpts;
        p.items = validOpts.map(o => ({ l: dur.makeLabel(p.name, o.days, o.unit), p: o.price, reseller_price: o.reseller_price }));
      } else {
        return res.json({ success: false, message: 'Harga paket tidak valid (harga harus lebih dari 0)' });
      }
    }

    // Kelola keys
    if (keys !== undefined && keys !== null) {
      const newKeys = String(keys).split('\n').map(k => k.trim()).filter(k => k);
      if (newKeys.length > 0) {
        p.keys = keysMode === 'replace' ? newKeys : [...(p.keys || []), ...newKeys];
      }
    }

    await writeDB('products.json', products);
    res.json({ success: true, message: 'Produk berhasil diupdate', data: p });
  } catch (error) {
    res.json({ success: false, message: 'Error: ' + error.message });
  }
});

// Admin Upload Banner — di Vercel upload ke Supabase Storage, lokal ke filesystem
app.post('/admin/upload-banner', requireAdmin, multer({ storage: multer.memoryStorage(), fileFilter }).single('banner'), async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, message: 'Tidak ada file diupload' });

    if (isVercel) {
      // Vercel: upload ke Supabase Storage
      try {
        const url = await db.uploadImage(req.file.buffer, req.file.originalname, req.file.mimetype);
        return res.json({ success: true, bannerUrl: url });
      } catch (e) {
        return res.json({ success: false, message: e.message });
      }
    }

    // Lokal: simpan di filesystem
    const bannersDir = path.join(__dirname, 'public', 'uploads', 'banners');
    if (!fs.existsSync(bannersDir)) fs.mkdirSync(bannersDir, { recursive: true });
    const filename = `${Date.now()}-${uuidv4()}${path.extname(req.file.originalname)}`;
    fs.writeFileSync(path.join(bannersDir, filename), req.file.buffer);
    res.json({ success: true, bannerUrl: `/uploads/banners/${filename}` });
  } catch (error) {
    res.json({ success: false, message: 'Error: ' + error.message });
  }
});

// Admin Get Theme Settings
app.get('/admin/theme', requireAdmin, async (req, res) => {
  const settings = await readFresh('settings.json');
  res.json({ success: true, data: settings.theme || {} });
});

// Admin Update Theme Settings
app.post('/admin/theme', requireAdmin, async (req, res) => {
  try {
    const { primaryColor, secondaryColor, accentColor, backgroundColor, cardBackground, borderColor, glowColor } = req.body;
    const settings = await readFresh('settings.json');

    const prevTheme = settings.theme || {};
    settings.theme = {
      primaryColor: primaryColor || prevTheme.primaryColor || '#7b2cbf',
      secondaryColor: secondaryColor || prevTheme.secondaryColor || '#9d4edd',
      accentColor: accentColor || prevTheme.accentColor || '#c77dff',
      backgroundColor: backgroundColor || prevTheme.backgroundColor || '#0a0a0a',
      cardBackground: cardBackground || prevTheme.cardBackground || '#151520',
      borderColor: borderColor || prevTheme.borderColor || 'rgba(157,78,221,.15)',
      glowColor: glowColor || prevTheme.glowColor || 'rgba(157, 78, 221, 0.1)'
    };

    await writeDB('settings.json', settings);
    res.json({ success: true, message: 'Tema berhasil diupdate', data: settings.theme });
  } catch (error) {
    res.json({ success: false, message: 'Error: ' + error.message });
  }
});

// ═══════════════════════════════════════════════════════════
// KEY POOL SYSTEM — Format: CODE - X Hari
// ═══════════════════════════════════════════════════════════

// User: halaman aktifkan key
app.get('/activate-key', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const settings = readDB('settings.json');
  res.render('pages/activate-key', { user, settings, result: null, error: null, code: '' });
});

app.post('/activate-key', requireAuth, async (req, res) => {
  const user = getSessionUser(req);
  const settings = readDB('settings.json');
  const code = (req.body.code || '').trim().toUpperCase();

  if (!code) return res.render('pages/activate-key', { user, settings, result: null, error: 'Masukkan kode key terlebih dahulu', code: '' });

  const keyspool = readDB('keyspool.json');
  const key = keyspool.find(k => k.code.toUpperCase() === code);

  if (!key) return res.render('pages/activate-key', { user, settings, result: null, error: 'Key tidak ditemukan atau tidak valid', code });
  if (key.used) return res.render('pages/activate-key', { user, settings, result: null, error: 'Key sudah pernah digunakan', code });

  key.used = true;
  key.usedBy = user.id;
  key.usedByUsername = user.username;
  key.usedAt = new Date().toISOString();
  await writeDB('keyspool.json', keyspool);

  res.render('pages/activate-key', {
    user, settings, code,
    result: { code: key.code, duration: key.duration, label: key.label || `${key.duration} Hari`, note: key.note || '' },
    error: null
  });
});

// Admin: lihat semua key pool
app.get('/admin/keyspool', requireAdmin, async (req, res) => {
  res.json({ success: true, data: await readFresh('keyspool.json') });
});

// Admin: tambah key baru
app.post('/admin/keyspool/add', requireAdmin, async (req, res) => {
  try {
    const { code, duration, label, note } = req.body;
    if (!code || !duration) return res.json({ success: false, message: 'Kode dan durasi wajib diisi' });
    const d = parseInt(duration);
    if (isNaN(d) || d <= 0) return res.json({ success: false, message: 'Durasi tidak valid (harus > 0 hari)' });
    const keyspool = await readFresh('keyspool.json');
    if (keyspool.find(k => k.code.toUpperCase() === code.trim().toUpperCase())) {
      return res.json({ success: false, message: 'Kode key sudah ada' });
    }
    keyspool.push({
      id: uuidv4(),
      code: code.trim().toUpperCase(),
      duration: d,
      label: label?.trim() || `${d} Hari`,
      used: false, usedBy: null, usedByUsername: null, usedAt: null,
      note: note?.trim() || '',
      createdAt: new Date().toISOString()
    });
    await writeDB('keyspool.json', keyspool);
    res.json({ success: true, data: keyspool });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Admin: generate key otomatis (bulk)
app.post('/admin/keyspool/generate', requireAdmin, async (req, res) => {
  try {
    const { count, duration, prefix, label } = req.body;
    const n = Math.min(parseInt(count) || 1, 100);
    const d = parseInt(duration);
    if (isNaN(d) || d <= 0) return res.json({ success: false, message: 'Durasi tidak valid' });
    const keyspool = await readFresh('keyspool.json');
    const pref = (prefix || 'KEY').toUpperCase();
    const added = [];
    for (let i = 0; i < n; i++) {
      const code = `${pref}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      keyspool.push({
        id: uuidv4(), code, duration: d,
        label: label?.trim() || `${d} Hari`,
        used: false, usedBy: null, usedByUsername: null, usedAt: null,
        note: '', createdAt: new Date().toISOString()
      });
      added.push(code);
    }
    await writeDB('keyspool.json', keyspool);
    res.json({ success: true, generated: added.length, codes: added, data: keyspool });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Admin: hapus key
app.post('/admin/keyspool/delete/:id', requireAdmin, async (req, res) => {
  try {
    let keyspool = await readFresh('keyspool.json');
    keyspool = keyspool.filter(k => k.id !== req.params.id);
    await writeDB('keyspool.json', keyspool);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// RESTOCK KEY via YouduStore API  (lihat youdustore.js + api-1.json)
// Alur: admin petakan paket produk → kode produk supplier, klik "Restock N key".
// Server memesan N order ke supplier (saldo supplier terpotong), lalu serial_number
// tiap order yang sukses otomatis ditambahkan ke stok key paket tersebut
// (format KEY:7 = 7 hari, KEY:12h = 12 jam). Status diperbarui lewat callback
// supplier dan/atau tombol "Cek Status".
// ═══════════════════════════════════════════════════════════
const RESTOCK_MAX_BATCH = 10;           // batas order per klik (aman untuk timeout serverless)
const restockBusy = new Set();          // lock: 'order' (1 batch sekaligus) & id restock saat refresh
let supplierProductsCache = { at: 0, data: [] };

const maskSecret = (v) => { v = String(v || ''); return v ? `••••${v.slice(-4)}` : ''; };
const publicBaseUrl = (req) => (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

async function ensureYouduCallbackSecret() {
  const settings = await readFresh('settings.json');
  settings.youdu = settings.youdu || { token: '', apiKey: '', sandbox: false, map: {} };
  if (!settings.youdu.callbackSecret) {
    settings.youdu.callbackSecret = crypto.randomBytes(16).toString('hex');
    await writeDB('settings.json', settings);
  }
  return settings;
}

const isFinalOrder = (o) => ['success', 'failed', 'sandbox'].includes(o.status);

// Perbarui status order yang belum final ke supplier, lalu masukkan serial_number
// yang sukses ke stok produk. Idempotent (flag keyAdded per order).
async function refreshRestock(restockId, { skipIfOrdering = false } = {}) {
  // Callback supplier yang datang saat batch order masih berjalan diabaikan (batch
  // selalu diakhiri refresh sendiri) supaya dua penulis tidak saling menimpa restocks.json
  if (skipIfOrdering && restockBusy.has('order')) return null;
  if (restockBusy.has(restockId)) return null;
  restockBusy.add(restockId);
  try {
    const settings = await readFresh('settings.json');
    const cfg = youdu.cfgFrom(settings);
    const restocks = await readFresh('restocks.json');
    const rec = restocks.find(r => r.id === restockId);
    if (!rec) return null;

    let changed = false;
    for (const o of rec.orders) {
      if (isFinalOrder(o) && (o.status !== 'success' || o.keyAdded)) continue;
      if (!isFinalOrder(o)) {
        try {
          const d = await youdu.checkStatus(cfg, o.invoice || o.reference);
          const st = youdu.normalizeStatus(d.transaction_status);
          if (d.invoice && !o.invoice) o.invoice = d.invoice;
          if (d.serial_number) o.serial = String(d.serial_number).trim();
          if (d.note) o.note = String(d.note).slice(0, 200);
          o.status = st;
          changed = true;
        } catch (e) {
          // Order tak ditemukan di supplier (sering terjadi saat request sebelumnya timeout) → aman dianggap gagal
          if (e.status === 404 && !o.invoice) { o.status = 'failed'; o.error = 'Order tidak ditemukan di supplier'; changed = true; }
          else o.lastCheckError = e.message;
        }
      }
    }

    // Tambahkan key sukses ke stok produk
    const pending = rec.orders.filter(o => o.status === 'success' && o.serial && !o.keyAdded);
    if (pending.length && !rec.sandbox) {
      const products = await readFresh('products.json');
      const product = products.find(p => p.id === rec.productId);
      if (product) {
        product.keys = product.keys || [];
        const tag = rec.value ? dur.tagFor(rec.value, rec.unit) : '';
        for (const o of pending) {
          const code = String(o.serial).replace(/[\r\n]+/g, ' ').trim();
          if (!code) continue;
          const entry = tag ? `${code}:${tag}` : code;
          if (!product.keys.includes(entry)) product.keys.push(entry);
          o.keyAdded = true;
        }
        await writeDB('products.json', products);
        changed = true;
      } else {
        pending.forEach(o => { o.error = 'Produk sudah dihapus — key tidak ditambahkan'; });
        changed = true;
      }
    }

    if (changed) {
      rec.updatedAt = new Date().toISOString();
      await writeDB('restocks.json', restocks);
    }
    return rec;
  } finally {
    restockBusy.delete(restockId);
  }
}

// Data panel restock
app.get('/admin/restock/data', requireAdmin, async (req, res) => {
  try {
    const settings = await ensureYouduCallbackSecret();
    const y = settings.youdu || {};
    const cfg = youdu.cfgFrom(settings);
    const products = await readFresh('products.json');
    const restocks = (await readFresh('restocks.json')).slice(-40).reverse();
    res.json({
      success: true,
      configured: !!(cfg.token && cfg.apiKey),
      tokenHint: maskSecret(cfg.token),
      apiKeyHint: maskSecret(cfg.apiKey),
      sandbox: !!y.sandbox,
      callbackUrl: `${publicBaseUrl(req)}/api/youdu/callback/${y.callbackSecret}`,
      maxBatch: RESTOCK_MAX_BATCH,
      map: y.map || {},
      products: products.map(p => ({
        id: p.id, name: p.name,
        packages: (p.pricingOptions || []).map(o => {
          const unit = dur.normUnit(o.unit);
          return { value: o.days, unit, label: dur.human(o.days, unit), tag: dur.tagFor(o.days, unit),
                   stock: dur.stockFor(p.keys, o.days, unit) };
        })
      })),
      restocks
    });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/admin/restock/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await ensureYouduCallbackSecret();
    const { token, apiKey, sandbox } = req.body;
    settings.youdu = settings.youdu || {};
    // Field kosong = jangan ubah (nilai asli tidak pernah dikirim balik ke browser)
    if (token && String(token).trim()) settings.youdu.token = String(token).trim().replace(/^Bearer\s+/i, '');
    if (apiKey && String(apiKey).trim()) settings.youdu.apiKey = String(apiKey).trim();
    if (sandbox !== undefined) settings.youdu.sandbox = (sandbox === true || sandbox === 'true' || sandbox === 'on');
    await writeDB('settings.json', settings);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/admin/restock/test', requireAdmin, async (req, res) => {
  try {
    const settings = await readFresh('settings.json');
    const b = await youdu.getBalance(youdu.cfgFrom(settings));
    res.json({ success: true, name: b.name, membership: b.membership, balance: Number(b.balance) || 0 });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.get('/admin/restock/supplier-products', requireAdmin, async (req, res) => {
  try {
    const settings = await readFresh('settings.json');
    res.json({ success: true, data: await getSupplierProducts(settings, !!req.query.refresh) });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

const getSupplierProducts = async (settings, force = false) => {
  if (force || Date.now() - supplierProductsCache.at > 60000) {
    supplierProductsCache = { at: Date.now(), data: await youdu.getProducts(youdu.cfgFrom(settings)) };
  }
  return supplierProductsCache.data;
};

// Ubah input admin (kode ATAU potongan nama produk) jadi kode produk supplier yang VALID.
// Mencegah menyimpan teks bebas (mis. "aimhack") yang nanti ditolak supplier "code is invalid".
const resolveSupplierCode = (input, list) => {
  const q = String(input).trim().toLowerCase();
  const byCode = list.find(p => String(p.code).toLowerCase() === q);
  if (byCode) return { ok: true, product: byCode };
  const tokens = q.split(/\s+/).filter(Boolean);
  const hits = list.filter(p => {
    const hay = `${p.code} ${p.serviceName} ${p.category || ''}`.toLowerCase();
    return tokens.every(t => hay.includes(t));
  });
  if (hits.length === 1) return { ok: true, product: hits[0] };
  const cands = (hits.length ? hits : []).slice(0, 8).map(p => ({ code: p.code, name: p.serviceName, price: p.price }));
  return {
    ok: false, candidates: cands,
    message: hits.length
      ? `"${input}" cocok dengan ${hits.length} produk supplier. Pilih salah satu kodenya.`
      : `"${input}" tidak ditemukan di daftar produk YouduStore. Ketik nama produk lalu pilih dari saran, atau isi kode yang benar.`
  };
};

// Simpan pemetaan paket produk → kode produk supplier
app.post('/admin/restock/map', requireAdmin, async (req, res) => {
  try {
    const { productId, tag, code, data } = req.body;
    if (!productId || !tag) return res.json({ success: false, message: 'Data tidak lengkap' });
    const products = await readFresh('products.json');
    if (!products.find(p => p.id === productId)) return res.json({ success: false, message: 'Produk tidak ditemukan' });
    const settings = await readFresh('settings.json');
    settings.youdu = settings.youdu || { map: {} };
    settings.youdu.map = settings.youdu.map || {};
    const c = String(code || '').trim();
    let resolved = null;
    if (!c) {
      if (settings.youdu.map[productId]) delete settings.youdu.map[productId][tag];
    } else {
      let list;
      try { list = await getSupplierProducts(settings); }
      catch (e) { return res.json({ success: false, message: 'Tidak bisa memverifikasi kode ke YouduStore: ' + e.message }); }
      const r = resolveSupplierCode(c, list);
      if (!r.ok) return res.json({ success: false, message: r.message, candidates: r.candidates });
      resolved = { code: r.product.code, name: r.product.serviceName, price: r.product.price };
      settings.youdu.map[productId] = settings.youdu.map[productId] || {};
      settings.youdu.map[productId][tag] = { code: r.product.code, data: String(data || '-').trim() || '-' };
    }
    await writeDB('settings.json', settings);
    res.json({ success: true, map: settings.youdu.map, resolved });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Pesan N key ke supplier
app.post('/admin/restock/order', requireAdmin, async (req, res) => {
  if (restockBusy.has('order')) return res.json({ success: false, message: 'Restock lain masih berjalan, tunggu sebentar...' });
  restockBusy.add('order');
  try {
    const { productId, value, unit, qty } = req.body;
    const n = Math.min(Math.max(parseInt(qty, 10) || 0, 0), RESTOCK_MAX_BATCH);
    if (n < 1) return res.json({ success: false, message: `Jumlah restock 1–${RESTOCK_MAX_BATCH}` });

    const settings = await ensureYouduCallbackSecret();
    const cfg = youdu.cfgFrom(settings);
    const products = await readFresh('products.json');
    const product = products.find(p => p.id === productId);
    if (!product) return res.json({ success: false, message: 'Produk tidak ditemukan' });

    const v = parseInt(value, 10), u = dur.normUnit(unit);
    if (!(v > 0) || !(product.pricingOptions || []).some(o => parseInt(o.days, 10) === v && dur.normUnit(o.unit) === u)) {
      return res.json({ success: false, message: 'Paket produk tidak ditemukan' });
    }
    const mapping = settings.youdu?.map?.[productId]?.[dur.tagFor(v, u)];
    if (!mapping?.code) return res.json({ success: false, message: 'Paket ini belum dipetakan ke produk supplier' });

    const callbackUrl = `${publicBaseUrl(req)}/api/youdu/callback/${settings.youdu.callbackSecret}`;
    const rec = {
      id: uuidv4(), productId, productName: product.name, value: v, unit: u,
      supplierCode: mapping.code, qty: n, sandbox: !!cfg.sandbox, orders: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    const restocks = await readFresh('restocks.json');
    restocks.push(rec);
    if (restocks.length > 300) restocks.splice(0, restocks.length - 300);
    await writeDB('restocks.json', restocks);

    let stopMsg = null;
    const base = Date.now().toString(36);
    for (let i = 1; i <= n; i++) {
      const o = { reference: `RS-${base}-${i}`, invoice: null, status: 'processing', serial: '', note: '', keyAdded: false };
      rec.orders.push(o);
      try {
        const d = await youdu.placeOrder(cfg, {
          code: mapping.code, data: mapping.data || '-', referenceNumber: o.reference,
          telp: (settings.contact?.whatsapp || '').replace(/\D/g, '') || undefined,
          callbackUrl
        });
        o.invoice = d.invoice_number || null;
      } catch (e) {
        o.error = e.message;
        if (e.definitive) {
          o.status = 'failed';
          stopMsg = /code.*invalid|invalid.*code/i.test(e.message)
            ? `${e.message} — kode produk supplier salah, petakan ulang paket ini (pilih dari saran produk supplier)`
            : e.message;
        }
        else { o.status = 'processing'; stopMsg = `${e.message} — status order terakhir belum pasti, klik "Cek Status"`; }
        break;   // saldo habis / token salah / timeout → jangan lanjut memesan
      }
      await writeDB('restocks.json', restocks);
    }
    await writeDB('restocks.json', restocks);

    // Cek status sekali (order biasanya langsung diproses otomatis)
    const result = await refreshRestock(rec.id) || rec;
    res.json({ success: true, restock: result, placed: result.orders.filter(o => o.invoice).length, requested: n, warning: stopMsg || undefined });
  } catch (e) {
    console.error('[restock/order] error:', e.message);
    res.json({ success: false, message: e.message });
  } finally {
    restockBusy.delete('order');
  }
});

app.post('/admin/restock/check/:id', requireAdmin, async (req, res) => {
  try {
    const rec = await refreshRestock(req.params.id);
    if (!rec) return res.json({ success: false, message: 'Sedang diproses atau restock tidak ditemukan' });
    res.json({ success: true, restock: rec });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

// Callback supplier (POST ke URL kita saat status order berubah).
// Secret ada di path URL karena dokumentasi supplier tidak menyediakan signature.
// Isi body TIDAK dipercaya: kita hanya memakainya sebagai pemicu, lalu status
// dicek ulang langsung ke API supplier.
app.post('/api/youdu/callback/:secret', async (req, res) => {
  try {
    const settings = await readFresh('settings.json');
    const secret = settings.youdu?.callbackSecret;
    if (!secret || !safeEqual(req.params.secret, secret)) return res.status(404).send('Not found');
    const ref = String(req.body?.reference || '');
    if (ref) {
      const restocks = await readFresh('restocks.json');
      const rec = restocks.find(r => r.orders.some(o => o.invoice === ref || o.reference === ref));
      if (rec) await refreshRestock(rec.id, { skipIfOrdering: true });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('[youdu-callback] error:', e.message);
    res.status(500).json({ success: false });
  }
});

// ═══════════════════════════════════════════════════════════
// VOUCHER SYSTEM
// ═══════════════════════════════════════════════════════════

app.get('/admin/vouchers', requireAdmin, async (req, res) => {
  res.json({ success: true, data: await readFresh('vouchers.json') });
});

app.post('/admin/vouchers/add', requireAdmin, async (req, res) => {
  try {
    const { code, type, value, minPurchase, maxUses, perUserLimit, expiresAt, description, excludeReseller } = req.body;
    if (!code || !type || value === undefined) return res.json({ success: false, message: 'Kode, tipe, dan nilai wajib diisi' });
    const val = parseFloat(value);
    if (isNaN(val) || val <= 0) return res.json({ success: false, message: 'Nilai voucher tidak valid' });
    if (type === 'percent' && val > 100) return res.json({ success: false, message: 'Persentase diskon maksimal 100%' });
    const vouchers = await readFresh('vouchers.json');
    if (vouchers.find(v => v.code.toUpperCase() === code.trim().toUpperCase())) {
      return res.json({ success: false, message: 'Kode voucher sudah ada' });
    }
    const newV = {
      id: uuidv4(),
      code: code.trim().toUpperCase(),
      type,
      value: val,
      minPurchase: parseInt(minPurchase) || 0,
      maxUses: parseInt(maxUses) || 0,
      perUserLimit: parseInt(perUserLimit) || 1,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      description: description?.trim() || '',
      excludeReseller: excludeReseller === true || excludeReseller === 'true',
      active: true,
      usedCount: 0,
      usages: [],
      createdAt: new Date().toISOString()
    };
    vouchers.push(newV);
    await writeDB('vouchers.json', vouchers);
    res.json({ success: true, data: vouchers });
  } catch (e) { res.json({ success: false, message: e.message }); }
});

app.post('/admin/vouchers/toggle/:id', requireAdmin, async (req, res) => {
  try {
    const vouchers = await readFresh('vouchers.json');
    const v = vouchers.find(v => v.id === req.params.id);
    if (!v) return res.json({ success: false, message: 'Voucher tidak ditemukan' });
    v.active = !v.active;
    await writeDB('vouchers.json', vouchers);
    res.json({ success: true, active: v.active });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/admin/vouchers/delete/:id', requireAdmin, async (req, res) => {
  try {
    let vouchers = await readFresh('vouchers.json');
    vouchers = vouchers.filter(v => v.id !== req.params.id);
    await writeDB('vouchers.json', vouchers);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});
