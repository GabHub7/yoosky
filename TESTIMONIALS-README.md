# 💬 Sistem Testimoni & Review - YOOSKY STORE

Sistem testimoni lengkap yang terintegrasi dengan admin panel untuk mengelola ulasan dan rating pembeli.

## ✨ Fitur Lengkap

### 1. **Tampilan di Halaman Home**
- Section testimoni di bawah produk
- Menampilkan 6 testimoni featured
- Card design dengan:
  - Avatar (inisial nama)
  - Nama pembeli
  - Badge "Verified" untuk testimoni terverifikasi
  - Rating bintang (1-5)
  - Teks testimoni
  - Nama produk (jika ada)
  - Tanggal testimoni
- Responsive grid (1 kolom mobile, 2 tablet, 3 desktop)
- Auto-load via JavaScript (fetch API)

### 2. **Admin Panel - Manajemen Testimoni**
- Tab "Testimoni" di sidebar admin
- Tabel testimoni dengan kolom:
  - Nama pembeli
  - Rating (bintang)
  - Testimoni (preview 50 karakter)
  - Produk terkait
  - Tanggal
  - Status (Verified, Featured)
  - Aksi (Toggle Featured, Hapus)

### 3. **Tambah Testimoni (Admin)**
- Form modal dengan field:
  - **Nama** (required)
  - **Username** (optional)
  - **Rating** (1-5 bintang, dropdown)
  - **Testimoni** (textarea, required)
  - **Produk** (optional, untuk review spesifik produk)
  - **Verified** (checkbox, default checked)
  - **Featured** (checkbox, tampil di home jika dicentang)
- Validasi form
- Submit via AJAX

### 4. **Fitur Admin**
- **Toggle Featured**: Ubah status featured on/off
- **Hapus Testimoni**: Hapus testimoni dengan konfirmasi
- **Auto-reload**: Tabel auto-refresh setelah aksi
- **Filter**: API support filter by featured & product

## 📁 File yang Dibuat

```
backend/
├── database/
│   └── testimonials.json          # Database testimoni (10 fake data)
├── views/pages/
│   ├── home.ejs                   # Updated: tambah section testimoni
│   └── admin.ejs                  # Updated: tambah tab testimoni
└── server.js                      # Updated: tambah API endpoints
```

## 🔌 API Endpoints

### **GET /api/testimonials**
Ambil semua testimoni dengan filter optional

**Query Parameters:**
- `featured=true` - Hanya testimoni featured
- `product=ProductName` - Filter by produk

**Response:**
```json
[
  {
    "id": "testi-001",
    "name": "Budi Santoso",
    "username": "budisantoso",
    "rating": 5,
    "text": "Pelayanan cepat dan produk berkualitas!",
    "product": "Drip Client",
    "date": "2025-05-28T10:00:00.000Z",
    "verified": true,
    "featured": true
  }
]
```

### **POST /admin/testimonial/add**
Tambah testimoni baru (Admin only)

**Body:**
```json
{
  "name": "Nama Pembeli",
  "username": "username",
  "rating": 5,
  "text": "Testimoni...",
  "product": "Nama Produk",
  "verified": true,
  "featured": true
}
```

### **POST /admin/testimonial/delete/:id**
Hapus testimoni (Admin only)

### **POST /admin/testimonial/toggle-featured/:id**
Toggle status featured (Admin only)

## 💾 Database Structure (testimonials.json)

```json
[
  {
    "id": "testi-001",
    "name": "Budi Santoso",
    "username": "budisantoso",
    "rating": 5,
    "text": "Pelayanan cepat dan produk berkualitas! Admin responsif banget.",
    "product": "Drip Client",
    "date": "2025-05-28T10:00:00.000Z",
    "verified": true,
    "featured": true
  }
]
```

**Field Explanation:**
- `id`: Unique ID (auto-generated: `testi-{timestamp}`)
- `name`: Nama pembeli (required)
- `username`: Username pembeli (optional)
- `rating`: Rating 1-5 (required)
- `text`: Isi testimoni (required)
- `product`: Nama produk (optional, null = testimoni umum)
- `date`: ISO timestamp (auto-generated)
- `verified`: Boolean, tampilkan badge verified
- `featured`: Boolean, tampil di home jika true

## 🎨 Styling

### Card Testimoni
```css
- Background: #12122a (dark card)
- Border: rgba(255,255,255,0.05)
- Hover: border-indigo-500/30
- Avatar: Gradient indigo-purple
- Rating: Yellow stars (⭐)
- Verified badge: Emerald green
```

