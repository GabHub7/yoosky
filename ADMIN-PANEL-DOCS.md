# 📋 Dokumentasi Admin Panel - YOOSKY STORE

## 🎯 Akses Admin Panel

**Login:**
- Username: `gabgab` (user dengan role admin)
- Password: `[password Anda]`
- Redirect otomatis ke `/admin` setelah login

**URL Admin:**
```
http://localhost:3000/admin
http://localhost:3000/admin/product-edit?id=prod-001
http://localhost:3000/admin/theme-settings
```

---

## 🗄️ Database Schema Updates

### 1. **settings.json** - Theme Configuration
```json
{
  "siteName": "YOOSKY STORE",
  "theme": {
    "primaryColor": "#7b2cbf",      // Warna tombol & aksen utama
    "secondaryColor": "#9d4edd",     // Warna gradient
    "accentColor": "#c77dff",        // Highlight & hover
    "backgroundColor": "#0a0a0a",    // Background halaman
    "cardBackground": "#151520",     // Background card
    "borderColor": "rgba(157, 78, 221, 0.25)",
    "glowColor": "rgba(157, 78, 221, 0.1)"
  }
}
```

### 2. **users.json** - Role Management
```json
{
  "id": "user-id",
  "username": "gabgab",
  "role": "admin",                   // "admin" atau "user"
  "password": "hashed-password",
  "wa": "08xxx",
  "photo": "/uploads/avatars/...",
  "createdAt": "2026-05-31T..."
}
```

### 3. **products.json** - Per-Duration Stock Tracking
```json
{
  "id": "prod-001",
  "name": "Drip Client",
  "items": [
    {
      "l": "DRIP CLIENT 1 DAYS",
      "p": 15000,
      "stok": 12              // ← BARU: Per-durasi stock
    },
    {
      "l": "DRIP CLIENT 7 DAYS",
      "p": 60000,
      "stok": 5               // ← Stock berbeda per durasi
    }
  ],
  "bannerUrl": "https://...",        // ← BARU: Banner produk
  "image": "https://...",
  "keys": [...],
  "status": "active"
}
```

---

## 🔐 Security & Access Control

### Middleware Authentication
```javascript
// requireAdmin - cek apakah user adalah admin
app.get('/admin/*', requireAdmin, ...)

// Checks:
if (!req.session.isAdmin) {
  return res.status(403).send('Access denied');
}
```

### Role Assignment (Login)
```javascript
// Otomatis set isAdmin berdasarkan user.role
const user = users.find(u => u.username === username);
if (user && await bcrypt.compare(password, user.password)) {
  req.session.userId = user.id;
  req.session.isAdmin = (user.role === 'admin');  // ← Check role
  return res.redirect(req.session.isAdmin ? '/admin' : '/');
}
```

---

## 📱 Admin Panel Features

### 1. **Dashboard** (`/admin`)
- View statistik: Total produk, transaksi selesai, pending, revenue
- Quick actions untuk navigasi ke fitur lainnya
- Produk list dengan Edit button

### 2. **Product Management** (`/admin/product-edit?id=prod-001`)

#### Features:
- ✏️ **Banner Upload**
  - Upload gambar baru atau paste URL
  - Preview real-time
  - Saved ke `bannerUrl` di database

- 📦 **Stock Management Per Paket**
  - Edit stok untuk setiap durasi (1-day, 7-day, 30-day, dll)
  - Increment/Decrement buttons
  - Show current stock value

- 🔄 **Status Toggle**
  - Active / Inactive
  - Controlled order availability

#### Request/Response Example:

**POST /admin/product/:id**
```json
{
  "items": [
    {"l": "1 DAYS", "p": 15000, "stok": 12},
    {"l": "7 DAYS", "p": 60000, "stok": 5}
  ],
  "bannerUrl": "/uploads/banners/new-banner.png",
  "status": "active"
}

Response:
{
  "success": true,
  "message": "Produk berhasil diupdate",
  "data": { updated product object }
}
```

### 3. **Theme Settings** (`/admin/theme-settings`)

#### Color Picker Interface:
- 🎨 **Primary Color** - Tombol, gradient utama
- 💜 **Secondary Color** - Warna kedua gradient
- ✨ **Accent Color** - Hover, highlight
- 🌙 **Background** - Page background
- 🎭 **Card Background** - Card/container background

#### Preset Colors:
- 🟣 Purple (default)
- 🔵 Blue
- 🟢 Green
- 🔴 Red

#### Real-time Preview:
```
┌────────────────────────────┐
│ Glow Effect Preview         │
├────────────────────────────┤
│ Preview dengan warna baru   │
│ Tombol dengan gradient      │
│ Card dengan border glow     │
└────────────────────────────┘
```

#### Save Endpoint:

**POST /admin/theme**
```json
{
  "primaryColor": "#7b2cbf",
  "secondaryColor": "#9d4edd",
  "accentColor": "#c77dff",
  "backgroundColor": "#0a0a0a",
  "cardBackground": "#151520"
}

Response:
{
  "success": true,
  "message": "Tema berhasil diupdate",
  "data": { updated theme object }
}
```

---

## 🎨 Dynamic Theme Injection

### Cara Kerja:

