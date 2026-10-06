// ═══════════════════════════════════════════════════════════════════
//  youdustore.js — Client untuk YouduStore REST API (sumber restock key)
//  Referensi: api-1.json (OpenAPI) — server https://api.youdustore.id
//
//  Auth (WAJIB dua-duanya di setiap request):
//    Authorization: Bearer <USER_API_TOKEN>
//    X-API-KEY:     <GLOBAL_ACCESS_KEY>
//  Sandbox (tidak memotong saldo): header X-ENVIRONMENT: sandbox
//
//  Endpoint yang dipakai:
//    GET  /api/v2/check-balance
//    GET  /api/v2/product
//    POST /api/v2/order          { code, data, referenceNumber, telp?, callback_url? }
//    POST /api/v2/check-status   { order_id }   (invoice ATAU referenceNumber)
// ═══════════════════════════════════════════════════════════════════
const https = require('https');

const HOST = 'api.youdustore.id';

const cfgFrom = (settings) => {
  const y = (settings && settings.youdu) || {};
  const clean = (v) => String(v || '').trim().replace(/^Bearer\s+/i, '');
  return {
    token: clean(y.token || process.env.YOUDU_TOKEN),
    apiKey: String(y.apiKey || process.env.YOUDU_API_KEY || '').trim(),
    sandbox: !!y.sandbox
  };
};

function request(method, path, body, cfg) {
  return new Promise((resolve, reject) => {
    if (!cfg || !cfg.token || !cfg.apiKey) return reject(new Error('Token / API Key YouduStore belum dikonfigurasi'));
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      'Authorization': `Bearer ${cfg.token}`,
      'X-API-KEY': cfg.apiKey,
      'Accept': 'application/json'
    };
    if (cfg.sandbox) headers['X-ENVIRONMENT'] = 'sandbox';
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }

    const req = https.request({ hostname: HOST, port: 443, path, method, headers, timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        const failed = res.statusCode < 200 || res.statusCode >= 300 || (json && (json.error === true || json.success === false));
        if (failed) {
          const err = new Error((json && json.message) || `YouduStore HTTP ${res.statusCode}`);
          err.status = res.statusCode;
          err.definitive = true;      // server menjawab → order TIDAK dibuat
          err.body = json;
          return reject(err);
        }
        if (!json) return reject(new Error('Response YouduStore bukan JSON'));
        resolve(json);
      });
    });
    req.on('timeout', () => { req.destroy(); const e = new Error('YouduStore timeout'); e.definitive = false; reject(e); });
    req.on('error', (e) => { const er = new Error('Network error: ' + e.message); er.definitive = false; reject(er); });
    if (payload) req.write(payload);
    req.end();
  });
}

const getBalance = (cfg) => request('GET', '/api/v2/check-balance', null, cfg).then((r) => r.data || {});
const getProducts = (cfg) => request('GET', '/api/v2/product', null, cfg).then((r) => (Array.isArray(r.data) ? r.data : []));

const placeOrder = (cfg, { code, data, referenceNumber, telp, callbackUrl }) => {
  const body = { code, data: data || '-', referenceNumber };
  if (telp) body.telp = telp;
  if (callbackUrl) body.callback_url = callbackUrl;
  return request('POST', '/api/v2/order', body, cfg).then((r) => r.data || {});
};

const checkStatus = (cfg, orderId) =>
  request('POST', '/api/v2/check-status', { order_id: orderId }, cfg).then((r) => r.data || {});

// "Sukses" | "Gagal" | "Proses" | "Sandbox - Sukses" → success | failed | processing | sandbox
function normalizeStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('sandbox')) return 'sandbox';
  if (s.includes('sukses') || s.includes('success') || s.includes('berhasil')) return 'success';
  if (s.includes('gagal') || s.includes('fail') || s.includes('batal') || s.includes('refund')) return 'failed';
  return 'processing';
}

module.exports = { cfgFrom, getBalance, getProducts, placeOrder, checkStatus, normalizeStatus };
