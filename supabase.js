// Supabase integration — drop-in replacement untuk jsonbin.js
// Interface identik: readDB(filename) dan writeDB(filename, data)

const fs = require('fs');
const path = require('path');

let supabase = null;
let dbCache = {};
let lastClientInitError = null; // pesan error asli kalau createClient() gagal, supaya bisa ditampilkan ke admin
const DB_FILES = ['users.json','products.json','transactions.json','testimonials.json','notifications.json','settings.json','keyspool.json','vouchers.json','admin-lock.json'];

// File yang defaultnya object {} bukan array [] saat cache masih kosong
const OBJECT_FILES = new Set(['settings.json', 'admin-lock.json']);

// Lazy init Supabase client
const getClient = () => {
  if (supabase) return supabase;
  // .trim() penting: copy-paste value env var dari Supabase/Vercel sering
  // kebawa spasi atau newline tak kasat mata di awal/akhir, yang bikin
  // createClient() gagal dengan cara yang sulit dilacak.
  const url = (process.env.SUPABASE_URL || '').trim();
  // PENTING: pakai SERVICE_ROLE key, bukan ANON key.
  // Server kita butuh full read/write ke tabel keyvalue_store, dan RLS
  // sekarang memblokir anon sepenuhnya (lihat supabase-schema.sql).
  // Service role key BYPASS RLS by design — makanya HARUS hanya
  // dipakai di server, JANGAN PERNAH dikirim ke browser/client code.
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!key && process.env.SUPABASE_ANON_KEY) {
    console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY belum di-set. Anon key TIDAK akan bisa baca/tulis karena RLS sekarang membatasi akses anon. Set SUPABASE_SERVICE_ROLE_KEY di env Vercel.');
  }
  if (!url || !key) return null;
  try {
    new URL(url); // validasi format URL eksplisit (kasih pesan jelas kalau salah format, bukan cuma gagal diam-diam)
  } catch (e) {
    lastClientInitError = `SUPABASE_URL formatnya tidak valid: "${url}" — harus seperti https://xxxxx.supabase.co (tanpa spasi/baris baru tersembunyi).`;
    console.error('[supabase]', lastClientInitError);
    return null;
  }
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(url, key, {
      auth: { persistSession: false }
    });
    lastClientInitError = null;
    return supabase;
  } catch (e) {
    lastClientInitError = e?.message || String(e) || 'createClient() gagal tanpa pesan error.';
    console.error('[supabase] createClient error:', lastClientInitError);
    return null;
  }
};

// Local /tmp backup agar ada fallback saat Supabase lambat
const isVercel = process.env.VERCEL === '1' || !!process.env.NOW_REGION;
const localDbPath = isVercel ? '/tmp/database' : path.join(__dirname, 'database');
if (!fs.existsSync(localDbPath)) { try { fs.mkdirSync(localDbPath, { recursive: true }); } catch {} }

const writeLocalBackup = (filename, data) => {
  try { fs.writeFileSync(path.join(localDbPath, filename), JSON.stringify(data)); } catch {}
};

const readLocalBackup = (filename) => {
  try {
    const p = path.join(localDbPath, filename);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return null; }
};

// ── PUBLIC API ──────────────────────────────────────────────

// TTL tracking: catat kapan terakhir cache di-sync dari Supabase
const cacheTimestamp = {}; // filename -> timestamp ms
const CACHE_TTL = 8000;    // 8 detik — cukup cepat untuk konsistensi

const readDB = (filename) => {
  return dbCache[filename] !== undefined
    ? dbCache[filename]
    : (OBJECT_FILES.has(filename) ? {} : []);
};

// readSmart: pakai cache jika masih segar (<TTL), else fetch Supabase
// Untuk GET endpoints yang butuh konsistensi antar instance Vercel
const readSmart = async (filename) => {
  const now = Date.now();
  const age = now - (cacheTimestamp[filename] || 0);
  if (age < CACHE_TTL) return readDB(filename); // cache masih fresh
  return readFresh(filename);                    // stale → ambil dari Supabase
};

