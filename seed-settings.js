/**
 * seed-settings.js — Push settings + logo ke Supabase
 * 
 * CARA PAKAI:
 *   node seed-settings.js
 * 
 * Jalankan SEKALI setelah deploy atau setiap kali ganti credentials.
 * Script ini akan:
 *   1. Upload logo ke Supabase Storage → dapat URL publik
 *   2. Overwrite settings di Supabase dengan kredensial & konfigurasi terbaru
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // bukan anon key — RLS sekarang blokir anon

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Set SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di file .env dulu!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ── KREDENSIAL — bisa override via .env ──
const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME || 'Abdurahman Mulvi Tarakan';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Tarakan11#';

const SITE_NAME   = 'YOOSKY STORE';
const WA_NUMBER   = '6281549460894';
const WA_TELEGRAM = 'YooskyModz';
const WA_CHANNEL  = 'https://whatsapp.com/channel/0029Vb7MKnEKbYMGZcDUAj0C';
const WA_GROUP    = 'https://chat.whatsapp.com/KbD6Yyyt5c8A9lZyykwSap';
// ─────────────────────────────────────────────────────────

async function uploadLogo() {
  const logoPath = path.join(__dirname, 'public', 'uploads', 'logo-ys.png');
  if (!fs.existsSync(logoPath)) {
    console.log('⚠️  Logo file tidak ditemukan di public/uploads/logo-ys.png, skip upload.');
    return null;
  }
  const fileBuffer = fs.readFileSync(logoPath);

  // Selalu upload ulang logo (upsert: true) agar logo baru menimpa yang lama
  const { error } = await supabase.storage
    .from('product-images')
    .upload('logo-ys.png', fileBuffer, { contentType: 'image/png', upsert: true });

  if (error) {
    console.error('⚠️  Gagal upload logo ke storage:', error.message);
    return null;
  }
  const { data: { publicUrl } } = supabase.storage
    .from('product-images').getPublicUrl('logo-ys.png');
  console.log('✅ Logo diupload ke Supabase Storage:', publicUrl);
  return publicUrl;
}

async function uploadBanner() {
  const bannerPath = path.join(__dirname, 'public', 'uploads', 'banner-reseller.jpg');
  if (!require('fs').existsSync(bannerPath)) {
    console.log('⚠️  Banner file tidak ditemukan di public/uploads/banner-reseller.jpg, skip upload.');
    return null;
  }
  const fileBuffer = require('fs').readFileSync(bannerPath);
  const { data: existList } = await supabase.storage.from('product-images').list('', { search: 'banner-reseller.jpg' });
  if (existList && existList.length > 0) {
    const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl('banner-reseller.jpg');
    console.log('ℹ️  Banner sudah ada di storage:', publicUrl);
    return publicUrl;
  }
  const { error } = await supabase.storage.from('product-images').upload('banner-reseller.jpg', fileBuffer, { contentType: 'image/jpeg', upsert: true });
  if (error) { console.error('⚠️  Gagal upload banner:', error.message); return null; }
  const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl('banner-reseller.jpg');
  console.log('✅ Banner diupload ke Supabase Storage:', publicUrl);
  return publicUrl;
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  YOOSKY STORE — Seed Settings ke Supabase');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Upload logo & banner
  const logoUrl = await uploadLogo();
  const bannerUrl = await uploadBanner();

  // 2. Ambil settings existing
  const { data: existing } = await supabase
    .from('keyvalue_store').select('value').eq('key', 'settings.json').single();
  const current = (existing?.value && typeof existing.value === 'object') ? existing.value : {};
  console.log('📋 Existing adminUsername:', current.adminUsername || '(none)');

  // 3. Build settings baru
  const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
  const newSettings = {
    ...current,                          // pertahankan data yang ada (produk, pakasir key, dll)
    siteName: SITE_NAME,
    gamePanelName: SITE_NAME,
    about: `${SITE_NAME} menyediakan layanan topup games dan key mod aplikasi premium terbaik #1 indonesia.`,
    marqueeText: 'LAYANAN GAME MOD MENU PREMIUM - PROSES CEPAT & AMAN',
    contact: {
      whatsapp: WA_NUMBER,
      telegram: WA_TELEGRAM,
      email: 'support@yooskystore.com',
      waChannel: WA_CHANNEL,
      waGroup: WA_GROUP,
    },
    adminUsername: ADMIN_USERNAME,
    adminPassword: adminHash,
    logoUrl: logoUrl || current.logoUrl || '/uploads/logo-ys.png',
    categories: current.categories || ['freefire','mlbb','pubgm','sertifikat'],
    categoryLabels: current.categoryLabels || {
      freefire:'FREE FIRE', mlbb:'MOBILE LEGENDS', pubgm:'PUBG MOBILE', sertifikat:'SERTIFIKAT'
    },
    resellerEnabled: true,
    resellerPrice: current.resellerPrice ?? 50000,
    resellerDiscount: current.resellerDiscount ?? 20,
    resellerNote: current.resellerNote || 'Dapatkan diskon eksklusif untuk semua produk!',
    popularProductIds: current.popularProductIds || [],
    pakasir: current.pakasir || { apiKey:'', project:'', mode:'production' },
    banners: current.banners?.length ? current.banners : [
      { url: bannerUrl || '/uploads/banner-reseller.jpg', title: 'Open Reseller', link: '/reseller', active: true }
    ],
  };

  // 4. Upsert ke Supabase
  const { error } = await supabase
    .from('keyvalue_store')
    .upsert({ key: 'settings.json', value: newSettings }, { onConflict: 'key' });

  if (error) {
    console.error('❌ Gagal simpan ke Supabase:', error.message);
    process.exit(1);
  }

  // 5. Verifikasi
  const { data: v } = await supabase
    .from('keyvalue_store').select('value').eq('key', 'settings.json').single();
  const saved = v?.value;

  console.log('\n✅ BERHASIL disimpan ke Supabase!');
  console.log('┌─────────────────────────────────────────');
  console.log('│ siteName     :', saved?.siteName);
  console.log('│ adminUsername:', saved?.adminUsername);
  console.log('│ logoUrl      :', saved?.logoUrl);
  console.log('│ whatsapp     :', saved?.contact?.whatsapp);
  console.log('│ banners      :', saved?.banners?.length ?? 0, 'item(s)');
  console.log('│ hash verify  :', bcrypt.compareSync(ADMIN_PASSWORD, saved?.adminPassword || '') ? '✅ OK' : '❌ GAGAL');
  console.log('└─────────────────────────────────────────');
  console.log(`\n🔐 Login admin: username=${ADMIN_USERNAME}  password=(dari .env, tidak ditampilkan)`);
  console.log('🌐 Deploy ulang Vercel agar settings baru aktif.\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
