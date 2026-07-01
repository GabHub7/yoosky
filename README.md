# 🎮 YOOSKY STORE Backend - JSONBin.io + Vercel Deployment

Backend Node.js lengkap dengan admin panel untuk **YOOSKY STORE** - Layanan Game Mod Menu Premium.

**Status**: ✅ Production-ready dengan JSONBin.io database dan Vercel deployment

## 🚀 Fitur Lengkap

### Fitur Publik
- ✅ **Halaman Beranda** - Tampilan produk dengan filter kategori & carousel banner
- ✅ **Sistem Autentikasi** - Login & Register dengan bcryptjs password hashing
- ✅ **Pembelian Produk** - Pilih durasi, input data, pembayaran QRIS langsung
- ✅ **Payment Gateway** - Integrasi PakKasir untuk pembayaran QRIS
- ✅ **Cek Pesanan** - Tracking status transaksi dengan kode pesanan
- ✅ **Leaderboard** - Top buyers dengan profile photo display
- ✅ **Responsive Design** - Tema dark mode dengan aksen neon

### Admin Panel
- ✅ **Dashboard** - Statistik lengkap (produk, transaksi, revenue)
- ✅ **Manajemen Produk** - Tambah, edit, hapus, toggle status dengan platform tags
- ✅ **Manajemen Keys** - Input/manage keys per produk dengan stok otomatis
- ✅ **Manajemen Banner** - Upload carousel banner dengan toggle aktif/nonaktif
- ✅ **Manajemen Transaksi** - Lihat semua transaksi dengan detail lengkap
- ✅ **Pengaturan Situs** - Ubah nama, kontak, marquee text, dll
- ✅ **Pengaturan PakKasir** - Konfigurasi API Key dan Project
- ✅ **Ganti Password Admin** - Keamanan akun admin

### Keamanan
- 🔒 Password hashing dengan bcryptjs (salt rounds 10)
- 🔒 Session-based authentication (24 jam)
- 🔒 Route protection dengan middleware
- 🔒 File upload validation (gambar only, max 5MB)
- 🔒 Rate limiting untuk QR Code generation
- 🔒 HTTPS automatic di Vercel

## 📊 Database Architecture

**Choice 1**: JSONBin.io (Recommended untuk Vercel)
- Cloud-based JSON database
- Free tier: 300KB per bin
- Perfect untuk serverless deployment

**Choice 2**: Local JSON Files (Development)
- File-based database di `./database/`
- Ideal untuk testing lokal
- Fallback jika JSONBin.io down

### Hybrid Mode (Default)
```
Write Operation:
  1. Update in-memory cache (instant)
  2. Write to local database (instant)
  3. Async sync to JSONBin (non-blocking)

Read Operation:
  1. Read from in-memory cache (fast)
  2. On startup, pull from JSONBin (if configured)
```

## 🚀 Quick Start

### 1. Install & Setup

```bash
cd backend_fixed

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env dengan JSONBin keys
```

### 2. Pilih Mode Database

**Development (Local)**
```env
USE_LOCAL_DB=true
```

**Production (JSONBin.io)**
```env
USE_LOCAL_DB=false
JSONBIN_API_KEY=your_master_key
JSONBIN_BIN_ID=your_bin_id
```

### 3. Run Lokal

```bash
npm start
# Buka http://localhost:3000
```

## 🌐 Deploy ke Vercel

### Vercel CLI (Recommended)

```bash
npm i -g vercel
vercel login
vercel --prod
```

Saat deploy:
- Root directory: `./backend_fixed` (atau `.` jika di root)
- Build command: `npm install`
- Env variables: Copy dari .env (lihat tabel bawah)

### GitHub Integration (Easiest)

1. Push code ke GitHub
2. Kunjungi https://vercel.com/new
3. Import dari GitHub repo
4. Set environment variables
5. Deploy