### Admin Table
```css
- Status badge verified: Green
- Status badge featured: Yellow
- Toggle button: Primary blue
- Delete button: Red
```

## 🚀 Cara Menggunakan

### 1. **Akses Admin Panel**
```
http://localhost:3000/admin
Username: admin
Password: admin123
```

### 2. **Tambah Testimoni**
- Klik tab "Testimoni"
- Klik tombol "Tambah Testimoni"
- Isi form:
  - Nama: John Doe
  - Rating: 5 bintang
  - Testimoni: "Produk bagus, pelayanan cepat!"
  - Produk: Drip Client (optional)
  - ✓ Verified
  - ✓ Featured (jika ingin tampil di home)
- Klik "Tambah Testimoni"

### 3. **Toggle Featured**
- Klik tombol "Toggle" di kolom Aksi
- Status featured akan berubah
- Testimoni featured otomatis muncul di home

### 4. **Hapus Testimoni**
- Klik tombol "Hapus"
- Konfirmasi hapus
- Testimoni terhapus dari database

## 📱 Responsive Design

- **Desktop (lg)**: 3 kolom grid
- **Tablet (md)**: 2 kolom grid
- **Mobile**: 1 kolom grid
- Card height auto-adjust
- Text truncate untuk testimoni panjang

## 🔧 Kustomisasi

### Ubah Jumlah Testimoni di Home
Edit `home.ejs` line JavaScript:
```javascript
container.innerHTML = testimonials.slice(0, 6).map(t => {
// Ganti 6 dengan jumlah yang diinginkan
```

### Ubah Warna Card
Edit inline style di `home.ejs`:
```javascript
<div class="bg-[#12122a] ...">
// Ganti #12122a dengan warna Anda
```

### Filter Testimoni by Rating
Tambahkan filter di API:
```javascript
app.get('/api/testimonials', (req, res) => {
  let filtered = testimonials;
  
  const minRating = req.query.minRating;
  if (minRating) {
    filtered = filtered.filter(t => t.rating >= parseInt(minRating));
  }
  
  res.json(filtered);
});
```

## 🎯 Fake Data

Database sudah terisi dengan **10 testimoni fake**:
- 7 testimoni featured (tampil di home)
- 3 testimoni non-featured
- Rating 4-5 bintang
- Mix testimoni umum & per produk
- Semua verified

**Produk yang ada testimoni:**
- Drip Client (2 testimoni)
- HG Free Fire (1)
- Attic Premium (2)
- Xmod MLBB (1)
- Fluorite FF iOS (1)
- Morella ML (1)
- Sertifikat Gbox (1)
- Testimoni umum (1)

## ✅ Checklist Fitur

- ✅ Database testimonials.json
- ✅ API endpoints (GET, POST, DELETE, TOGGLE)
- ✅ Section testimoni di home
- ✅ Auto-load via JavaScript
- ✅ Admin panel tab testimoni
- ✅ Form tambah testimoni
- ✅ Toggle featured
- ✅ Hapus testimoni
- ✅ Rating bintang (1-5)
- ✅ Verified badge
- ✅ Featured badge
- ✅ Filter by featured
- ✅ Filter by product
- ✅ Responsive design
- ✅ 10 fake data

## 🐛 Troubleshooting

### Testimoni tidak muncul di home
- Cek console browser untuk error
- Pastikan ada testimoni dengan `featured: true`
- Cek API `/api/testimonials?featured=true` di browser

### Admin panel tidak load testimoni
- Klik tab "Testimoni" untuk trigger load
- Cek console untuk error
- Pastikan file `testimonials.json` ada

### Toggle featured tidak bekerja
- Pastikan login sebagai admin
- Cek network tab di DevTools
- Pastikan endpoint `/admin/testimonial/toggle-featured/:id` accessible

## 🎉 Next Features (Optional)

1. **User Submit Testimoni**
   - Form di halaman user
   - Submit testimoni setelah transaksi selesai
   - Admin approve/reject

2. **Reply Testimoni**
   - Admin bisa reply testimoni
   - Tampilkan reply di bawah testimoni

3. **Image Upload**
   - User upload foto produk
   - Tampilkan di card testimoni

4. **Sort & Filter**
   - Sort by rating, date
   - Filter by rating range
   - Search by nama/produk

5. **Pagination**
   - Load more button
   - Infinite scroll

---

**Dibuat dengan ❤️ untuk YOOSKY STORE**

© 2025 YOOSKY STORE. All rights reserved.
