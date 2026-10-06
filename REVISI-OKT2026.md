# Revisi Oktober 2026

## 1. Pakasir API v2 (v1 mati 20 Okt 2026)
- `POST /api/v2/create-transaction/{slug}/{order_id}` (header `X-Api-Key`), `GET /api/v2/transaction-status/{slug}/{txn_id}`.
- Admin → Setting → PakKasir: isi **API key**, **Slug project**, **Webhook secret**. Field "API Base URL" dihapus.
- Webhook baru: `POST /api/webhooks/pakasir` (alias `/pakasir-webhook`). Isi URL itu di dashboard project Pakasir.
  Header `X-Secret` dicek, lalu status DIVERIFIKASI ulang ke API Pakasir + nominal harus cocok sebelum key dikirim.
- Polling `/check-payment` tetap jalan (maks 1x/4 dtk per transaksi, sesuai rate limit v2).
- Transaksi pending buatan v1 (belum punya `txn_id`) otomatis di-resolve lewat endpoint create v2 (find-or-create).
- Batas nominal QRIS v2: Rp500 – Rp10.000.000. Transaksi sandbox ditolak kecuali Mode = Sandbox.

## 2. Restock key via YouduStore API (`api-1.json`)
- Tab baru **Restock** di Admin. Isi User API Token + Global Access Key, klik Cek Saldo.
- Petakan tiap paket produk → `code` produk supplier (daftar produk dimuat dari `GET /api/v2/product`).
- Klik **Restock key** (maks 10 per klik): server memanggil `POST /api/v2/order` per key, lalu `serial_number`
  yang sukses otomatis masuk stok paket itu (`KEY:7` = 7 hari, `KEY:12h` = 12 jam).
- Status diperbarui lewat callback supplier (`/api/youdu/callback/<secret>`, URL tampil di panel) dan tombol **Cek Status**.
  Isi callback tidak dipercaya; selalu dicek ulang via `POST /api/v2/check-status`.
- Mode sandbox: header `X-ENVIRONMENT: sandbox`, key sandbox tidak dimasukkan ke stok.
- Asumsi: `serial_number` dari supplier = key yang dijual. Kalau format key supplier beda, ubah di `refreshRestock()` (server.js).

## 3. Paket per JAM (bukan cuma hari)
- Form harga produk: tiap paket punya durasi + satuan **Hari / Jam**.
- Label otomatis `NAMA 12 HOURS`; tag key `KEY:12h` (jam) vs `KEY:7` / `KEY:7d` (hari).
- Stok, harga reseller, voucher, invoice, dan pengiriman key semuanya mengikuti satuan.
- Perubahan perilaku: key tidak lagi diambil "sembarang" saat stok paket kosong (bisa menjual key 30 hari untuk paket 1 jam).
  Kalau stok paket habis setelah dibayar, pesanan ditandai `outOfStock` + notif WA admin seperti sebelumnya.

## Deploy
1. Jalankan ulang `supabase-schema.sql` (aman, `ON CONFLICT DO NOTHING`) — menambah `restocks.json`. File ini juga otomatis dibuat saat pertama ditulis.
2. Deploy, isi setting Pakasir v2 + webhook di dashboard Pakasir, lalu setting YouduStore di tab Restock.