## 🔧 Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `JSONBIN_API_KEY` | ✅ (prod) | - | Master Key dari https://jsonbin.io |
| `JSONBIN_BIN_ID` | ✅ (prod) | - | Bin ID dari JSONBin.io |
| `USE_LOCAL_DB` | ✅ | `false` | `true` untuk local, `false` untuk JSONBin |
| `NODE_ENV` | ✅ | `production` | production atau development |
| `SESSION_SECRET` | ✅ | - | Random string, ganti dengan string panjang |
| `PAKASIR_API_KEY` | ❌ | - | API Key dari pakasir.com |
| `PAKASIR_PROJECT` | ❌ | - | Project name dari pakasir.com |
| `PORT` | ❌ | `3000` | Auto-set by Vercel |
| `ADMIN_USERNAME` | ✅ | `admin` | Default admin username |
| `ADMIN_PASSWORD` | ✅ | `admin123` | Default admin password |

### Setup JSONBin.io

1. Kunjungi https://jsonbin.io
2. Sign up dengan email
3. Buat Bin baru (atau import existing)
4. Copy Master API Key dari Account Settings
5. Set di environment variables:
   ```
   JSONBIN_API_KEY=your_master_key_here
   JSONBIN_BIN_ID=your_bin_id_here
   ```

## 📁 Project Structure

```
backend_fixed/
├── server.js                      # Main Express app
├── jsonbin.js                     # Database adapter (JSONBin.io + fallback)
├── package.json                   # Dependencies
├── vercel.json                    # Vercel deployment config
├── .env.example                   # Environment template
├── .env.local                     # Local development config
├── README.md                      # Documentation (ini)
├── VERCEL_DEPLOYMENT.md           # Full deployment guide
├── setup.sh                       # Quick setup script
│
├── views/
│   ├── layout.ejs                 # Master layout
│   ├── error.ejs                  # Error page
│   └── pages/
│       ├── home.ejs               # Homepage dengan carousel banner
│       ├── login.ejs              # Login page
│       ├── register.ejs           # Register page
│       ├── buy.ejs                # Product detail & checkout
│       ├── invoice.ejs            # Order tracking
│       ├── leaderboard.ejs        # Top buyers ranking
│       ├── admin.ejs              # Admin dashboard
│       ├── admin-settings.ejs     # Site settings
│       ├── admin-products.ejs     # Product management
│       ├── admin-product-edit.ejs # Product editor
│       ├── admin-banners.ejs      # Banner management
│       └── admin-transactions.ejs # Transaction logs
│
├── public/
│   ├── css/                       # Stylesheets
│   ├── js/                        # Client-side scripts
│   ├── images/                    # Static images
│   └── uploads/                   # User uploads (local fallback)
│       ├── products/              # Product images
│       ├── avatars/               # User avatars
│       └── banners/               # Banner images
│
└── database/                      # Local JSON fallback
    ├── users.json
    ├── products.json
    ├── transactions.json
    ├── testimonials.json
    ├── notifications.json
    └── settings.json
```

## 🛠️ Tech Stack

| Component | Technology |
|----------|-----------|
| Runtime | Node.js |
| Framework | Express.js 4.18+ |
| Template Engine | EJS 3.1+ |
| Database | JSONBin.io + Local JSON fallback |
| Caching | In-memory (hybrid mode) |
| Payment Gateway | PakKasir API (QRIS) |
| File Upload | Multer |
| Password Hashing | bcryptjs |
| Session Management | express-session |
| CSS Framework | Tailwind CSS (CDN) |
| Icons | Iconify |
| Deployment | Vercel |

## 📦 Installation

### 1. Clone/Download Repository

```bash
git clone https://github.com/your-username/yooskystore.git
cd yooskystore/backend_fixed
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env dengan JSONBin credentials
```

### 4. Run Server

**Development (with auto-reload)**
```bash
npm run dev
```

**Production**
```bash
npm start
```

Server berjalan di: **http://localhost:3000**

## 🔑 Default Admin Credentials

```
Username: admin
Password: admin123
```

**⚠️ PENTING:** Ganti password segera setelah login pertama!

## ⚙️ Initial Setup

### 1. Login ke Admin Panel
- URL: `http://localhost:3000/admin`
- Username/Password: lihat di atas

### 2. Configure PakKasir (Payment)
- Tab **Settings** → **PakKasir**
- Isi API Key dan Project name dari pakasir.com
- Save

### 3. Setup Site Information
- Tab **Settings** → **Site**
- Edit nama situs, kontak, marquee text
- Save

