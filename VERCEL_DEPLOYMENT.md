# YOOSKY STORE - JSONBin.io + Vercel Deployment Guide

Panduan lengkap untuk deploy YOOSKY STORE ke Vercel dengan JSONBin.io sebagai database.

## Tahap 1: Setup JSONBin.io

### 1. Buat akun JSONBin.io
- Kunjungi https://jsonbin.io
- Klik **Sign Up** dan daftar dengan email
- Verifikasi email kamu

### 2. Buat Bin (Database)
- Login ke dashboard JSONBin.io
- Klik **Create Bin**
- Paste struktur database berikut:

```json
{
  "users.json": [],
  "products.json": [],
  "transactions.json": [],
  "testimonials.json": [],
  "notifications.json": [],
  "settings.json": {
    "siteName": "YOOSKY STORE",
    "gamePanelName": "YOOSKY STORE",
    "about": "YOOSKY STORE menyediakan layanan topup games dan key mod aplikasi premium terbaik #1 indonesia.",
    "marqueeText": "LAYANAN GAME MOD MENU PREMIUM - PROSES CEPAT & AMAN",
    "contact": {
      "whatsapp": "6281235690535",
      "telegram": "HEROO3STORE",
      "email": "support@yooskystore.com"
    },
    "pakasir": {
      "apiKey": "",
      "project": "",
      "mode": "production"
    },
    "adminUsername": "admin",
    "adminPassword": "$2a$10$...",
    "categories": ["freefire", "mlbb", "pubgm", "sertifikat"],
    "categoryLabels": {
      "freefire": "FREE FIRE",
      "mlbb": "MOBILE LEGENDS",
      "pubgm": "PUBG MOBILE",
      "sertifikat": "SERTIFIKAT"
    },
    "resellerEnabled": true,
    "resellerPrice": 50000,
    "resellerDiscount": 20,
    "resellerNote": "Dapatkan diskon eksklusif untuk semua produk!"
  }
}
```

- Klik **Save as JSON** → Save as Bin
- Salin **Bin ID** dari URL (mis: `65a7d8f9c1d2e3f4g5h6i7j8`)

### 3. Dapatkan API Key
- Klik profile icon di top right → **Account Settings**
- Scroll ke **API Key** dan salin Master Key (dimulai dengan `$2b_` atau similar)

## Tahap 2: Setup Environment Variables

### Local Development (.env)
Buat file `.env` di folder backend:

```
NODE_ENV=production
PORT=3000
SESSION_SECRET=yooskystore-secret-key-2025-change-this

# JSONBin.io
JSONBIN_API_KEY=your_master_key_here
JSONBIN_BIN_ID=your_bin_id_here
USE_LOCAL_DB=false

# PakKasir (Payment Gateway)
PAKASIR_API_KEY=your_pakasir_key
PAKASIR_PROJECT=your_project_name
PAKASIR_MODE=production

# Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123

# Contact Info
WHATSAPP_NUMBER=6281235690535
TELEGRAM_USERNAME=HEROO3STORE
SUPPORT_EMAIL=support@yooskystore.com

# Site Config
SITE_NAME=YOOSKY STORE
MARQUEE_TEXT=LAYANAN GAME MOD MENU PREMIUM - PROSES CEPAT & AMAN
```

## Tahap 3: Setup Local Testing

### 1. Install Dependencies
```bash
cd backend_fixed
npm install
```

### 2. Test Lokal
```bash
npm start
```
Buka http://localhost:3000

**Pastikan semua fitur berfungsi termasuk:**
- Login/Signup
- Beli produk
- Payment QRIS
- Admin panel

## Tahap 4: Deploy ke Vercel

### 1. Setup Git (jika belum)
```bash
git init
git add .
git commit -m "feat: setup JSONBin database dan Vercel deployment"
git remote add origin https://github.com/username/yooskystore.git
git push -u origin main
```

### 2. Deploy ke Vercel (3 Cara)

#### **Cara A: Vercel CLI (Recommended)**
```bash
# Install Vercel CLI
npm i -g vercel

# Login ke Vercel
vercel login

# Deploy
vercel --prod
```

Saat ditanya:
- Scope: Pilih akun Vercel kamu
- Project name: `yooskystore-backend` (atau nama lain)
- Root directory: `./backend_fixed` (atau folder root kalau structure berbeda)
- Build command: npm install
- Output directory: `.` (root)
- Environment variables: **Isi sesuai .env di atas**

#### **Cara B: GitHub Integration (Paling Mudah)**
1. Push code ke GitHub
2. Kunjungi https://vercel.com/new
3. Import dari GitHub repository
4. Configure:
   - **Framework**: Node.js
   - **Root Directory**: `./backend_fixed` (or select correct folder)
   - **Build Command**: `npm install`
   - **Environment Variables**: Isi dari tabel bawah
