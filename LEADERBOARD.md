# 🏆 Dokumentasi Fitur Leaderboard Pembeli

## Overview
Fitur Leaderboard menampilkan top pembeli berdasarkan total transaksi sukses dengan desain podium yang menarik (dark mode + aksen neon).

---

## 1. Logika Backend

### Query Logic (JSON Database)
Karena menggunakan JSON storage, logika query dilakukan di JavaScript:

```javascript
// Calculate leaderboard from transactions
const userStats = {};

transactions.forEach(t => {
  if (t.status === 'done' && t.userId) {
    if (!userStats[t.userId]) {
      userStats[t.userId] = {
        userId: t.userId,
        totalTransactions: 0,
        totalSpent: 0
      };
    }
    userStats[t.userId].totalTransactions++;
    userStats[t.userId].totalSpent += t.price;
  }
});

// Convert to array and add user info
const leaderboard = Object.values(userStats).map(stat => {
  const user = users.find(u => u.id === stat.userId);
  return {
    ...stat,
    username: user?.username || 'Unknown',
    avatar: null
  };
});

// Sort by total transactions descending
leaderboard.sort((a, b) => b.totalTransactions - a.totalTransactions);

// Add rank
leaderboard.forEach((item, index) => {
  item.rank = index + 1;
});
```

### SQL Equivalent (Jika Menggunakan Database SQL)
```sql
SELECT 
    u.id,
    u.username,
    u.avatar_url,
    COUNT(t.id) as total_transaksi,
    SUM(t.price) as total_spent,
    ROW_NUMBER() OVER (ORDER BY COUNT(t.id) DESC) as rank
FROM users u
INNER JOIN transactions t ON u.id = t.user_id
WHERE t.status = 'done'
GROUP BY u.id, u.username, u.avatar_url
ORDER BY total_transaksi DESC
LIMIT 10;
```

---

## 2. API Endpoints

### GET `/leaderboard`
**Deskripsi:** Halaman leaderboard dengan UI lengkap

**Response:** HTML page dengan EJS template

---

### GET `/api/leaderboard`
**Deskripsi:** API endpoint untuk mendapatkan data leaderboard (JSON)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "rank": 1,
      "username": "user123",
      "totalTransactions": 25,
      "totalSpent": 1500000,
      "avatar": null
    },
    {
      "rank": 2,
      "username": "gamer456",
      "totalTransactions": 18,
      "totalSpent": 980000,
      "avatar": null
    },
    {
      "rank": 3,
      "username": "buyer789",
      "totalTransactions": 15,
      "totalSpent": 750000,
      "avatar": null
    }
  ]
}
```

**Contoh Penggunaan:**
```javascript
fetch('/api/leaderboard')
  .then(res => res.json())
  .then(data => {
    console.log('Top 10 Buyers:', data.data);
  });
```

---

## 3. Struktur Data JSON

### Input (transactions.json)
```json
[
  {
    "id": "uuid-1",
    "code": "HM-A1B2-C3D4",
    "userId": "user-uuid-1",
    "productName": "Drip Client Android",
    "price": 60000,
    "status": "done",
    "createdAt": "2025-05-31T10:00:00.000Z"
  },
  {
    "id": "uuid-2",
    "code": "HM-E5F6-G7H8",
    "userId": "user-uuid-1",
    "productName": "Fluorite FF IOS",
    "price": 150000,
    "status": "done",
    "createdAt": "2025-05-31T11:00:00.000Z"
  }
]
```

### Output (Leaderboard Data)
```json
[
  {
    "rank": 1,
    "userId": "user-uuid-1",
    "username": "user123",
    "totalTransactions": 2,
    "totalSpent": 210000,
    "avatar": null
  }
]
```

---

## 4. Desain UI/UX

### Podium Design (Top 3)
```
┌─────────────────────────────────────┐
│         🏆 LEADERBOARD              │
├─────────────────────────────────────┤
│                                     │
│     ┌───┐    ┌───┐    ┌───┐       │
│     │ 2 │    │👑1│    │ 3 │       │
│     │   │    │   │    │   │       │
│     └───┘    └───┘    └───┘       │
│    Silver    Gold    Bronze       │
│                                     │
└─────────────────────────────────────┘
```

### Karakteristik Visual:
- **Rank 1 (Center):**
  - Avatar: 120x120px
  - Warna: Gold gradient (#fbbf24 → #f59e0b)
  - Efek: Pulse animation + crown icon 👑
  - Podium height: 180px
  - Shadow: 0 0 40px gold glow

- **Rank 2 (Left):**
  - Avatar: 90x90px
  - Warna: Silver gradient (#94a3b8 → #cbd5e1)
  - Podium height: 140px
  - Shadow: 0 0 30px silver glow

- **Rank 3 (Right):**
  - Avatar: 90x90px
  - Warna: Bronze gradient (#fb923c → #f97316)
  - Podium height: 140px
  - Shadow: 0 0 30px bronze glow

### List Design (Rank 4+)
- Card-based layout
- Hover effect: translateX(5px) + border glow
- Display: Rank number, avatar, username, total transactions, total spent

---

## 5. CSS Styling (Dark Mode + Neon)

### Color Palette
```css
/* Background */
--bg-primary: #0b0b1a;
--bg-secondary: #0d0d20;
--bg-card: rgba(255,255,255,0.03);