### 4. Add Products
- Tab **Products** → **Add Product**
- Isi: nama, kategori, harga, durasi, gambar
- Add Keys dengan format: `KEY:DAYS` (contoh: `FF001:7`)
- Save

## 🔗 API Routes

### Authentication
- `POST /api/register` - Register user
- `POST /api/login` - Login user
- `GET /api/logout` - Logout
- `GET /api/me` - Get current user

### Products
- `GET /api/products` - List semua produk
- `GET /api/products/:id` - Detail produk
- `GET /api/products/:id/check-stock` - Cek stok
- `GET /api/categories` - List kategori

### Transactions
- `POST /api/checkout` - Buat order/checkout
- `GET /api/orders` - User orders history
- `GET /api/orders/:code` - Order detail by code

### Payment
- `POST /api/qris` - Generate QRIS untuk pembayaran
- `GET /api/payment-status/:orderId` - Cek status pembayaran

### Admin
- `GET /admin` - Dashboard
- `GET /admin/api/stats` - Dashboard statistics
- `GET /admin/products` - Product management
- `POST /admin/product/add` - Add product
- `POST /admin/product/:id` - Edit product
- `POST /admin/product/delete/:id` - Delete product
- `POST /admin/product/keys/:id` - Update keys
- `GET /admin/settings` - Settings page
- `POST /admin/settings/update` - Update settings

### Leaderboard
- `GET /api/leaderboard` - Top buyers ranking

### Banners
- `GET /api/banners` - List active banners
- `POST /admin/banners/add` - Add banner
- `POST /admin/banners/delete/:id` - Delete banner
- `POST /admin/banners/toggle/:id` - Toggle active status

## 🧪 Testing Checklist

Before production:

- [ ] User registration works
- [ ] Login/logout functions
- [ ] Product listing displays correctly
- [ ] QRIS payment modal appears
- [ ] Admin can add/edit/delete products
- [ ] Keys management functions
- [ ] Banner carousel auto-slides
- [ ] Leaderboard displays top buyers
- [ ] File uploads work
- [ ] Database syncs to JSONBin.io
- [ ] All routes return correct status codes

Test API endpoints:
```bash
# Test products
curl https://your-vercel-url.vercel.app/api/products

# Test leaderboard
curl https://your-vercel-url.vercel.app/api/leaderboard

# Test banners
curl https://your-vercel-url.vercel.app/api/banners
```

## 🌐 Deployment Checklist

- [ ] JSONBin.io account created
- [ ] Bin created with initial data
- [ ] Master API Key copied
- [ ] Vercel account setup
- [ ] Environment variables configured
- [ ] GitHub repository pushed
- [ ] Vercel deployment triggered
- [ ] Domain DNS configured (if using custom domain)
- [ ] HTTPS verified (automatic on Vercel)
- [ ] Database backup created
- [ ] Admin password changed
- [ ] PakKasir credentials configured

## 📚 Additional Documentation

Untuk setup lengkap dan troubleshooting, lihat:
- **VERCEL_DEPLOYMENT.md** - Complete deployment guide with step-by-step instructions
- **.env.example** - All available environment variables
- **jsonbin.js** - Database adapter documentation

## 🔒 Security Best Practices

1. **Change default admin password immediately**
2. **Use strong SESSION_SECRET** (minimum 32 characters)
3. **Enable HTTPS** (automatic on Vercel)
4. **Regularly backup database** from JSONBin.io
5. **Keep dependencies updated**: `npm audit fix`
6. **Validate all user input** on both frontend and backend
7. **Use environment variables** for sensitive data
8. **Monitor API logs** for suspicious activity

## 🐛 Troubleshooting

### Database Connection Error
```
❌ Error: Cannot sync to JSONBin
```
Solution:
- Verify JSONBIN_API_KEY is correct
- Check JSONBIN_BIN_ID valid
- Test at https://jsonbin.io/api-keys

### Payment QRIS Not Showing
```
❌ QRIS modal blank or doesn't appear
```
Solution:
- Check PAKASIR_API_KEY set in environment
- Verify PakKasir account is active
- Check browser console for errors

### File Upload Fails
```
❌ Error: File upload failed
```
Solution:
- Check file size < 5MB
- Ensure file is image format (.jpg, .png, .gif, .webp)
- Verify /public/uploads directory exists

