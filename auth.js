/* ============================================================
   TURBO PRÊMIOS — Autenticação do painel admin (server-side)
   --------------------------------------------------------------
   Login validado NO SERVIDOR. A senha nunca fica no site —
   só existe aqui, nas variáveis de ambiente do Render.
   Ao logar, o servidor emite um "crachá" (token) assinado e
   temporário (8h). As rotas protegidas exigem esse crachá.
   ============================================================ */
const crypto = require('crypto');

const SECRET = process.env.ADMIN_SECRET || 'troque-este-segredo-no-render';
const TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  // comparação em tempo constante
  const a = Buffer.from(sig || ''), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); }
  catch (_) { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// POST /api/admin/login
function login(req, res) {
  const { user, pass } = req.body || {};
  const U = (process.env.ADMIN_USER || 'admin').trim();
  const P = process.env.ADMIN_PASS || '';
  if (!P) return res.status(500).json({ error: 'Painel não configurado no servidor (defina ADMIN_PASS no Render).' });

  const userOk = (user || '').trim().toLowerCase() === U.toLowerCase();
  const passBuf = Buffer.from(pass || '');
  const realBuf = Buffer.from(P);
  const passOk = passBuf.length === realBuf.length && crypto.timingSafeEqual(passBuf, realBuf);

  if (userOk && passOk) {
    const token = sign({ sub: U, exp: Date.now() + TTL_MS });
    return res.json({ token, expiresIn: TTL_MS });
  }
  return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
}

// Middleware: exige um crachá válido
function requireAdmin(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const payload = verify(token);
  if (!payload) return res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
  req.admin = payload;
  next();
}

module.exports = { login, requireAdmin, verify, sign };
