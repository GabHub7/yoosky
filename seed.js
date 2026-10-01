// seed.js — Generate fake data untuk MarketHero
// Jalankan: node seed.js
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, 'database');
if (!fs.existsSync(dbPath)) fs.mkdirSync(dbPath, { recursive: true });

const writeDB = (f, d) => fs.writeFileSync(path.join(dbPath, f), JSON.stringify(d, null, 2));
const readDB  = (f) => {
  const fp = path.join(dbPath, f);
  if (!fs.existsSync(fp)) return f.includes('settings') ? {} : [];
  try { return JSON.parse(fs.readFileSync(fp,'utf-8')); } catch { return []; }
};

const formatDate = (d = new Date()) => {
  const dt = new Date(d);
  const pad = n => String(n).padStart(2,'0');
  return `${pad(dt.getDate())}/${pad(dt.getMonth()+1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
};

const avatarUrl = (seed) => `https://api.dicebear.com/7.x/pixel-art/png?seed=${encodeURIComponent(seed)}&size=80&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;

// ─── 62 Fake Users ───
const userNames = [
  // Top buyers (banyak transaksi, semua punya foto)
  'GabzPro','NightWolf','SkyyFire','DarkBlaze','LunarKing',
  'RedFalcon','IronPhoenix','ShadowX','NeonVibes','CyberRush',
  'AlphaGod','ZeroCool','PixelKnight','StormRider','GhostByte',
  // Mid buyers (foto campuran)
  'TurboAce','VoidBreaker','EchoStrike','FrostBite','MegaBoss',
  'QuantumZ','RiftWalker','BladeRunner','NovaStar','DragonByte',
  'PulseWave','HyperCore','OmegaX','CodeBreaker','StellarRift',
  // Buyers biasa (foto campuran)
  'FlashKing','CrimsonX','BlazeWolf','SilverBolt','TitanFury',
  'DuskReaper','NightHawk','PhantomEdge','SpeedDemon','IceFang',
  'ThunderGod','VenomShot','SkyWarden','DarkMatter','GoldRush',
  // Casual buyers (sebagian besar tanpa foto)
  'UserGaming88','Prayoga21','BudiSantoso','AndiKurniawan','RezaPlays',
  'FajarGamer','DoniPlayz','RizkiFF','HendriML','AgusTop',
  'SitiGamer','DewiPlays','NurulFF','RahmaFire','IndahGamers',
  // Inactive / 1-2 trx (kebanyakan tanpa foto)
  'NewPlayer01','Noob2024','Pemula99','GuestUser','TrialMode',
  'TestAcc01','RandomBuyer','OneTimeBuy','SilentUser','LurkerMode',
  'LastPlace61','LastPlace62'
];

// Index yang punya foto (40 dari 62)
const withPhoto = new Set([
  0,1,2,3,4,5,6,7,8,9,
  10,11,12,13,14,15,16,17,18,19,
  20,21,22,23,24,25,26,27,28,29,
  30,31,32,33,34,35,36,37,38,39,
  45,46,47,48,49
]);

const resellerIdx = new Set([0,1,2,5,14,30,33]);

const hashedPass = bcrypt.hashSync('password123', 10);
const now = Date.now();

const users = userNames.map((name, i) => {
  const id = uuidv4();
  const createdAt = new Date(now - (62-i) * 24*3600*1000 - Math.random()*7*24*3600*1000).toISOString();
  const isReseller = resellerIdx.has(i);
  return {
    id,
    username: name,
    password: hashedPass,
    wa: `0812${String(10000000 + i * 1234567 % 90000000).padStart(8,'0')}`,
    photo: withPhoto.has(i) ? avatarUrl(name) : null,
    createdAt,
    is_reseller: isReseller,
    role: isReseller ? 'reseller' : 'user',
    reseller_since: isReseller ? createdAt : undefined,
    reseller_code: isReseller ? `RSL-${name.slice(0,4).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}` : undefined
  };
});

// ─── 5 Produk ───
const makeKeys = (prefix, count, days) => {
  const arr = [];
  for (let i = 1; i <= count; i++) {
    arr.push(`${prefix}-${String(i).padStart(3,'0')}${days ? ':'+days : ''}`);
  }
  return arr;
};

const products = [
  {
    id: uuidv4(),
    name: 'FREE FIRE MAX BUNDLE',
    category: 'freefire',
    description: 'Bundle lengkap Free Fire MAX: Wall Hack, Aimbot, ESP, Speed. Update otomatis!',
    image: 'https://i.imgur.com/JvY5m6J.png',
    pricingOptions: [{days:7,price:60000},{days:30,price:150000},{days:90,price:350000}],
    items: [
      {l:'FREE FIRE MAX BUNDLE 7 DAYS',p:60000},
      {l:'FREE FIRE MAX BUNDLE 30 DAYS',p:150000},
      {l:'FREE FIRE MAX BUNDLE 90 DAYS',p:350000}
    ],
    keys: [...makeKeys('FF7',50,7),...makeKeys('FF30',40,30),...makeKeys('FF90',20,90)],
    status: 'active', sold: 487, createdAt: new Date(now-90*86400000).toISOString()
  },
  {
    id: uuidv4(),
    name: 'MLBB INJECTOR PRO',
    category: 'mlbb',
    description: 'Mobile Legends Injector: Drone View, Map Hack, No Cooldown, Auto Win!',
    image: 'https://i.imgur.com/9rWbX7G.png',
    pricingOptions: [{days:7,price:50000},{days:30,price:120000},{days:90,price:280000}],
    items: [
      {l:'MLBB INJECTOR PRO 7 DAYS',p:50000},
      {l:'MLBB INJECTOR PRO 30 DAYS',p:120000},
      {l:'MLBB INJECTOR PRO 90 DAYS',p:280000}
    ],
    keys: [...makeKeys('ML7',40,7),...makeKeys('ML30',30,30),...makeKeys('ML90',15,90)],
    status: 'active', sold: 365, createdAt: new Date(now-85*86400000).toISOString()
  },
  {
    id: uuidv4(),
    name: 'PUBG MOBILE HACK VIP',
    category: 'pubgm',
    description: 'PUBG Mobile: Aimbot, Magic Bullet, Wall, Speed, Anti-Ban Guaranteed!',
    image: 'https://i.imgur.com/KjmVhxP.png',
    pricingOptions: [{days:7,price:75000},{days:30,price:180000},{days:90,price:420000}],
    items: [
      {l:'PUBG MOBILE HACK VIP 7 DAYS',p:75000},
      {l:'PUBG MOBILE HACK VIP 30 DAYS',p:180000},
      {l:'PUBG MOBILE HACK VIP 90 DAYS',p:420000}
    ],
    keys: [...makeKeys('PG7',35,7),...makeKeys('PG30',25,30),...makeKeys('PG90',12,90)],
    status: 'active', sold: 278, createdAt: new Date(now-80*86400000).toISOString()
  },
  {
    id: uuidv4(),
    name: 'VALORANT CHEAT ELITE',
    category: 'freefire',
    description: 'Valorant: Aimbot Lock, ESP Box, Trigger Bot, No Recoil. Undetected!',
    image: 'https://i.imgur.com/mT2bWAk.png',
    pricingOptions: [{days:7,price:90000},{days:30,price:220000}],
    items: [
      {l:'VALORANT CHEAT ELITE 7 DAYS',p:90000},
      {l:'VALORANT CHEAT ELITE 30 DAYS',p:220000}
    ],
    keys: [...makeKeys('VL7',30,7),...makeKeys('VL30',20,30)],
    status: 'active', sold: 193, createdAt: new Date(now-75*86400000).toISOString()
  },
  {
    id: uuidv4(),
    name: 'GENSHIN SCRIPT PACK',
    category: 'sertifikat',
    description: 'Genshin Impact Script: Auto Farm, Speed Hack, God Mode, One Hit Kill!',
    image: 'https://i.imgur.com/Dp3WXRB.png',
    pricingOptions: [{days:7,price:55000},{days:30,price:130000},{days:90,price:300000}],
    items: [
      {l:'GENSHIN SCRIPT PACK 7 DAYS',p:55000},
      {l:'GENSHIN SCRIPT PACK 30 DAYS',p:130000},
      {l:'GENSHIN SCRIPT PACK 90 DAYS',p:300000}
    ],
    keys: [...makeKeys('GS7',45,7),...makeKeys('GS30',30,30),...makeKeys('GS90',18,90)],
    status: 'active', sold: 312, createdAt: new Date(now-70*86400000).toISOString()
  }
];

// ─── Transaksi — distribusi realistis untuk 62 users ───
// Top 15: banyak banget, mid 25: sedang, sisa: sedikit
const trxCounts = [
  // index 0-14: top buyers
  45, 38, 33, 28, 25, 22, 20, 18, 16, 15,
  14, 13, 12, 11, 10,
  // index 15-29: mid buyers
  9, 9, 8, 8, 7, 7, 6, 6, 5, 5,
  5, 4, 4, 4, 3,
  // index 30-44: regular
  8, 7, 6, 6, 5, 5, 4, 4, 3, 3,
  3, 2, 2, 2, 2,
  // index 45-61: casual / inactive
  4, 3, 3, 2, 2,
  1, 1, 1, 1, 1,
  1, 1, 1, 1, 1,
  1, 1
];

const doneRatio = 0.88;
const transactions = [];
const orderChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => {
  let c = 'HM-';
  for (let i=0;i<4;i++) c += orderChars[Math.floor(Math.random()*orderChars.length)];
  c += '-';
  for (let i=0;i<4;i++) c += orderChars[Math.floor(Math.random()*orderChars.length)];
  return c;
};

let keyCounter = {};
const getKey = (product, days) => {
  const k = `${product.id}:${days}`;
  if (!keyCounter[k]) keyCounter[k] = 0;
  keyCounter[k]++;
  const prefix = product.name.slice(0,2).toUpperCase().replace(/\s/,'');
  return `${prefix}${days}-${String(keyCounter[k]).padStart(3,'0')}`;
};

users.forEach((user, ui) => {
  const count = trxCounts[ui] || 0;
  for (let t = 0; t < count; t++) {
    const product = products[Math.floor(Math.random() * products.length)];
    const item = product.items[Math.floor(Math.random() * product.items.length)];
    const m = (item.l.match(/(\d+)\s+DAYS/)||[]);
    const days = m[1] ? parseInt(m[1]) : 7;
    const isDone = Math.random() < doneRatio;
    const basePrice = item.p;
    const price = user.is_reseller ? Math.round(basePrice * 0.8) : basePrice;
    const daysAgo = Math.floor(Math.random() * 60) + 1;
    const trxDate = new Date(now - daysAgo*86400000 - Math.random()*43200000);

    transactions.push({
      id: uuidv4(),
      orderId: `HM-${trxDate.getTime()}`,
      code: genCode(),
      userId: user.id,
      productId: product.id,
      productName: product.name,
      duration: item.l,
      selectedDays: days,
      price,
      totalPayment: price,
      customerName: user.username,
      wa: user.wa,
      qrString: null,
      isStatic: true,
      status: isDone ? 'done' : (Math.random() < 0.5 ? 'pending' : 'expired'),
      key: isDone ? getKey(product, days) : null,
      paidAt: isDone ? trxDate.toISOString() : null,
      createdAt: trxDate.toISOString(),
      time: formatDate(trxDate)
    });
  }
});

transactions.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

// ─── Testimonials (50 fake reviews) ───
const reviewTexts = [
  'Mantap banget kunci nya langsung aktif, anti ban aman!',
  'Proses cepet bgt, langsung jalan. Recommended!',
  'Udah coba 3 bulan ga pernah kena ban, aman poll!',
  'Seller responsif, key langsung dikirim otomatis. 👍',
  'Murah meriah, kualitas premium! Bakal order lagi.',
  'Aimbot-nya smooth banget, ga kedetect anti cheat.',
  'Udah jadi langganan tiap bulan di sini, terpercaya.',
  'Pelayanan oke, harga bersaing. Top markotop!',
  'Key nya langsung aktif, ga perlu nunggu lama. GG!',
  'Stok selalu ada, proses otomatis. Love it!',
  'Terbaik se-Indonesia, udah nyoba yang lain ga ada yang lebih baik.',
  'Fast respon, key valid, ga ada masalah sama sekali.',
  'Harga terjangkau buat semua kalangan. Keren!',
  'Sempat ragu awalnya, tapi setelah coba langsung ketagihan.',
  'Aman, cepat, murah. 3 kata buat yooskystore!',
  'Fitur lengkap, update rutin, jarang crash. Perfect!',
  'Seller jujur dan transparan, ga ada tipu-tipu.',
  'Pertama kali beli di sini, ternyata beneran legit!',
  'Pakai dari awal buka, sampe sekarang masih setia order di sini.',
  'Key nya valid semua, langsung pakai. No cap!',
  'Paling recommended buat yang mau cari cheat aman.',
  'Ga nyesel beli di sini, bakal repeat order terus!',
  'Harga masuk akal, kualitas tinggi. Mantul!',
  'Auto bayar, auto dapet key. Sistemnya canggih!',
  'Beli 3x, ke-3x nya lancar semua. Terpercaya!',
  'Update rutin jadi ga takut kena patch game.',
  'Response admin cepet kalau ada masalah. 10/10!',
  'Pertama coba 7 hari, langsung extend 30 hari.',
  'Komunitas seller nya solid, ga kabur2an.',
  'Kalau mau aman ya di sini tempatnya!'
];

const testimonials = [];
for (let i = 0; i < 50; i++) {
  const user = users[Math.floor(Math.random() * 40)];
  const product = products[Math.floor(Math.random() * products.length)];
  const rating = Math.random() < 0.65 ? 5 : (Math.random() < 0.6 ? 4 : 3);
  const daysAgo = Math.floor(Math.random() * 45) + 1;
  testimonials.push({
    id: uuidv4(),
    product: product.name,
    productName: product.name,
    username: user.username,
    name: user.username,
    photo: user.photo || null,
    rating,
    text: reviewTexts[i % reviewTexts.length],
    date: new Date(now - daysAgo * 86400000).toISOString(),
    verified: Math.random() < 0.75,
    featured: Math.random() < 0.40
  });
}

// ─── Notifications ───
const notifications = transactions
  .filter(t => t.status === 'done')
  .slice(0, 80)
  .map(t => {
    const buyer = users.find(u => u.id === t.userId);
    return {
      id: uuidv4(),
      type: 'purchase',
      buyerName: t.customerName,
      buyerPhoto: buyer?.photo || null,
      productName: t.productName,
      price: t.price,
      time: t.paidAt,
      timeStr: formatDate(t.paidAt)
    };
  });

// ─── Write semua ke database ───
writeDB('users.json', users);
writeDB('products.json', products);
writeDB('transactions.json', transactions);
writeDB('testimonials.json', testimonials);
writeDB('notifications.json', notifications);

const settings = readDB('settings.json');
settings.categories = ['freefire','mlbb','pubgm','sertifikat'];
settings.categoryLabels = {
  freefire: 'FREE FIRE',
  mlbb: 'MOBILE LEGENDS',
  pubgm: 'PUBG MOBILE',
  sertifikat: 'PREMIUM SCRIPT'
};
settings.resellerEnabled = true;
settings.resellerPrice = 50000;
settings.resellerDiscount = 20;
settings.resellerNote = 'Dapatkan diskon eksklusif 20% untuk semua produk!';
writeDB('settings.json', settings);

// ─── Summary ───
const doneTrx = transactions.filter(t=>t.status==='done');
const leaderMap = {};
doneTrx.forEach(t => {
  if (!leaderMap[t.userId]) leaderMap[t.userId] = {count:0,spent:0};
  leaderMap[t.userId].count++;
  leaderMap[t.userId].spent += t.price;
});
const top10 = Object.entries(leaderMap).sort((a,b)=>b[1].count-a[1].count).slice(0,10);

console.log('\n✅ Seed data berhasil dibuat!\n');
console.log(`👥 Users       : ${users.length} (${users.filter(u=>u.photo).length} dengan foto, ${users.filter(u=>!u.photo).length} tanpa foto, ${users.filter(u=>u.is_reseller).length} reseller)`);
console.log(`📦 Products    : ${products.length}`);
console.log(`💳 Transactions: ${transactions.length} (${doneTrx.length} done, ${transactions.filter(t=>t.status==='pending').length} pending)`);
console.log(`⭐ Testimonials : ${testimonials.length} (${testimonials.filter(t=>t.featured).length} featured)`);
console.log(`🔔 Notifications: ${notifications.length}`);
console.log('\n🏆 Top 10 Leaderboard:');
top10.forEach(([uid,s],i) => {
  const u = users.find(u=>u.id===uid);
  console.log(`   #${i+1} ${(u?.username||'?').padEnd(18)} — ${s.count} trx — Rp ${s.spent.toLocaleString('id-ID')} ${u?.photo?'📷':'  '}`);
});
console.log('\n');