### Cold Start Slow (Vercel)
```
⏱️ First request takes 5-10 seconds
```
Normal behavior:
- Vercel cold starts are expected
- Subsequent requests are fast (< 100ms)
- Upgrade to Vercel Pro if cold starts critical

## 📞 Support & Resources

- **Express.js Docs**: https://expressjs.com
- **JSONBin.io Docs**: https://jsonbin.io/docs
- **Vercel Docs**: https://vercel.com/docs
- **EJS Docs**: https://ejs.co
- **Multer Docs**: https://github.com/expressjs/multer

## 📄 License

MIT License - Feel free to use for commercial and private projects

## 👤 Author

YOOSKY STORE Team

---

**Last Updated**: June 3, 2026
**Version**: 1.0.0 (JSONBin.io + Vercel Ready)
- Input **API Key** dari dashboard pakasir.com
- Input **Project Name** sesuai project di PakKasir
- Pilih **Mode**: Production atau Sandbox
- Klik **Simpan**

### 3. Pengaturan Situs
- Masuk ke tab **Pengaturan**
- Ubah **Nama Situs**, **Marquee Text**, dll
- Input **Kontak WhatsApp** (format: 6281234567890)
- Input **Telegram** (username tanpa @)
- Klik **Simpan Pengaturan**

### 4. Tambah Produk
- Masuk ke tab **Produk**
- Klik **Tambah Produk**
- Isi form:
  - **Nama Produk**: Contoh "Drip Client Android"
  - **Kategori**: freefire, mlbb, pubgm, sertifikat
  - **Deskripsi**: Deskripsi produk
  - **Gambar**: Upload gambar produk
  - **Items**: Format JSON, contoh:
    ```json
    [
      {"l":"1 DAYS","p":15000},
      {"l":"3 DAYS","p":30000},
      {"l":"7 DAYS","p":60000}
    ]
    ```
- Klik **Tambah Produk**

### 5. Tambah Keys/Stok
- Di tabel produk, klik tombol **+ Key**
- Masukkan keys (satu per baris):
  ```
  KEY-FF-001
  KEY-FF-002
  KEY-FF-003
  ```
- Klik **Tambah Keys**

### 6. Ganti Password Admin
- Scroll ke bawah di tab **Pengaturan**
- Masukkan **Password Baru** (minimal 6 karakter)
- Klik **Ubah Password**

## 🎨 Tema & Styling

