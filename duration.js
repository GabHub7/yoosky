// ═══════════════════════════════════════════════════════════════════
//  duration.js — Helper durasi paket produk (HARI + JAM)
//
//  Sebelumnya semua paket diasumsikan "hari" (field `days`, label "... 7 DAYS",
//  tag key "KEY:7"). Sekarang paket bisa juga dijual per JAM:
//
//    pricingOption : { days: 12, unit: 'hour', price, reseller_price }
//                    (field `days` TETAP dipakai sebagai angka durasi supaya
//                     data lama kompatibel; `unit` kosong/'day' = hari)
//    label item    : "NAMA 7 DAYS"  |  "NAMA 12 HOURS"
//    tag key       : "KEY:7" / "KEY:7d" = 7 hari   |   "KEY:12h" = 12 jam
// ═══════════════════════════════════════════════════════════════════

const LABEL_RE = /(\d+)\s*(DAYS?|HARI|HOURS?|JAM)\b/i;
const TAG_RE = /^(.*):(\d+)([dh])?$/i;

const normUnit = (u) => (/^(h|hr|hrs|hour|hours|jam)$/i.test(String(u || '').trim()) ? 'hour' : 'day');

// "NAMA 12 HOURS" -> { value: 12, unit: 'hour' }; tidak ada pola -> null
function fromLabel(label) {
  const m = String(label || '').match(LABEL_RE);
  if (!m) return null;
  return { value: parseInt(m[1], 10), unit: normUnit(m[2]) };
}

const unitWord = (unit) => (normUnit(unit) === 'hour' ? 'HOURS' : 'DAYS');
const makeLabel = (name, value, unit) => `${String(name || 'PRODUK').toUpperCase()} ${value} ${unitWord(unit)}`;
const human = (value, unit) => `${value} ${normUnit(unit) === 'hour' ? 'Jam' : 'Hari'}`;
const tagFor = (value, unit) => (normUnit(unit) === 'hour' ? `${value}h` : `${value}`);

// Teks durasi dari sebuah transaksi (untuk invoice dll)
function humanFromTransaction(t) {
  if (!t || !t.selectedDays) return '';
  return human(t.selectedDays, t.selectedUnit);
}

// "ABC-123:12h" -> { code:'ABC-123', value:12, unit:'hour' } ; tanpa tag -> null
function parseKey(k) {
  const m = String(k || '').match(TAG_RE);
  if (!m) return null;
  return { code: m[1], value: parseInt(m[2], 10), unit: m[3] && m[3].toLowerCase() === 'h' ? 'hour' : 'day' };
}

const isGeneric = (k) => !String(k || '').includes(':');
const matches = (k, value, unit) => {
  const p = parseKey(k);
  return !!p && p.value === value && p.unit === normUnit(unit);
};

const countTagged = (keys, value, unit) => (keys || []).filter((k) => matches(k, value, unit)).length;
const countGeneric = (keys) => (keys || []).filter(isGeneric).length;

// Stok yang tampil untuk 1 paket: key khusus durasi itu dulu, kalau tidak ada pakai key generik
function stockFor(keys, value, unit) {
  if (!value) return countGeneric(keys);
  const tagged = countTagged(keys, value, unit);
  return tagged > 0 ? tagged : countGeneric(keys);
}

// Ambil (dan buang dari array) 1 key untuk paket tertentu. null kalau stok paket itu kosong.
// Sengaja TIDAK lagi "ambil key apa saja" sebagai fallback terakhir — itu bisa
// menjual key 30 hari untuk paket 1 jam (atau sebaliknya).
function takeKey(keys, value, unit) {
  if (!Array.isArray(keys) || !keys.length) return null;
  if (value) {
    const idx = keys.findIndex((k) => matches(k, value, unit));
    if (idx !== -1) return parseKey(keys.splice(idx, 1)[0]).code;
  }
  const gi = keys.findIndex(isGeneric);
  if (gi !== -1) return keys.splice(gi, 1)[0];
  return null;
}

// Cari paket (harga + durasi) dari produk berdasarkan `duration` yang dikirim client:
// label item ("NAMA 12 HOURS"), atau angka saja ("30" = 30 hari, "12h" = 12 jam).
// return { value, unit, price, resellerPrice, label } | null
function resolvePackage(product, duration) {
  const opts = product.pricingOptions || [];
  const items = product.items || [];
  const d = String(duration == null ? '' : duration).trim();
  if (!d) return null;

  let value = null, unit = 'day', item = items.find((i) => i.l === d) || null;

  if (item) {
    const p = fromLabel(item.l);
    if (p) { value = p.value; unit = p.unit; }
  } else {
    const num = d.match(/^(\d+)\s*(h|hr|jam|hour|hours|d|day|days|hari)?$/i);
    if (num) { value = parseInt(num[1], 10); unit = normUnit(num[2]); }
    else {
      const p = fromLabel(d);
      if (p) { value = p.value; unit = p.unit; }
    }
    if (value != null) {
      item = items.find((i) => { const q = fromLabel(i.l); return q && q.value === value && q.unit === unit; }) || null;
    }
  }

  if (value != null) {
    const opt = opts.find((o) => parseInt(o.days, 10) === value && normUnit(o.unit) === unit);
    if (opt) {
      return {
        value, unit, price: opt.price,
        resellerPrice: opt.reseller_price != null ? opt.reseller_price : (item && item.reseller_price != null ? item.reseller_price : null),
        label: item ? item.l : makeLabel(product.name, value, unit)
      };
    }
  }
  if (item) {
    return { value, unit, price: item.p, resellerPrice: item.reseller_price != null ? item.reseller_price : null, label: item.l };
  }
  return null;
}

// Normalisasi daftar opsi harga dari form admin (array paralel days/prices/resellerPrices/units)
function parsePricingOptions(days, prices, resellerPrices, units) {
  const arr = (v) => (Array.isArray(v) ? v : (v !== undefined && v !== null && v !== '' ? [v] : []));
  const da = arr(days), pa = arr(prices), rpa = arr(resellerPrices), ua = arr(units);
  const opts = []; const seen = new Set();
  for (let i = 0; i < da.length; i++) {
    const d = parseInt(da[i], 10), p = parseInt(pa[i], 10), u = normUnit(ua[i]);
    const key = `${u}:${d}`;
    if (d > 0 && p >= 0 && !seen.has(key)) {
      seen.add(key);
      const rp = rpa[i] !== undefined && rpa[i] !== '' ? parseInt(rpa[i], 10) : null;
      opts.push({ days: d, unit: u, price: p, reseller_price: (rp !== null && !isNaN(rp) && rp >= 0) ? rp : null });
    }
  }
  // hari dulu (kecil→besar), lalu jam
  return opts.sort((a, b) => (a.unit === b.unit ? a.days - b.days : (a.unit === 'hour' ? -1 : 1)));
}

module.exports = {
  normUnit, fromLabel, unitWord, makeLabel, human, tagFor, humanFromTransaction,
  parseKey, isGeneric, matches, countTagged, countGeneric, stockFor, takeKey,
  resolvePackage, parsePricingOptions
};