5. Klik Deploy

#### **Cara C: Manual Upload ke Vercel Dashboard**
1. Kunjungi https://vercel.com
2. Klik **New Project**
3. Upload folder atau connect GitHub
4. Set environment variables
5. Deploy

### 3. Set Environment Variables di Vercel
Di Vercel Dashboard → Project Settings → Environment Variables, tambahkan:

| Key | Value | Note |
|-----|-------|------|
| `JSONBIN_API_KEY` | `$2b_...` | Master Key dari JSONBin.io |
| `JSONBIN_BIN_ID` | `65a7d8f9...` | Bin ID dari JSONBin.io |
| `USE_LOCAL_DB` | `false` | Gunakan JSONBin (bukan lokal) |
| `SESSION_SECRET` | `your-random-string` | Ganti dengan string random panjang |
| `PAKASIR_API_KEY` | (dari pakasir.com) | Untuk payment QRIS |
| `PAKASIR_PROJECT` | (dari pakasir.com) | Nama project di PakKasir |
| `NODE_ENV` | `production` | Untuk Vercel |

### 4. Verifikasi Deployment
- URL akan berupa: `https://yooskystore-backend.vercel.app`
- Test akses: https://your-vercel-url.vercel.app/login
- Cek database di JSONBin.io dashboard

## Tahap 5: Custom Domain (Optional)

### Jika punya domain sendiri:
1. Di Vercel Project Settings → Domains
2. Tambah domain custom
3. Update DNS records sesuai instruksi Vercel
4. Tunggu propagasi DNS (5-30 menit)

Contoh untuk domain `api.dexxmewastore.my.id`:
1. Login ke Hosting/DNS provider
2. Tambah CNAME record:
   - Name: `api`
   - Value: `cname.vercel.com` atau sesuai instruksi Vercel

## Troubleshooting

### ❌ Error: "JSONBin key not configured"
- ✅ Pastikan JSONBIN_API_KEY dan JSONBIN_BIN_ID di .env dan Vercel
- ✅ Reload Vercel deployment setelah set environment variables

### ❌ Error: "Cannot find module 'dotenv'"
```bash
npm install dotenv
```

### ❌ Database kosong di Vercel
- ✅ Pastikan JSONBin Bin sudah punya struktur data
- ✅ Check JSONBin API Key valid (test di https://jsonbin.io/api-keys)
- ✅ Cek logs di Vercel: Project → Deployments → Function Logs

### ❌ Payment QRIS tidak muncul
- ✅ Set PAKASIR_API_KEY dan PAKASIR_PROJECT di env
- ✅ Verifikasi akun PakKasir (https://pakasir.com)

### ❌ Upload file gambar error
- ✅ Vercel tidak support permanent file storage
- ✅ **Solusi**: Gunakan external storage:
  - Cloudinary (free tier cukup)
  - Imgur API
  - Firebase Storage
  - AWS S3

## Tahap 6: Frontend Integration

Update frontend (Vercel atau server lain) untuk pointing ke backend baru:

```javascript
// Ganti di semua API calls
const API_BASE = 'https://yooskystore-backend.vercel.app';
// atau
const API_BASE = 'https://api.dexxmewastore.my.id'; // custom domain
```

## Performance Tips

1. **Optimize JSONBin Calls**: Jangan read DB di setiap request
   - Gunakan in-memory cache (sudah diimplementasi di jsonbin.js)

2. **Reduce Function Cold Starts**:
   - Keep dependencies minimal
   - Vercel auto-scales untuk traffic spikes

3. **Monitor Database Size**:
   - JSONBin.io gratis sampai 300KB per bin
   - Backup transactions.json rutin

## Backup & Restore

### Backup Database
```bash
curl -H "X-Master-Key: YOUR_API_KEY" \
  https://api.jsonbin.io/v3/bins/YOUR_BIN_ID > backup.json
```

### Restore Database
```bash
curl -X PUT \
  -H "Content-Type: application/json" \
  -H "X-Master-Key: YOUR_API_KEY" \
  -d @backup.json \
  https://api.jsonbin.io/v3/bins/YOUR_BIN_ID
```

## Next Steps

1. ✅ Test seluruh aplikasi di Vercel
2. ✅ Backup data production di JSONBin.io
3. ✅ Update frontend API_BASE ke Vercel URL
4. ✅ Monitor logs dan database growth
5. ✅ Plan upgrade JSONBin jika size mendekati limit

---

**Pertanyaan?** Hubungi support atau cek docs:
- JSONBin: https://jsonbin.io/docs
- Vercel: https://vercel.com/docs
- Express.js: https://expressjs.com