const writeDB = async (filename, data) => {
  dbCache[filename] = data;
  cacheTimestamp[filename] = Date.now(); // mark fresh setelah write
  writeLocalBackup(filename, data);
  const client = getClient();
  if (!client) return;
  try {
    const { error } = await client
      .from('keyvalue_store')
      .upsert({ key: filename, value: data }, { onConflict: 'key' });
    if (error) console.error(`[supabase] writeDB ${filename}:`, error.message);
  } catch (e) {
    console.error(`[supabase] writeDB ${filename} exception:`, e.message);
  }
};

const initializeDB = async () => {
  console.log('📦 Initializing database (Supabase)...');

  // 1. Load local backup ke cache sebagai baseline
  for (const f of DB_FILES) {
    const local = readLocalBackup(f);
    if (local !== null) dbCache[f] = local;
    else dbCache[f] = OBJECT_FILES.has(f) ? {} : [];
  }

  const client = getClient();
  if (!client) {
    console.warn('⚠️  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum di-set. Pakai local fallback.');
    return;
  }

  // 2. Load dari Supabase (source of truth)
  try {
    const { data, error } = await client
      .from('keyvalue_store')
      .select('key, value');
    if (error) throw new Error(error.message);
    if (data && data.length > 0) {
      data.forEach(row => {
        dbCache[row.key] = row.value;
        writeLocalBackup(row.key, row.value);
      });
      console.log(`✅ Database connected to Supabase (${data.length} collections loaded)`);
    } else {
      console.log('📝 Supabase table kosong, seeding...');
      await seedSupabase(client);
      console.log('✅ Supabase seeded');
    }
  } catch (e) {
    const msg = e.message || '';
    // Table belum dibuat — coba buat otomatis via SQL langsung
    if (msg.includes('relation') || msg.includes('does not exist') || msg.includes('42P01')) {
      console.warn('⚠️  Tabel keyvalue_store belum ada. Mencoba buat otomatis...');
      try {
        await ensureTableExists();
        // Coba load ulang
        const { data: d2 } = await client.from('keyvalue_store').select('key, value');
        if (d2 && d2.length > 0) {
          d2.forEach(row => { dbCache[row.key] = row.value; writeLocalBackup(row.key, row.value); });
          console.log(`✅ Loaded ${d2.length} collections after table creation`);
        } else {
          await seedSupabase(client);
        }
        return;
      } catch (e2) {
        console.error('❌ Gagal buat tabel otomatis. JALANKAN SQL SCHEMA DI SUPABASE DASHBOARD!');
        console.error('   https://supabase.com/dashboard/project/' + (process.env.SUPABASE_URL || '').split('.')[0].replace('https://', '') + '/sql/new');
      }
    }
    console.warn('⚠️  Supabase error, pakai local cache:', msg);
  }
};

// Coba buat tabel otomatis via direct PostgreSQL
const ensureTableExists = async () => {
  const url = process.env.SUPABASE_URL || '';
  const pw = process.env.SUPABASE_DB_PASSWORD;
  if (!pw) throw new Error('SUPABASE_DB_PASSWORD belum di-set');
  const ref = url.replace('https://', '').split('.')[0];
  const fs = require('fs');
  const { Pool } = require('pg');
  const pool = new Pool({
    host: `db.${ref}.supabase.co`,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: pw,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, 'supabase-schema.sql'), 'utf-8'));
    console.log('✅ Tabel keyvalue_store berhasil dibuat');
  } finally {
    await pool.end();
  }
};

const seedSupabase = async (client) => {
  const rows = DB_FILES.map(f => ({ key: f, value: dbCache[f] || (OBJECT_FILES.has(f) ? {} : []) }));
  const { error } = await client
    .from('keyvalue_store')
    .upsert(rows, { onConflict: 'key', ignoreDuplicates: true });
  if (error) console.error('[supabase] seed error:', error.message);
};


// ── UPLOAD IMAGE ke Supabase Storage ─────────────────────
const uploadImage = async (fileBuffer, filename, contentType) => {
  const client = getClient();
  if (!client) throw new Error('Supabase tidak terkonfigurasi');

  const cleanName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const { data, error } = await client.storage
    .from('product-images')
    .upload(cleanName, fileBuffer, {
      contentType,
      upsert: false
    });

  if (error) throw new Error('Gagal upload: ' + error.message);

  const { data: { publicUrl } } = client.storage
    .from('product-images')
    .getPublicUrl(cleanName);

  return publicUrl;
};

