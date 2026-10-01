#!/bin/bash

# YOOSKY STORE - Quick Setup Script

echo "🎮 YOOSKY STORE - JSONBin.io + Vercel Setup"
echo "=========================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js tidak terinstall. Silakan install dari https://nodejs.org"
    exit 1
fi

echo "✅ Node.js $(node -v) terdeteksi"

# Check if in backend_fixed directory
if [ ! -f "server.js" ]; then
    echo "❌ File server.js tidak ditemukan."
    echo "   Jalankan script ini dari folder backend_fixed"
    exit 1
fi

echo ""
echo "📦 Menginstall dependencies..."
npm install

echo ""
echo "📋 Setup Environment Variables"
echo "=============================="
echo ""
echo "Silakan buat file .env di folder ini dengan isi:"
echo ""
cat << 'EOF'
# Database
JSONBIN_API_KEY=your_master_key_here
JSONBIN_BIN_ID=your_bin_id_here
USE_LOCAL_DB=false

# Server
NODE_ENV=development
PORT=3000
SESSION_SECRET=yooskystore-secret-key-2025-change-this

# PakKasir Payment
PAKASIR_API_KEY=your_pakasir_key
PAKASIR_PROJECT=your_project_name
PAKASIR_MODE=production

# Admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123

# Contact
WHATSAPP_NUMBER=6281235690535
TELEGRAM_USERNAME=HEROO3STORE
SUPPORT_EMAIL=support@yooskystore.com

# Site
SITE_NAME=YOOSKY STORE
MARQUEE_TEXT=LAYANAN GAME MOD MENU PREMIUM - PROSES CEPAT & AMAN
EOF

echo ""
echo "📖 Petunjuk Setup:"
echo "1. Kunjungi https://jsonbin.io dan daftar"
echo "2. Buat Bin baru dan salin Bin ID"
echo "3. Copy Master API Key dari Account Settings"
echo "4. Isi JSONBIN_API_KEY dan JSONBIN_BIN_ID di .env"
echo "5. Jalankan: npm start"
echo ""
echo "✅ Setup selesai!"