Tema mengikuti **code.txt** dengan karakteristik:
- **Dark Mode**: Background #0b0b1a
- **Aksen Neon**: Indigo (#6366f1) dan Purple (#8b5cf6)
- **Font**: Inter (body), Orbitron (brand)
- **Animasi**: Smooth transitions, fade-in effects
- **Responsive**: Mobile-first design

## 💳 Alur Pembayaran

1. User pilih produk → klik **BUY NOW**
2. Isi nama ID dan nomor WhatsApp
3. Pilih durasi (1 days, 3 days, 7 days, dll)
4. Klik **Lanjut ke Pembayaran**
5. Sistem generate QR Code QRIS via PakKasir
6. User scan QR Code dan bayar
7. Sistem auto-check status pembayaran setiap 3 detik
8. Jika lunas → key otomatis dikirim dan ditampilkan
9. Stok produk otomatis berkurang

## 📊 Database (JSON)

### users.json
```json
[
  {
    "id": "uuid",
    "username": "user123",
    "password": "hashed_password",
    "wa": "081234567890",
    "createdAt": "2025-05-31T10:00:00.000Z"
  }
]
```

### products.json
```json
[
  {
    "id": "uuid",
    "name": "Drip Client Android",
    "category": "freefire",
    "description": "Mod menu Free Fire...",
    "items": [
      {"l":"1 DAYS","p":15000},
      {"l":"7 DAYS","p":60000}
    ],
    "image": "/uploads/products/xxx.jpg",
    "status": "active",
    "keys": ["KEY-001", "KEY-002"],
    "sold": 10,
    "createdAt": "2025-05-31T10:00:00.000Z"
  }
]
```

### transactions.json
```json
[
  {
    "id": "uuid",
    "code": "HM-A1B2-C3D4",
    "userId": "uuid",
    "productId": "uuid",
    "productName": "Drip Client Android",
    "duration": "7 DAYS",
    "price": 60000,
    "customerName": "User123",
    "wa": "081234567890",
    "qrString": "qris_string",
    "status": "done",
    "key": "KEY-001",
    "createdAt": "2025-05-31T10:00:00.000Z",
    "time": "31/05/2025 10:00"
  }
]
```

### settings.json
```json
{
  "siteName": "YOOSKY STORE",
  "gamePanelName": "YOOSKY STORE",
  "about": "YOOSKY STORE menyediakan...",
  "marqueeText": "LAYANAN GAME MOD MENU PREMIUM",
  "contact": {
    "whatsapp": "6281235690535",
    "telegram": "HEROO3STORE",
    "email": "support@yooskystore.com"
  },
  "pakasir": {
    "apiKey": "your_api_key",
    "project": "your_project",
    "mode": "production"
  },
  "adminUsername": "admin",
  "adminPassword": "hashed_password",
  "categories": ["freefire", "mlbb", "pubgm", "sertifikat"],
  "categoryLabels": {
    "freefire": "FREE FIRE",
    "mlbb": "MOBILE LEGENDS",
    "pubgm": "PUBG MOBILE",
    "sertifikat": "SERTIFIKAT"
  }
}
```

## 🔌 API Endpoints

### Public Routes
- `GET /` - Halaman beranda
- `GET /login` - Halaman login
- `POST /login` - Proses login
- `GET /register` - Halaman register
- `POST /register` - Proses register
- `GET /logout` - Logout
- `GET /buy/:id` - Halaman pembelian produk
- `POST /create-order` - Buat pesanan baru
- `GET /check-payment/:refId` - Cek status pembayaran
- `GET /invoice` - Halaman cek pesanan
- `POST /invoice` - Cek pesanan dengan kode

### Admin Routes (Protected)
- `GET /admin` - Dashboard admin
- `POST /admin/product/add` - Tambah produk
- `POST /admin/product/edit/:id` - Edit produk
- `POST /admin/product/delete/:id` - Hapus produk
- `POST /admin/product/toggle/:id` - Toggle status produk
- `POST /admin/product/add-keys/:id` - Tambah keys
- `POST /admin/settings/update` - Update pengaturan
- `POST /admin/settings/pakasir` - Update PakKasir
- `POST /admin/settings/password` - Ganti password admin

### API Endpoints
- `GET /api/products` - List produk aktif
- `GET /api/transactions` - List transaksi (admin only)

## 🐛 Troubleshooting

### Port sudah digunakan
```bash
# Ganti port di server.js atau set environment variable
PORT=3001 node server.js
```

### PakKasir error
- Pastikan API Key dan Project Name sudah benar
- Cek mode (production/sandbox)
- Pastikan saldo PakKasir mencukupi

### Upload gambar gagal
- Pastikan folder `public/uploads/products` ada
- Cek ukuran file (max 5MB)
- Cek format file (hanya JPEG, PNG, GIF, WebP)

### Session hilang
- Cek cookie browser
- Pastikan `SESSION_SECRET` di server.js aman

## 📝 Catatan Penting

1. **Backup Database**: Backup folder `database/` secara berkala
2. **Keamanan**: Jangan expose API Key PakKasir di public
3. **HTTPS**: Gunakan HTTPS di production untuk keamanan
4. **Environment Variables**: Simpan kredensial di `.env` file
5. **Rate Limiting**: Sudah ada rate limiting untuk QR Code (30 req/menit)

## 🚀 Deploy ke Production

### Menggunakan PM2
```bash
npm install -g pm2
pm2 start server.js --name yooskystore
pm2 save
pm2 startup
```

### Menggunakan Nginx (Reverse Proxy)
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 📞 Support

Jika ada pertanyaan atau butuh bantuan:
- WhatsApp: +62 812 3569 0535
- Telegram: @HEROO3STORE

## 📄 License

MIT License - Bebas digunakan untuk project pribadi atau komersial.

---

**Dibuat dengan ❤️ untuk YOOSKY STORE**

© 2025 YOOSKY STORE. All rights reserved.