/* Accents */
--accent-indigo: #6366f1;
--accent-purple: #8b5cf6;
--accent-gold: #fbbf24;
--accent-silver: #94a3b8;
--accent-bronze: #fb923c;

/* Text */
--text-primary: #e0e0e0;
--text-secondary: #a1a1aa;
--text-muted: #71717a;
```

### Key Animations
```css
@keyframes pulse-gold {
  0%, 100% {
    box-shadow: 0 0 40px rgba(251, 191, 36, 0.6);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 0 60px rgba(251, 191, 36, 0.8);
    transform: scale(1.05);
  }
}

@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
}
```

---

## 6. Integrasi dengan Sistem Existing

### File yang Dimodifikasi:
1. **`backend/server.js`**
   - Tambah route `/leaderboard`
   - Tambah API endpoint `/api/leaderboard`
   - Logic untuk calculate leaderboard dari transactions

2. **`backend/views/pages/leaderboard.ejs`**
   - Halaman leaderboard dengan podium design
   - Responsive layout
   - Dark mode + neon accents

3. **`backend/views/pages/home.ejs`**
   - Tambah link "Leaderboard" di navbar
   - Tambah link di mobile menu

### Cara Akses:
- **Web:** `http://localhost:3000/leaderboard`
- **API:** `http://localhost:3000/api/leaderboard`

---

## 7. Fitur Tambahan

### Auto-Update (Optional)
Untuk real-time update, tambahkan polling:

```javascript
// Di halaman leaderboard
setInterval(async () => {
  const response = await fetch('/api/leaderboard');
  const data = await response.json();
  
  if (data.success) {
    updateLeaderboardUI(data.data);
  }
}, 30000); // Update setiap 30 detik
```

### Filter by Period (Optional)
Tambahkan filter untuk melihat leaderboard berdasarkan periode:

```javascript
// Query parameter: ?period=week|month|all
app.get('/api/leaderboard', (req, res) => {
  const period = req.query.period || 'all';
  let startDate = null;

  if (period === 'week') {
    startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === 'month') {
    startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 1);
  }

  // Filter transactions by date
  const filteredTransactions = startDate 
    ? transactions.filter(t => new Date(t.createdAt) >= startDate)
    : transactions;

  // Calculate leaderboard...
});
```

---

## 8. Testing

### Test Cases:
1. ✅ Leaderboard kosong (belum ada transaksi)
2. ✅ Leaderboard dengan 1-2 user (kurang dari 3)
3. ✅ Leaderboard dengan 3+ user (tampil podium)
4. ✅ Leaderboard dengan 10+ user (tampil list)
5. ✅ Sorting berdasarkan total transaksi (descending)
6. ✅ Hanya hitung transaksi dengan status 'done'
7. ✅ Avatar fallback (inisial nama jika avatar null)
8. ✅ Responsive design (mobile & desktop)

### Manual Testing:
```bash
# 1. Jalankan server
node backend/server.js

# 2. Buka browser
http://localhost:3000/leaderboard

# 3. Test API
curl http://localhost:3000/api/leaderboard
```

---

## 9. Performance Optimization

### Caching (Optional)
```javascript
let leaderboardCache = null;
let cacheTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 menit

app.get('/api/leaderboard', (req, res) => {
  const now = Date.now();
  
  if (leaderboardCache && cacheTime && (now - cacheTime) < CACHE_DURATION) {
    return res.json(leaderboardCache);
  }

  // Calculate leaderboard...
  const result = { success: true, data: leaderboard };
  
  leaderboardCache = result;
  cacheTime = now;
  
  res.json(result);
});
```

---

## 10. Troubleshooting

### Leaderboard kosong padahal ada transaksi
- Pastikan transaksi memiliki `userId` yang valid
- Pastikan status transaksi adalah `'done'`
- Cek apakah user masih ada di `users.json`

### Ranking tidak urut
- Pastikan sorting berdasarkan `totalTransactions` descending
- Cek apakah ada transaksi dengan status selain 'done'

### Avatar tidak muncul
- Fitur avatar belum diimplementasi (default: null)
- Untuk menambahkan avatar, update user profile dengan field `avatar`

---

## 11. Future Enhancements

1. **Avatar Upload** - Allow users to upload profile pictures
2. **Badges** - Award badges for milestones (10, 50, 100 transactions)
3. **Period Filter** - Weekly, monthly, all-time leaderboard
4. **Category Filter** - Leaderboard per kategori produk
5. **Rewards** - Give rewards/vouchers to top buyers
6. **Social Sharing** - Share leaderboard position to social media
7. **Real-time Updates** - WebSocket for live leaderboard updates

---

**Dibuat dengan ❤️ untuk YOOSKY STORE**

© 2025 YOOSKY STORE. All rights reserved.
