// Kompres ulang gambar LAMA di Supabase Storage (bucket product-images).
// Gambar yang diupload sebelum patch masih ukuran asli (bisa 2-5 MB) dan
// itu sumber egress Supabase terbesar. Script ini resize max 1000px dan
// re-encode DENGAN NAMA & FORMAT YANG SAMA, jadi URL di products/settings
// tidak berubah.
//
// Pakai (dari folder project, env SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY di .env):
//   node scripts/compress-storage.js          -> dry run (cuma lapor)
//   node scripts/compress-storage.js --apply  -> benar-benar timpa file
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');

const APPLY = process.argv.includes('--apply');
const BUCKET = 'product-images';
const MIN_BYTES = 150 * 1024; // hanya file > 150 KB
const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum di-set'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

async function listAll() {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await sb.storage.from(BUCKET).list('', { limit: 100, offset });
    if (error) throw error;
    if (!data.length) break;
    out.push(...data.filter(f => f.id)); // skip folder
  }
  return out;
}

(async () => {
  const files = await listAll();
  let before = 0, after = 0, touched = 0;
  for (const f of files) {
    const size = f.metadata?.size || 0;
    const mime = f.metadata?.mimetype || '';
    if (size < MIN_BYTES || !/^image\/(jpeg|jpg|png|webp)$/.test(mime)) continue;
    const { data: blob, error } = await sb.storage.from(BUCKET).download(f.name);
    if (error) { console.error('skip', f.name, error.message); continue; }
    const input = Buffer.from(await blob.arrayBuffer());
    let p = sharp(input).rotate().resize({ width: 1000, withoutEnlargement: true });
    p = mime === 'image/png' ? p.png({ compressionLevel: 9, palette: true, quality: 85 })
      : mime === 'image/webp' ? p.webp({ quality: 78 })
      : p.jpeg({ quality: 80, mozjpeg: true });
    const out = await p.toBuffer();
    if (out.length >= input.length * 0.9) continue; // hemat < 10%, lewati
    before += input.length; after += out.length; touched++;
    console.log(`${APPLY ? 'OK ' : 'DRY'} ${f.name}: ${(input.length/1024)|0}KB -> ${(out.length/1024)|0}KB`);
    if (APPLY) {
      const { error: upErr } = await sb.storage.from(BUCKET).upload(f.name, out, { contentType: mime, upsert: true, cacheControl: '31536000' });
      if (upErr) console.error('  gagal upload:', upErr.message);
    }
  }
  console.log(`\n${touched} file, ${(before/1048576).toFixed(1)} MB -> ${(after/1048576).toFixed(1)} MB${APPLY ? '' : '  (dry run, tambah --apply untuk eksekusi)'}`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
