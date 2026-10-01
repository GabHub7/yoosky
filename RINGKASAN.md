# 🎉 YOOSKY STORE - Backend & Admin Panel SELESAI!

## ✅ Yang Sudah Dibuat

### 1. Struktur Folder Lengkap
```
backend/
├── database/              # JSON database
├── public/
│   ├── css/
│   ├── js/
│   ├── images/
│   └── uploads/products/
├── views/
│   ├── layout.ejs
│   └── pages/
│       ├── home.ejs
│       ├── login.ejs
│       ├── register.ejs
│       ├── buy.ejs
│       ├── invoice.ejs
│       ├── admin.ejs
│       └── leaderboard.ejs
├── server.js
├── package.json
├── README.md
└── LEADERBOARD.md
```

### 2. Fitur Backend (server.js)
✅ **Autentikasi**
- Login & Register dengan bcrypt password hashing
- Session-based authentication (24 jam)
- Route protection middleware

✅ **Manajemen Produk**
- CRUD produk lengkap
- Upload gambar produk (Multer)
- Toggle status aktif/nonaktif
- Manajemen keys/stok per produk
- Multi-durasi pricing (1 day, 3 days, 7 days, custom)

✅ **Sistem Pembayaran**
- Integrasi PakKasir API (QRIS)
- Generate QR Code otomatis
- Auto-check payment status (polling setiap 3 detik)
- Auto-assign key setelah pembayaran lunas

✅ **Transaksi**
- Generate kode pesanan unik (HM-XXXX-XXXX)
- Tracking status transaksi
- Cek pesanan dengan kode
- Riwayat transaksi lengkap

✅ **Admin Panel**
- Dashboard dengan statistik
- Manajemen produk, transaksi, users
- Pengaturan situs (nama, kontak, marquee text)
- Pengaturan PakKasir (API Key, Project)
- Ganti password admin

✅ **Leaderboard** (BARU!)
- Top pembeli berdasarkan total transaksi
- Desain podium untuk top 3
- List untuk rank 4+
- API endpoint `/api/leaderboard`