// Status untuk admin endpoint
const getDbStatus = async () => {
  const hasUrl = !!process.env.SUPABASE_URL;
  const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasDbPw = !!process.env.SUPABASE_DB_PASSWORD;
  // Kesalahan umum: orang set SUPABASE_ANON_KEY mengira itu yang dipakai,
  // padahal app ini WAJIB pakai SERVICE_ROLE key (lihat komentar di getClient()).
  const hasAnonKeyOnly = !hasKey && !!process.env.SUPABASE_ANON_KEY;
  const client = getClient();
  let connected = false, tableExists = false, errorMsg = null, projectPaused = false;
  if (client) {
    try {
      const { data, error, status, statusText } = await client
        .from('keyvalue_store')
        .select('key', { count: 'exact', head: true })
        .limit(1);

      if (error) {
        // Kumpulkan semua field error yang ada supaya diagnosisnya lengkap
        const code    = error.code    || '';
        const msg     = error.message || '';
        const details = error.details || '';
        const hint    = error.hint    || '';

        if (!msg && !code && !details) {
          // {"message":""} → Supabase client berhasil dibuat tapi query balik
          // error kosong. Ini hampir selalu berarti salah satu dari:
          // (a) project Supabase sedang PAUSED (free tier auto-pause 7 hari)
          // (b) tabel keyvalue_store belum pernah dibuat
          // (c) service_role key valid formatnya tapi bukan milik project ini
          projectPaused = true;
          errorMsg = 'PROJECT_PAUSED_OR_TABLE_MISSING';
        } else if (code === '42P01' || msg.includes('does not exist') || msg.includes('relation')) {
          tableExists = false;
          connected = true; // koneksi oke, cuma tabelnya belum ada
          errorMsg = 'TABLE_NOT_FOUND';
        } else {
          errorMsg = [msg, code && `(code: ${code})`, details, hint].filter(Boolean).join(' — ') || JSON.stringify(error);
        }
      } else {
        connected = true;
        tableExists = true;
      }
    } catch (e) {
      errorMsg = e?.message || e?.toString?.() || 'Fetch ke Supabase gagal (network timeout atau project paused).';
    }
  } else if (hasUrl && hasKey) {
    errorMsg = lastClientInitError || 'Client Supabase gagal dibuat. Cek value SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY.';
  }

  const urlRaw = (process.env.SUPABASE_URL || '').trim();
  const projectRef = urlRaw ? urlRaw.replace('https://', '').split('.')[0] : null;
  return {
    driver: 'supabase',
    connected,
    tableExists,
    errorMsg,
    projectPaused,
    hasUrl,
    hasKey,
    hasDbPw,
    hasAnonKeyOnly,
    projectRef,
    projectUrl: urlRaw || null,
    restoreUrl: projectRef ? `https://supabase.com/dashboard/project/${projectRef}` : null,
    sqlEditorUrl: projectRef ? `https://supabase.com/dashboard/project/${projectRef}/sql/new` : null,
    canAutoCreate: hasDbPw && projectRef
  };
};

// Baca langsung dari Supabase (bypass cache) — untuk operasi kritis
// yang butuh data paling fresh, misal admin concurrent write
const readFresh = async (filename) => {
  const client = getClient();
  if (!client) return readDB(filename); // fallback ke cache jika offline
  try {
    const { data, error } = await client
      .from('keyvalue_store')
      .select('value')
      .eq('key', filename)
      .single();
    if (!error && data?.value !== undefined) {
      dbCache[filename] = data.value;
      cacheTimestamp[filename] = Date.now(); // mark fresh
      writeLocalBackup(filename, data.value);
      return data.value;
    }
  } catch {}
  return readDB(filename);
};

// Re-fetch satu file dari Supabase ke cache — backward compat
const refreshFromDB = async (filename) => {
  const client = getClient();
  if (!client) return;
  try {
    const { data, error } = await client
      .from('keyvalue_store')
      .select('value')
      .eq('key', filename)
      .single();
    if (!error && data?.value !== undefined) {
      dbCache[filename] = data.value;
      cacheTimestamp[filename] = Date.now();
      writeLocalBackup(filename, data.value);
    }
  } catch {}
};

module.exports = { readDB, writeDB, initializeDB, getDbStatus, uploadImage, refreshFromDB, readFresh, readSmart };
