/**
 * reset-admin.js — Reset password admin langsung ke Supabase
 * 
 * CARA PAKAI:
 *   1. Pastikan .env sudah berisi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY
 *   2. Set SEED_ADMIN_USERNAME dan SEED_ADMIN_PASSWORD di .env
 *   3. Jalankan: node reset-admin.js
 * 
 * Script ini HANYA update adminUsername + adminPassword di settings.json
 * tanpa mengubah data lain (produk, transaksi, dll).
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Set SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di file .env dulu!');
  process.exit(1);
}

const NEW_USERNAME = process.env.SEED_ADMIN_USERNAME || 'Abdurahman Mulvi Tarakan';
const NEW_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Tarakan11#';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function resetAdmin() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  RESET ADMIN — YOOSKY STORE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Ambil settings existing
  const { data: existing, error: fetchErr } = await supabase
    .from('keyvalue_store')
    .select('value')
    .eq('key', 'settings.json')
    .single();

  if (fetchErr) {
    console.error('❌ Gagal ambil settings dari Supabase:', fetchErr.message);
    console.error('   Pastikan tabel keyvalue_store sudah ada & service role key benar.');
    process.exit(1);
  }

  const current = (existing?.value && typeof existing.value === 'object') ? existing.value : {};
  console.log('📋 Current adminUsername:', current.adminUsername || '(belum ada)');

  // 2. Hash password baru
  console.log('🔐 Hashing password baru...');
  const newHash = bcrypt.hashSync(NEW_PASSWORD, 12);

  // 3. Verify hash benar sebelum save
  const verifyOk = bcrypt.compareSync(NEW_PASSWORD, newHash);
  if (!verifyOk) {
    console.error('❌ Hash verification gagal! Jangan simpan, ada bug bcrypt.');
    process.exit(1);
  }
  console.log('✅ Hash password: OK');

  // 4. Update HANYA username + password, jangan sentuh data lain
  const updatedSettings = {
    ...current,
    adminUsername: NEW_USERNAME,
    adminPassword: newHash,
  };

  const { error: saveErr } = await supabase
    .from('keyvalue_store')
    .upsert({ key: 'settings.json', value: updatedSettings }, { onConflict: 'key' });

  if (saveErr) {
    console.error('❌ Gagal simpan ke Supabase:', saveErr.message);
    process.exit(1);
  }

  // 5. Verifikasi dari Supabase
  const { data: v } = await supabase
    .from('keyvalue_store')
    .select('value')
    .eq('key', 'settings.json')
    .single();

  const saved = v?.value;
  const finalVerify = bcrypt.compareSync(NEW_PASSWORD, saved?.adminPassword || '');

  console.log('\n' + (finalVerify ? '✅' : '❌') + ' HASIL AKHIR:');
  console.log('┌─────────────────────────────────────────');
  console.log('│ adminUsername :', saved?.adminUsername);
  console.log('│ hash tersimpan:', finalVerify ? '✅ PASSWORD MATCH' : '❌ TIDAK MATCH — ADA MASALAH!');
  console.log('└─────────────────────────────────────────');

  if (!finalVerify) {
    console.error('\n❌ GAGAL: Password yang tersimpan tidak match. Coba lagi.');
    process.exit(1);
  }

  console.log('\n🎉 BERHASIL! Admin credentials sudah diupdate di Supabase.');
  console.log(`   Username : ${NEW_USERNAME}`);
  console.log(`   Password : (dari SEED_ADMIN_PASSWORD di .env)`);
  console.log('\n📌 Langkah selanjutnya:');
  console.log('   1. Buka URL admin: /vpr-secure-panel-8x');
  console.log(`   2. Login dengan username: ${NEW_USERNAME}`);
  console.log('   3. Kalau di Vercel, TIDAK perlu redeploy — perubahan langsung aktif.');
  console.log('   4. Setelah login, GANTI password via Admin Panel → Settings.\n');
}

resetAdmin().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