### 3. Tema & Styling
✅ **Sesuai code.txt:**
- Dark mode (#0b0b1a background)
- Aksen neon (Indigo #6366f1 + Purple #8b5cf6)
- Font: Inter (body) + Orbitron (brand)
- Animasi smooth & fade-in effects
- Responsive mobile-first design
- Tailwind CSS (CDN)
- Iconify icons

### 4. Keamanan
✅ Password hashing (bcryptjs, salt rounds 10)
✅ Session authentication
✅ Route protection
✅ File upload validation (max 5MB, image only)
✅ Rate limiting untuk QR Code (30 req/menit)
✅ Input validation

---

## 🚀 Cara Menjalankan

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Jalankan Server
```bash
node server.js
```

Server berjalan di: **http://localhost:3000**

### 3. Login Admin
```
URL: http://localhost:3000/admin
Username: admin
Password: admin123
```

⚠️ **PENTING:** Ganti password admin setelah login pertama!

---

## ⚙️ Konfigurasi Wajib

### 1. Setup PakKasir
- Login admin → Tab **PakKasir**
- Input **API Key** dari pakasir.com
- Input **Project Name**
- Pilih **Mode** (Production/Sandbox)
- Klik **Simpan**

### 2. Pengaturan Situs
- Tab **Pengaturan**
- Ubah **Nama Situs**, **Marquee Text**
- Input **WhatsApp** (format: 6281234567890)
- Input **Telegram** (username tanpa @)
- Klik **Simpan**

### 3. Tambah Produk
- Tab **Produk** → **Tambah Produk**
- Isi form (nama, kategori, deskripsi, gambar)
- **Items** format JSON:
```json
[
  {"l":"1 DAYS","p":15000},
  {"l":"3 DAYS","p":30000},
  {"l":"7 DAYS","p":60000}
]
```

### 4. Tambah Keys/Stok
- Klik tombol **+ Key** di tabel produk
- Input keys (satu per baris)
- Klik **Tambah Keys**

---

## 📊 Fitur Leaderboard

### Akses:
- **Web:** http://localhost:3000/leaderboard
- **API:** http://localhost:3000/api/leaderboard

### Desain Podium:
- **Rank 1:** Center, gold gradient, crown icon 👑, pulse animation
- **Rank 2:** Left, silver gradient
- **Rank 3:** Right, bronze gradient
- **Rank 4+:** List dengan card design

### Data yang Ditampilkan:
- Rank
- Username
- Total Transaksi
- Total Belanja (Rp)
- Avatar (fallback: inisial nama)

### Logic:
- Hanya hitung transaksi dengan status `'done'`
- Sorting berdasarkan `totalTransactions` descending
- Auto-calculate dari `transactions.json`

---

## 📁 File Penting

| File | Deskripsi |
|------|-----------|
| `server.js` | Backend utama dengan semua logic |
| `package.json` | Dependencies Node.js |
| `README.md` | Dokumentasi lengkap |
| `LEADERBOARD.md` | Dokumentasi fitur leaderboard |
| `views/layout.ejs` | Layout utama (navbar, footer, toast) |
| `views/pages/home.ejs` | Halaman beranda dengan produk |
| `views/pages/admin.ejs` | Admin panel lengkap |
| `views/pages/leaderboard.ejs` | Halaman leaderboard dengan podium |
| `database/*.json` | Database JSON (auto-generated) |

---

## 🎨 Tema Sesuai code.txt

### ✅ Checklist Kesesuaian:
- [x] Dark mode background (#0b0b1a)
- [x] Aksen neon (Indigo + Purple)
- [x] Font Inter + Orbitron
- [x] Logo dengan glow animation
- [x] Marquee text berjalan
- [x] Navbar solid on scroll
- [x] Game cards dengan hover effect
- [x] Modal dengan backdrop blur
- [x] Toast notifications
- [x] Responsive design
- [x] Floating WhatsApp & Telegram buttons
- [x] Status badges (pending, done, cancelled)
- [x] Gradient buttons
- [x] Border glow effects

---

## 🔌 API Endpoints

### Public
- `GET /` - Beranda
- `GET /login` - Login page
- `POST /login` - Process login
- `GET /register` - Register page
- `POST /register` - Process register
- `GET /logout` - Logout
- `GET /buy/:id` - Halaman pembelian
- `POST /create-order` - Buat pesanan
- `GET /check-payment/:refId` - Cek status pembayaran
- `GET /invoice` - Cek pesanan
- `POST /invoice` - Cek dengan kode
- `GET /leaderboard` - Halaman leaderboard
- `GET /api/leaderboard` - API leaderboard (JSON)

### Admin (Protected)
- `GET /admin` - Dashboard admin
- `POST /admin/product/add` - Tambah produk
- `POST /admin/product/edit/:id` - Edit produk
- `POST /admin/product/delete/:id` - Hapus produk
- `POST /admin/product/toggle/:id` - Toggle status
- `POST /admin/product/add-keys/:id` - Tambah keys
- `POST /admin/settings/update` - Update pengaturan
- `POST /admin/settings/pakasir` - Update PakKasir
- `POST /admin/settings/password` - Ganti password

---

## 💾 Database JSON

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
    "description": "Mod menu...",
    "items": [{"l":"1 DAYS","p":15000}],
    "image": "/uploads/products/xxx.jpg",
    "status": "active",
    "keys": ["KEY-001"],
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
    "apiKey": "",
    "project": "",
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

---

## 🐛 Troubleshooting

### Port sudah digunakan
```bash
PORT=3001 node server.js
```

### PakKasir error
- Cek API Key & Project Name
- Pastikan mode sudah benar (production/sandbox)
- Cek saldo PakKasir

### Upload gambar gagal
- Pastikan folder `public/uploads/products` ada
- Max 5MB, format: JPEG, PNG, GIF, WebP

### Leaderboard kosong
- Pastikan ada transaksi dengan status `'done'`
- Pastikan transaksi memiliki `userId` yang valid

---

## 📞 Support

- WhatsApp: +62 812 3569 0535
- Telegram: @HEROO3STORE

---

## 🎯 Next Steps (Optional)

1. **Deploy ke Production**
   - Gunakan PM2 untuk process manager
   - Setup Nginx sebagai reverse proxy
   - Gunakan HTTPS (SSL certificate)

2. **Environment Variables**
   - Buat file `.env` untuk kredensial
   - Install `dotenv` package

3. **Database Migration**
   - Jika traffic tinggi, migrate ke MongoDB/PostgreSQL
   - Gunakan ORM (Mongoose/Sequelize)

4. **Additional Features**
   - Avatar upload untuk user
   - Voucher/discount system
   - Email notifications
   - WhatsApp notifications via API
   - Real-time updates dengan Socket.IO

---

**🎉 SELAMAT! Backend & Admin Panel YOOSKY STORE sudah siap digunakan!**

Semua fitur sudah lengkap sesuai spesifikasi:
✅ Backend Node.js dengan Express
✅ Admin panel lengkap
✅ Payment gateway PakKasir (QRIS)
✅ JSON storage
✅ Tema sesuai code.txt (dark mode + neon)
✅ Login/Register dengan validasi password
✅ Leaderboard dengan podium design

**Running command:**
```bash
cd backend
npm install
node server.js
```

**Admin access:**
```
http://localhost:3000/admin
Username: admin
Password: admin123
```

---

**Dibuat dengan ❤️ untuk YOOSKY STORE**

© 2025 YOOSKY STORE. All rights reserved.
