/* ============================================================
   TURBO PRÊMIOS — Backend de pagamentos (VeoPag PIX)
   --------------------------------------------------------------
   Endpoints expostos ao site:
     POST /api/pix/criar          -> cria a cobrança e devolve o QR
     GET  /api/pix/status/:txId   -> o site consulta se já foi pago
     POST /webhooks/veopag        -> a VeoPag avisa quando o PIX cai
     GET  /health                 -> teste de vida
   ============================================================ */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const veopag = require('./veopag');
const store = require('./store');
const auth = require('./auth');

const app = express();
app.use(express.json());

// CORS: libere apenas o domínio do seu site em produção.
const ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: ORIGIN }));

const PRICE_PER_TITLE = Number(process.env.PRICE_PER_TITLE || 0.15);
const PUBLIC_URL = process.env.PUBLIC_URL || ''; // ex.: https://api.turbopremios.com.br

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

/* ============================================================
   PAINEL ADMIN (autenticação no servidor)
   ============================================================ */
// Login: devolve um token (cracha) se usuário/senha conferem com as
// variáveis de ambiente ADMIN_USER / ADMIN_PASS definidas no Render.
app.post('/api/admin/login', auth.login);

// Verifica se o cracha ainda é válido (o painel chama ao abrir).
app.get('/api/admin/me', auth.requireAdmin, (_req, res) => res.json({ ok: true }));

// Dados REAIS do painel (protegidos pelo cracha).
app.get('/api/admin/metrics', auth.requireAdmin, (_req, res) => res.json(store.metrics()));
app.get('/api/admin/orders', auth.requireAdmin, (_req, res) => res.json(store.listOrders()));

/* ---------- 1) Criar cobrança PIX ---------- */
app.post('/api/pix/criar', async (req, res) => {
  try {
    const { qty, amount, payer } = req.body || {};
    if (!qty || !payer || !payer.name || !payer.document) {
      return res.status(400).json({ error: 'Dados incompletos.' });
    }

    // Recalcula o valor no servidor (NUNCA confie no valor vindo do front).
    const valor = Number((Number(qty) * PRICE_PER_TITLE).toFixed(2));
    if (amount != null && Math.abs(Number(amount) - valor) > 0.001) {
      // valor divergente — usamos o do servidor mesmo assim
      console.warn('Valor do front difere do servidor:', amount, valor);
    }

    const externalId = `order-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    store.criarPedido({ externalId, qty: Number(qty), amount: valor, payer });

    const callbackUrl = PUBLIC_URL ? `${PUBLIC_URL}/webhooks/veopag` : undefined;

    const dep = await veopag.criarDeposito({
      amount: valor,
      externalId,
      callbackUrl,
      payer,
    });

    store.vincularTransacao(externalId, dep.transactionId);

    res.json({
      transactionId: dep.transactionId,
      externalId,
      qrcode: dep.qrcode,     // copia e cola
      qrImage: dep.qrImage,   // dataURL PNG (pronto pra <img src>)
      amount: valor,
      status: dep.status,     // PENDING
    });
  } catch (e) {
    const detail = e.response ? e.response.data : e.message;
    console.error('Erro ao criar PIX:', detail);
    res.status(502).json({ error: 'Não foi possível gerar o PIX agora.' });
  }
});

/* ---------- 2) Status (o site faz polling aqui) ---------- */
app.get('/api/pix/status/:txId', async (req, res) => {
  const pedido = store.acharPorTransacao(req.params.txId);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado.' });

  // Se o webhook ainda não chegou, tenta reconciliar consultando a VeoPag.
  if (pedido.status !== 'COMPLETED') {
    try {
      const info = await veopag.consultarDeposito({ transactionId: pedido.transactionId });
      const st = (info && (info.status || (info.data && info.data.status) || '')).toString().toUpperCase();
      if (st === 'COMPLETED' || st === 'PAID' || st === 'APPROVED') {
        store.marcarPago(pedido);
      }
    } catch (_) { /* ignora; o site tenta de novo no próximo polling */ }
  }

  res.json({
    status: pedido.status,                    // PENDING | COMPLETED
    paid: pedido.status === 'COMPLETED',
    numbers: pedido.status === 'COMPLETED' ? pedido.numbers : [],
    qty: pedido.qty,
  });
});

/* ---------- 3) Webhook da VeoPag ---------- */
/* A VeoPag faz POST aqui quando o status muda (type=Deposit, status=COMPLETED).
   Handler defensivo: aceita diferentes nomes de campo. Confirme o formato
   exato na doc "Webhooks" da VeoPag e ajuste se necessário.
   ⚠️ Em produção, valide a autenticidade (assinatura/segredo ou IP whitelist). */
app.post('/webhooks/veopag', (req, res) => {
  const b = req.body || {};
  const type = (b.type || b.transaction_type || '').toString().toLowerCase();
  const status = (b.status || (b.data && b.data.status) || '').toString().toUpperCase();
  const txId = b.transactionId || b.transaction_id || (b.data && (b.data.transactionId || b.data.transaction_id));
  const externalId = b.external_id || (b.data && b.data.external_id);

  // responde rápido pra VeoPag não reenviar
  res.json({ received: true });

  const isDeposit = !type || type.includes('deposit');
  const isPaid = ['COMPLETED', 'PAID', 'APPROVED'].includes(status);
  if (!isDeposit || !isPaid) return;

  const pedido = (txId && store.acharPorTransacao(txId)) ||
                 (externalId && store.acharPorExternal(externalId));
  if (pedido) {
    store.marcarPago(pedido);
    console.log(`✅ Pedido pago: ${pedido.externalId} (${pedido.qty} títulos)`);
    // TODO: aqui você dispara e-mail/WhatsApp de confirmação ao cliente.
  } else {
    console.warn('Webhook recebido sem pedido correspondente:', txId, externalId);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Turbo Prêmios ouvindo na porta ${PORT}`));
