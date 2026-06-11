/* ============================================================
   VeoPag adapter — autenticação (com cache de token),
   criação de depósito PIX e consulta de status.
   Docs: https://veopag.readme.io/docs
   ============================================================ */
const axios = require('axios');
const QRCode = require('qrcode');

const BASE = process.env.VEOPAG_BASE_URL || 'https://api.veopag.com';

// ---- cache de token em memória (válido por 1h; renovamos a cada ~55min) ----
let _token = null;
let _tokenUntil = 0;

async function getToken() {
  const now = Date.now();
  if (_token && now < _tokenUntil) return _token;

  const { data } = await axios.post(`${BASE}/api/auth/login`, {
    client_id: process.env.VEOPAG_CLIENT_ID,
    client_secret: process.env.VEOPAG_CLIENT_SECRET,
  }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });

  _token = data.token;
  _tokenUntil = now + 55 * 60 * 1000; // 55 minutos
  return _token;
}

// Faz uma chamada autenticada; em 401 renova o token uma vez e repete.
async function authed(fn) {
  try {
    return await fn(await getToken());
  } catch (e) {
    if (e.response && e.response.status === 401) {
      _token = null; _tokenUntil = 0;
      return await fn(await getToken());
    }
    throw e;
  }
}

/* ---- Criar depósito PIX (cash-in) ----
   POST /api/payments/deposit
   Retorna { transactionId, status, qrcode (copia e cola EMV), qrImage (dataURL), amount, fee }
*/
async function criarDeposito({ amount, externalId, callbackUrl, payer }) {
  const body = {
    amount: Number(Number(amount).toFixed(2)),
    external_id: externalId,
    clientCallbackUrl: callbackUrl,
    payer: {
      name: payer.name || 'Pagamento Digital',
      email: payer.email || 'pagador@exemplo.com',
      document: (payer.document || '').replace(/\D/g, ''),
      ...(payer.phone ? { phone: payer.phone.replace(/\D/g, '') } : {}),
    },
  };

  const data = await authed((token) =>
    axios.post(`${BASE}/api/payments/deposit`, body, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 20000,
    }).then((r) => r.data)
  );

  // Resposta 201 (nova) => { qrCodeResponse: {...} }
  // Resposta 200 (idempotente) => { transaction_id, qrcode, status, idempotent:true }
  const q = data.qrCodeResponse || data;
  const transactionId = q.transactionId || q.transaction_id;
  const qrcode = q.qrcode;

  // Gera a imagem do QR a partir do código copia-e-cola (EMV)
  let qrImage = null;
  try {
    qrImage = await QRCode.toDataURL(qrcode, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
  } catch (_) { /* segue sem imagem; front mostra copia-e-cola */ }

  return {
    transactionId,
    status: q.status || 'PENDING',
    qrcode,
    qrImage,
    amount: q.amount != null ? q.amount : body.amount,
    fee: q.fee,
    idempotent: !!data.idempotent,
  };
}

/* ---- Consulta de status (reconciliação / fallback do webhook) ----
   GET /api/transactions/deposit
   OBS: confirme o nome do parâmetro de busca na doc "Consultas" da VeoPag
   (transaction_id ou external_id). Deixei ambos.
*/
async function consultarDeposito({ transactionId, externalId }) {
  const params = {};
  if (transactionId) params.transaction_id = transactionId;
  if (externalId) params.external_id = externalId;

  const data = await authed((token) =>
    axios.get(`${BASE}/api/transactions/deposit`, {
      headers: { Authorization: `Bearer ${token}` },
      params, timeout: 15000,
    }).then((r) => r.data)
  );
  return data;
}

module.exports = { getToken, criarDeposito, consultarDeposito, BASE };
