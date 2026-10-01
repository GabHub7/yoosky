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

// ── VERSION TRACKING (hemat egress Supabase) ────────────────
// Tiap file di keyvalue_store punya kolom updated_at. Versi terakhir yang
// kita lihat disimpan per file. Saat butuh data "fresh", cukup tanya
// updated_at-nya (beberapa byte); kalau sama dengan versi di cache, blob JSON
// (users/transactions/products bisa ratusan KB) TIDAK diunduh ulang.
const cacheVersion = {};                       // filename -> updated_at
const versionsFile = path.join(localDbPath, '_versions.json');
const loadLocalVersions = () => {
  try { return JSON.parse(fs.readFileSync(versionsFile, 'utf-8')) || {}; } catch { return {}; }
};
const saveLocalVersions = () => {
  try { fs.writeFileSync(versionsFile, JSON.stringify(cacheVersion)); } catch {}
};
const setVersion = (filename, v) => {
  if (!v) { delete cacheVersion[filename]; return; }
  cacheVersion[filename] = v;
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
// 8 detik dirasa terlalu agresif untuk endpoint publik ber-traffic tinggi
// (tiap 8 detik = full re-fetch blob dari Supabase kalau ada request masuk),
// dan ini adalah penyebab utama cached-egress free tier kena limit. 60 detik
// masih cukup responsif untuk data yang di-update lewat admin panel (produk,
// settings, banner), tapi memangkas jumlah fetch ke Supabase secara drastis.
const CACHE_TTL = 60000;   // 60 detik

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
    // updated_at dikirim eksplisit supaya versi SELALU berubah tiap write,
    // walau trigger _set_updated_at di DB belum terpasang. Hasil upsert dibaca
    // balik (cuma kolom updated_at) untuk dicatat sebagai versi cache.
    const { data: row, error } = await client
      .from('keyvalue_store')
      .upsert({ key: filename, value: data, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .select('updated_at')
      .maybeSingle();
    if (error) {
      console.error(`[supabase] writeDB ${filename}:`, error.message);
      setVersion(filename, null); // paksa full fetch di readFresh berikutnya
    } else {
      setVersion(filename, row?.updated_at || null);
      saveLocalVersions();
    }
  } catch (e) {
    console.error(`[supabase] writeDB ${filename} exception:`, e.message);
    setVersion(filename, null);
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
  // HEMAT EGRESS: ambil dulu cuma (key, updated_at). Blob value HANYA diunduh
  // untuk file yang versinya beda dari backup lokal (/tmp). Instance yang
  // masih hangat / backup masih valid tidak download ulang apa-apa.
  try {
    const localVersions = loadLocalVersions();
    const { data: metas, error: metaErr } = await client
      .from('keyvalue_store')
      .select('key, updated_at');
    if (metaErr) throw new Error(metaErr.message);
    if (metas && metas.length > 0) {
      const need = [];
      metas.forEach(m => {
        const hasLocal = fs.existsSync(path.join(localDbPath, m.key));
        if (hasLocal && localVersions[m.key] === m.updated_at) setVersion(m.key, m.updated_at);
        else need.push(m.key);
      });
      if (need.length) {
        const { data, error } = await client
          .from('keyvalue_store')
          .select('key, value, updated_at')
          .in('key', need);
        if (error) throw new Error(error.message);
        (data || []).forEach(row => {
          dbCache[row.key] = row.value;
          setVersion(row.key, row.updated_at);
          writeLocalBackup(row.key, row.value);
        });
      }
      saveLocalVersions();
      console.log(`✅ Database connected to Supabase (${metas.length} collections, ${need.length} diunduh)`);
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
          saveLocalVersions();
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
// HEMAT EGRESS: dulu file asli (foto HP mentah 2-5MB) diupload apa adanya dan
// diserve langsung sebagai <img src> publik, jadi tiap page view = full
// download dari Storage (masuk hitungan egress Supabase). Sekarang di-resize
// max 1000px + WebP q78 sebelum upload (biasanya hemat 70-90%), dan dikasih
// Cache-Control 1 tahun (nama file unik pakai timestamp, jadi aman).
// sharp dimuat lazy & opsional: kalau belum ter-install, upload tetap jalan
// dengan file asli.
let sharpLib = null;
try { sharpLib = require('sharp'); } catch { sharpLib = null; }

const compressImage = async (fileBuffer, contentType) => {
  if (!sharpLib || contentType === 'image/svg+xml' || contentType === 'image/gif') {
    return { buffer: fileBuffer, contentType, ext: contentType === 'image/gif' ? 'gif' : (contentType === 'image/svg+xml' ? 'svg' : null) };
  }
  try {
    const buffer = await sharpLib(fileBuffer)
      .rotate()
      .resize({ width: 1000, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return { buffer, contentType: 'image/webp', ext: 'webp' };
  } catch (e) {
    console.error('[uploadImage] compress gagal, pakai file asli:', e.message);
    return { buffer: fileBuffer, contentType, ext: null };
  }
};

const uploadImage = async (fileBuffer, filename, contentType) => {
  const client = getClient();
  if (!client) throw new Error('Supabase tidak terkonfigurasi');

  const { buffer, contentType: outType, ext } = await compressImage(fileBuffer, contentType);

  const baseName = filename.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.[^.]+$/, '');
  const finalExt = ext || (filename.match(/\.[^.]+$/)?.[0]?.replace('.', '')) || 'jpg';
  const cleanName = `${Date.now()}-${baseName}.${finalExt}`;

  const { error } = await client.storage
    .from('product-images')
    .upload(cleanName, buffer, {
      contentType: outType,
      upsert: false,
      cacheControl: '31536000'
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

// Baca data paling fresh dari Supabase. Tetap konsisten antar instance, tapi
// hemat: cek versi (updated_at) dulu, blob cuma diunduh kalau berubah.
const readFresh = async (filename) => {
  const client = getClient();
  if (!client) return readDB(filename); // fallback ke cache jika offline
  try {
    if (dbCache[filename] !== undefined && cacheVersion[filename]) {
      const { data: meta, error: metaErr } = await client
        .from('keyvalue_store')
        .select('updated_at')
        .eq('key', filename)
        .maybeSingle();
      if (!metaErr && meta && meta.updated_at === cacheVersion[filename]) {
        cacheTimestamp[filename] = Date.now();
        return dbCache[filename]; // versi sama -> cache masih valid, 0 download blob
      }
    }
    const { data, error } = await client
      .from('keyvalue_store')
      .select('value, updated_at')
      .eq('key', filename)
      .single();
    if (!error && data?.value !== undefined) {
      dbCache[filename] = data.value;
      setVersion(filename, data.updated_at);
      cacheTimestamp[filename] = Date.now(); // mark fresh
      writeLocalBackup(filename, data.value);
      saveLocalVersions();
      return data.value;
    }
  } catch {}
  return readDB(filename);
};

// Re-fetch satu file dari Supabase ke cache — backward compat
// (ikut jalur versi yang sama, jadi murah kalau tidak ada perubahan)
const refreshFromDB = async (filename) => { await readFresh(filename); };

module.exports = { readDB, writeDB, initializeDB, getDbStatus, uploadImage, refreshFromDB, readFresh, readSmart };
