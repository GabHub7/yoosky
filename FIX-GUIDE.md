# 🔧 PANDUAN FIX — YOOSKY STORE

## Masalah yang sudah diperbaiki dalam versi ini:
1. ✅ Logo YS transparan (logo-ys-removebg-preview.png) sudah diganti ke `public/uploads/logo-ys.png`
2. ✅ `seed-settings.js` sekarang **selalu overwrite** logo lama di Supabase Storage (tidak lagi skip kalau sudah ada)
3. ✅ Script baru `reset-admin.js` untuk reset password admin tanpa ubah data lain

---

## 🔴 MASALAH 1: Logo Putih / Tidak Transparan

### Penyebab:
Logo lama (`logo-ys.png`) di Supabase Storage masih yang versi putih.
File baru sudah diganti di `public/uploads/logo-ys.png` (RGBA transparan).

### Fix — Jalankan seed-settings.js:
```bash
# Di file .env lokal, tambahkan:
SEED_ADMIN_USERNAME=username_admin_kamu
SEED_ADMIN_PASSWORD=password_admin_kamu

# Lalu jalankan:
node seed-settings.js
```

Script ini sekarang akan **OVERWRITE** logo lama di Supabase Storage.
Setelah selesai, logo baru langsung tampil tanpa perlu redeploy Vercel.

---

## 🔴 MASALAH 2: Admin Tidak Bisa Login

### Kemungkinan Penyebab:

**A) Settings di Supabase tidak ada / kosong**
Saat migrate SQL, tabel `keyvalue_store` mungkin kosong — belum ada `settings.json`.
Server akan pakai `INITIAL_ADMIN_PASSWORD` dari env var, atau generate random kalau tidak ada.

**B) Password di Supabase tidak match dengan yang kamu coba**
Jika sebelumnya ada run `seed-settings.js` dengan password berbeda, hash yang tersimpan berubah.

**C) SUPABASE_SERVICE_ROLE_KEY salah**
Pakai ANON key? Admin panel akan gagal baca settings dari Supabase.

### Fix Cepat — Gunakan script reset-admin.js:
```bash
# 1. Pastikan .env punya ini:
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...  # SERVICE ROLE key, bukan anon!
SEED_ADMIN_USERNAME=admin_baru
SEED_ADMIN_PASSWORD=password_baru_kuat

# 2. Jalankan:
node reset-admin.js
```

Script akan:
- Ambil settings existing dari Supabase
- Update HANYA adminUsername + adminPassword
- Verifikasi hash di Supabase sudah benar
- Print konfirmasi sukses

**3. URL Login Admin:**
```
https://domain-kamu.vercel.app/vpr-secure-panel-8x
```
(Bukan `/login` biasa! Itu untuk user biasa.)

---

## 🔴 MASALAH 3: CF Turnstile Tidak Bisa Selesai

### Penyebab:
Turnstile SITE_KEY dan SECRET_KEY yang dipakai mungkin salah atau domain tidak terdaftar.

### Fix:

**Opsi A — Matikan Turnstile sementara (paling cepat):**
Di Vercel environment variables, HAPUS atau KOSONGKAN:
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

Kalau kosong, turnstile otomatis tidak aktif. Login langsung bisa tanpa captcha.

**Opsi B — Daftarkan domain yang benar:**
1. Buka https://dash.cloudflare.com → Turnstile
2. Edit widget yang ada
3. Pastikan domain yang didaftarkan SAMA PERSIS dengan domain Vercel kamu
   - Contoh: `yooskystore.vercel.app` bukan `www.yooskystore.vercel.app`
4. Kalau pakai custom domain, daftarkan custom domain tersebut
5. Turnstile Cloudflare butuh `https://` — tidak bisa di `localhost`

**Catatan penting:** Admin login (`/vpr-secure-panel-8x`) **TIDAK** pakai Turnstile sama sekali.
Turnstile hanya di `/login` (user biasa) dan `/register`.

---

## 🟢 LANGKAH LENGKAP SETELAH DEPLOY BARU:

```bash
# 1. Set env vars di .env lokal (untuk jalankan script)
cp .env.example .env
# Edit .env: isi SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 
#            SEED_ADMIN_USERNAME, SEED_ADMIN_PASSWORD

# 2. Install dependencies
npm install

# 3. Upload logo + reset admin sekaligus
node seed-settings.js
# ATAU kalau hanya mau reset admin (pertahankan logo lama):
node reset-admin.js

# 4. Vercel env vars yang WAJIB diset:
#    - SUPABASE_URL
#    - SUPABASE_SERVICE_ROLE_KEY  ← SERVICE ROLE, bukan anon!
#    - SESSION_SECRET (string random 64 karakter)
#    - NODE_ENV=production
#
# 5. Login admin di: /vpr-secure-panel-8x
```

---

## 📋 Cek Cepat Kalau Masih Bermasalah:

| Gejala | Kemungkinan Penyebab | Fix |
|--------|---------------------|-----|
| Logo putih | Logo lama masih di Supabase Storage | Jalankan `seed-settings.js` |
| Admin: "Konfigurasi admin belum tersedia" | Settings.json kosong di Supabase | Jalankan `reset-admin.js` |
| Admin: "Username atau password salah" | Hash tidak match | Jalankan `reset-admin.js` |
| Turnstile stuck "Verifying..." | Domain tidak terdaftar di CF | Kosongkan TURNSTILE env vars |
| Supabase error ANON key | Pakai anon key bukan service role | Ganti ke SERVICE_ROLE_KEY |
