# 📦 Product Detail Modal - YOOSKY STORE

Halaman detail produk dengan modal interaktif yang menampilkan informasi lengkap produk, paket harga, form pemesanan, dan ulasan pembeli.

## ✨ Fitur

### 1. **Product Grid**
- Menampilkan daftar produk dari JSON
- Card produk dengan nama, game, platform, rating, dan harga mulai dari
- Hover effect untuk UX yang lebih baik
- Responsive grid layout

### 2. **Modal Detail Produk**
Ketika produk diklik, modal menampilkan:

#### Informasi Produk
- Nama produk, game, dan platform
- Rating dengan bintang (⭐) dan jumlah ulasan
- Deskripsi lengkap
- Daftar fitur (tags)

#### Paket Harga
- Pilihan durasi (1, 3, 7, 15, 30 hari)
- Harga per paket
- Stok tersedia (dengan warning jika stok < 5)
- Radio button untuk memilih paket
- Visual feedback saat paket dipilih

#### Form Pemesanan
- **Nama Lengkap** (required)
- **Nomor WhatsApp** (required, dengan validasi format)
  - Format: `08xxxxxxxxxx` atau `+628xxxxxxxxxx`
  - Validasi 10-15 digit
- **Metode Pembayaran** (dropdown, required)
- **Kode Promo** (optional)
  - Tombol "Apply" untuk validasi promo
  - Promo valid: `DISKON10`, `HEMAT20`, `PROMO50`

#### Ulasan Pembeli
- Menampilkan 3 ulasan terakhir
- Tombol "Lihat semua ulasan" untuk toggle semua review
- Format: Order ID, tanggal, dan teks ulasan

#### Kompatibilitas
- Info kompatibilitas device

### 3. **Validasi & Error Handling**
- Validasi paket harus dipilih
- Validasi form wajib diisi
- Validasi format WhatsApp
- Error message yang jelas

### 4. **Submit Order**
- Data order disimpan ke `localStorage`
- Log ke console untuk debugging
- Alert konfirmasi pesanan
- Modal otomatis tertutup setelah submit

## 📁 Struktur File

```
backend/public/
├── product-detail.html      # Halaman utama
├── product-detail.css       # Styling
├── product-detail.js        # Logic & interaksi
└── products-detail.json     # Data produk
```

## 🚀 Cara Menggunakan

### 1. Akses Halaman
```
http://localhost:3000/product-detail.html
```

### 2. Klik Produk
- Klik salah satu card produk
- Modal detail akan muncul

### 3. Pilih Paket
- Klik salah satu paket yang tersedia
- Paket terpilih akan highlight

### 4. Isi Form
- Isi nama lengkap
- Isi nomor WhatsApp (format: 08xxx atau +628xxx)
- Pilih metode pembayaran
- (Optional) Masukkan kode promo

### 5. Submit Order
- Klik tombol "ORDER SEKARANG"
- Sistem akan validasi semua input
- Jika valid, data disimpan dan muncul konfirmasi

## 🎨 Kustomisasi

### Mengubah Warna
Edit `product-detail.css`:
```css
/* Primary color */
.order-button {
    background: #2563eb; /* Ganti dengan warna Anda */
}

/* Accent color */
.feature-tag {
    background: #e0e7ff; /* Background tag */
    color: #3730a3;      /* Text color */
}
```

### Menambah Produk
Edit `products-detail.json`:
```json
{
  "products": [
    {
      "id": "product_id",
      "name": "NAMA PRODUK",
      "game": "Nama Game",
      "platform": "Platform",
      "description": "Deskripsi produk...",
      "features": ["Fitur 1", "Fitur 2"],
      "packages": [
        { "days": 1, "price": 15000, "stock": 10 }
      ],
      "rating": 4.9,
      "total_reviews": 10,
      "reviews": [...],
      "compatible": "Info kompatibilitas",
      "payment_methods": ["QRIS"],
      "whatsapp_required": true
    }
  ]
}
```

### Mengubah Kode Promo
Edit `product-detail.js` di fungsi `applyPromo()`:
```javascript
const validPromos = {
    'DISKON10': 10,   // 10% discount
    'HEMAT20': 20,    // 20% discount
    'PROMO50': 50     // 50% discount
};
```

## 🔧 Integrasi dengan Backend

Untuk integrasi dengan backend yang sudah ada:

### 1. Ganti Fetch URL
```javascript
// Di product-detail.js
async function loadProducts() {
    const response = await fetch('/api/products'); // Ganti dengan API endpoint Anda
    const data = await response.json();
    productsData = data.products;
    renderProductGrid();
}
```

### 2. Submit ke Backend
```javascript
// Di fungsi submitOrder()
async function submitOrder() {
    // ... validasi ...

    const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
    });

    const result = await response.json();
    
    if (result.success) {
        alert('Pesanan berhasil!');
        // Redirect ke halaman pembayaran
        window.location.href = `/payment/${result.orderId}`;
    }
}
```

## 📱 Responsive Design

- **Desktop**: Grid 3-4 kolom
- **Tablet**: Grid 2 kolom
- **Mobile**: Grid 1 kolom, modal full width

## 🎯 Fitur Tambahan (Optional)

### 1. Integrasi WhatsApp
```javascript
function submitOrder() {
    // ... setelah validasi ...
    
    const waMessage = `Halo, saya ingin order:
Produk: ${selectedProduct.name}
Paket: ${selectedPackage.days} Hari
Harga: Rp ${selectedPackage.price.toLocaleString('id-ID')}
Nama: ${fullName}`;

    const waUrl = `https://wa.me/6281234567890?text=${encodeURIComponent(waMessage)}`;
    window.open(waUrl, '_blank');
}
```

### 2. Countdown Timer Stok
```javascript
// Tambahkan timer untuk stok terbatas
if (pkg.stock < 5) {
    return `<span class="stock-warning">⚠️ Stok terbatas! Hanya ${pkg.stock} tersisa</span>`;
}
```

### 3. Image Gallery
```javascript
// Tambahkan field images di JSON
"images": [
    "image1.jpg",
    "image2.jpg",
    "image3.jpg"
]

// Render image slider di modal
```

## 🐛 Troubleshooting

### Modal tidak muncul
- Cek console browser untuk error
- Pastikan `products-detail.json` bisa diakses
- Cek path file CSS dan JS sudah benar

### Data tidak muncul
- Cek format JSON valid
- Cek network tab di browser DevTools
- Pastikan server berjalan

### Validasi WhatsApp gagal
- Format: `08xxxxxxxxxx` (10-13 digit)
- Atau: `+628xxxxxxxxxx` (13-16 digit)
- Hapus spasi dan tanda hubung

## 📝 Catatan

- Semua data produk dari JSON (tidak ada hardcode)
- Validasi form di client-side (tambahkan server-side untuk production)
- LocalStorage untuk simulasi (ganti dengan API call untuk production)
- Kode promo hardcoded (ganti dengan API validation)

## 🎉 Demo

1. Buka `http://localhost:3000/product-detail.html`
2. Klik produk "DRIP CLIENT"
3. Pilih paket "7 Hari"
4. Isi form:
   - Nama: John Doe
   - WA: 081234567890
   - Metode: QRIS
   - Promo: DISKON10
5. Klik "ORDER SEKARANG"
6. Cek console dan localStorage untuk data order

---

**Dibuat dengan ❤️ untuk YOOSKY STORE**

© 2025 YOOSKY STORE. All rights reserved.