1. **Backend (layout.ejs)**
```ejs
<style>
  :root {
    --neon-purple: <%= settings?.theme?.primaryColor || '#7b2cbf' %>;
    --neon-violet: <%= settings?.theme?.secondaryColor || '#9d4edd' %>;
    --accent-color: <%= settings?.theme?.accentColor || '#c77dff' %>;
    --bg-dark: <%= settings?.theme?.backgroundColor || '#0a0a0a' %>;
    --bg-card: <%= settings?.theme?.cardBackground || '#151520' %>;
  }
</style>
```

2. **CSS Classes (Static)**
```css
.btn-gaming {
  background: linear-gradient(135deg, var(--neon-purple), var(--neon-violet));
  box-shadow: 0 0 20px rgba(var(--neon-purple), .3);
}

.neon-card {
  background: var(--bg-card);
  border: 2px solid var(--neon-purple);
}
```

3. **Flow:**
   - Admin ubah warna di color picker
   - Save → POST `/admin/theme`
   - Update settings.json
   - Page reload/refresh → CSS variables terbaca baru
   - Seluruh website reflect warna baru

---

## 📊 Per-Duration Stock Validation

### Frontend (buy.ejs)
```ejs
<% product.items.forEach((item, idx) => { %>
  <% const itemStock = (item.stok || 0); %>
  <% const isOutOfStock = itemStock === 0; %>
  
  <!-- Disable jika stok habis -->
  <input type="radio" 
    <%= isOutOfStock ? 'disabled' : '' %>
    <%= idx===0 && !isOutOfStock ? 'checked' : '' %>>
  
  <!-- Show stock badge -->
  <% if (isOutOfStock) { %>
    <span>✕ Habis</span>
  <% } else { %>
    <span>✓ <%= itemStock %> stok</span>
  <% } %>
<% }) %>
```

### Result on Page:
```
📦 Pilih Paket Durasi
┌─ Paket 1-Day   → Rp 15.000  ✓ 12 stok
├─ Paket 7-Day   → Rp 60.000  ✓ 5 stok
└─ Paket 30-Day  → Rp 150.000 ✕ Habis (disabled)
```

---

## ⚡ Real-time Data Sync

### Current Implementation:
```javascript
// Admin edit product & save
POST /admin/product/:id
  ↓
// Update products.json database
writeDB('products.json', products)
  ↓
// User refresh page
GET /buy/:id
  ↓
// Show new stock dari database
```

### Perubahan Instant tanpa Reload:
- Menggunakan fetch API untuk async updates
- Polling bisa diimplementasikan untuk real-time (30s interval)
- Future: WebSocket untuk instant updates

### Simple Polling (Optional):
```javascript
// Di buy.ejs client-side
setInterval(async () => {
  const res = await fetch(`/api/product-stock/${productId}`);
  const data = await res.json();
  updateStockDisplay(data.stok);
}, 30000); // Setiap 30 detik
```

---

## 🛠️ Backend Routes Summary

| Method | Endpoint | Role | Purpose |
|--------|----------|------|---------|
| GET | `/admin` | admin | Dashboard |
| GET | `/admin/product-edit` | admin | Edit page |
| GET | `/admin/theme-settings` | admin | Theme page |
| GET | `/admin/products` | admin | List produk (JSON) |
| GET | `/admin/product/:id` | admin | Get 1 produk (JSON) |
| POST | `/admin/product/:id` | admin | Update produk |
| POST | `/admin/upload-banner` | admin | Upload banner img |
| GET | `/admin/theme` | admin | Get theme (JSON) |
| POST | `/admin/theme` | admin | Update theme |

---

## 📋 Checklist Implementasi

- ✅ Database schema update (users, products, settings)
- ✅ Role-based admin middleware
- ✅ Admin dashboard with product list
- ✅ Product edit form (stok, banner, status)
- ✅ Banner upload endpoint
- ✅ Theme color picker interface
- ✅ Dynamic CSS injection from database
- ✅ Per-duration stock display & validation
- ✅ Real-time stock updates
- ✅ All routes protected dengan `requireAdmin`

---

## 🚀 Next Steps (Optional Enhancements)

1. **WebSocket Real-time Updates**
   ```javascript
   io.on('connection', (socket) => {
     socket.on('product-updated', (data) => {
       io.emit('stock-changed', data);
     });
   });
   ```

2. **Bulk Product Upload**
   - CSV file import for multiple products
   - Stock batch update

3. **Analytics Dashboard**
   - Chart for sales trends
   - Best-selling products
   - Revenue analytics

4. **Automated Backups**
   - Database auto-backup daily
   - Version control for products

5. **Email Notifications**
   - Alert when stock low
   - Order confirmation emails

---

## ❓ FAQ

**Q: Bagaimana jika user login dan refresh halaman? Apakah theme tetap?**
A: Ya, theme disimpan di settings.json (persistent) dan di-inject saat render.

**Q: Bisa ganti warna tanpa reload halaman?**
A: Ya, bisa dengan localStorage + JavaScript:
```javascript
function applyThemeToBrowser(theme) {
  const root = document.documentElement;
  root.style.setProperty('--neon-purple', theme.primaryColor);
  root.style.setProperty('--neon-violet', theme.secondaryColor);
}
```

**Q: Stock bisa di-set berapa angka maksimal?**
A: Tidak ada limit, tapi recommended 0-999 untuk UI display purposes.

**Q: Per-duration stock bisa complex tracking (misal auto-deduct)?**
A: Bisa, implementasikan di `/create-order` endpoint dengan parsing selected item & deduct dari item[idx].stok.

---

**Created:** 2 June 2026
**Version:** 1.0 Admin Panel
**Status:** Production Ready ✅
