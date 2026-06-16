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
const auth = require('./auth');
// Usa banco de dados (PostgreSQL) se DATABASE_URL existir; senão, memória.
const repo = process.env.DATABASE_URL ? require('./db') : require('./store');
console.log(process.env.DATABASE_URL ? '\u2713 Persist\u00eancia: PostgreSQL' : '\u26a0 Persist\u00eancia: MEM\u00d3RIA (dados se perdem ao reiniciar)');

const app = express();
app.use(express.json());

// CORS: libere apenas o domínio do seu site em produção.
const ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: ORIGIN }));

const PRICE_PER_TITLE = Number(process.env.PRICE_PER_TITLE || 0.15);
const PUBLIC_URL = process.env.PUBLIC_URL || ''; // ex.: https://api.turbopremios.com.br

app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

/* ============================================================
   RIFAS — públicas (o site monta a home a partir daqui)
   ============================================================ */
app.get('/api/raffles', async (_req, res) => {
  try { res.json(await repo.listRaffles()); }
  catch (e) { console.error('raffles:', e.message); res.status(500).json({ error: 'Erro ao listar rifas.' }); }
});
app.get('/api/raffles/:id', async (req, res) => {
  try {
    const r = await repo.getRaffle(req.params.id);
    if (!r) return res.status(404).json({ error: 'Rifa não encontrada.' });
    res.json(r);
  } catch (e) { res.status(500).json({ error: 'Erro.' }); }
});

/* ============================================================
   PAINEL ADMIN (autenticação no servidor)
   ============================================================ */
// Login: devolve um token (cracha) se usuário/senha conferem com as
// variáveis de ambiente ADMIN_USER / ADMIN_PASS definidas no Render.
app.post('/api/admin/login', auth.login);

// Verifica se o cracha ainda é válido (o painel chama ao abrir).
app.get('/api/admin/me', auth.requireAdmin, (_req, res) => res.json({ ok: true }));

// Dados REAIS do painel (protegidos pelo cracha).
app.get('/api/admin/metrics', auth.requireAdmin, async (_req, res) => {
  try { res.json(await repo.metrics()); }
  catch (e) { console.error('metrics:', e.message); res.status(500).json({ error: 'Erro ao ler métricas.' }); }
});
app.get('/api/admin/orders', auth.requireAdmin, async (_req, res) => {
  try { res.json(await repo.listOrders()); }
  catch (e) { console.error('orders:', e.message); res.status(500).json({ error: 'Erro ao ler pedidos.' }); }
});

// Clientes: TODOS os cadastrados no site + compradores, com estatísticas.
app.get('/api/admin/customers', auth.requireAdmin, async (_req, res) => {
  try { res.json(repo.listCustomers ? await repo.listCustomers() : []); }
  catch (e) { console.error('customers:', e.message); res.status(500).json({ error: 'Erro ao ler clientes.' }); }
});

// Gestão de rifas (protegida) — o admin cria/edita e reflete no site.
app.get('/api/admin/raffles', auth.requireAdmin, async (_req, res) => {
  try { res.json(await repo.listAllRaffles()); }
  catch (e) { console.error('admin raffles:', e.message); res.status(500).json({ error: 'Erro ao listar rifas.' }); }
});
app.post('/api/admin/raffles', auth.requireAdmin, async (req, res) => {
  try { res.json(await repo.createRaffle(req.body || {})); }
  catch (e) { console.error('criar rifa:', e.message); res.status(500).json({ error: 'Erro ao criar rifa.' }); }
});
app.put('/api/admin/raffles/:id', auth.requireAdmin, async (req, res) => {
  try {
    const r = await repo.updateRaffle(req.params.id, req.body || {});
    if (!r) return res.status(404).json({ error: 'Rifa não encontrada.' });
    res.json(r);
  } catch (e) { console.error('editar rifa:', e.message); res.status(500).json({ error: 'Erro ao salvar rifa.' }); }
});

/* ---- Afiliados (gestão pelo admin) ---- */
app.get('/api/admin/affiliates', auth.requireAdmin, async (_req, res) => {
  try { res.json(await repo.listAffiliates()); }
  catch (e) { console.error('afiliados:', e.message); res.status(500).json({ error: 'Erro ao listar afiliados.' }); }
});
app.post('/api/admin/affiliates', auth.requireAdmin, async (req, res) => {
  try {
    const { name, email, parentCode } = req.body || {};
    if (!name || !email || !/\S+@\S+\.\S+/.test(email)) return res.status(400).json({ error: 'Informe nome e e-mail válidos.' });
    if (repo.affiliateByEmail && await repo.affiliateByEmail(email)) return res.status(409).json({ error: 'Já existe um afiliado com este e-mail.' });
    let parentId = null;
    if (parentCode && repo.affiliateByCode) { try { const p = await repo.affiliateByCode(String(parentCode).trim()); if (p) parentId = p.id; } catch(_){} }
    const aff = await repo.createAffiliate({ name, email, parentId });
    res.json(aff); // inclui a senha gerada (mostrar UMA vez)
  } catch (e) { console.error('criar afiliado:', e.message); res.status(500).json({ error: 'Erro ao criar afiliado.' }); }
});
app.post('/api/admin/affiliates/:id/reset', auth.requireAdmin, async (req, res) => {
  try { const password = await repo.resetAffiliatePassword(req.params.id); res.json({ password }); }
  catch (e) { res.status(500).json({ error: 'Erro ao redefinir senha.' }); }
});

/* ---- Saques (gestão pelo admin) ---- */
app.get('/api/admin/withdrawals', auth.requireAdmin, async (_req, res) => {
  try { res.json(repo.listAllWithdrawals ? await repo.listAllWithdrawals() : []); }
  catch (e) { console.error('saques admin:', e.message); res.status(500).json({ error: 'Erro ao listar saques.' }); }
});

/* ---- Cotas premiadas (relatório admin) ---- */
app.get('/api/admin/prizes', auth.requireAdmin, async (_req, res) => {
  try { res.json({ summary: repo.prizeSummary ? await repo.prizeSummary() : [], awards: repo.listPrizeAwards ? await repo.listPrizeAwards() : [] }); }
  catch (e) { console.error('cotas premiadas admin:', e.message); res.status(500).json({ error: 'Erro ao listar cotas premiadas.' }); }
});
app.post('/api/admin/withdrawals/:id/status', auth.requireAdmin, async (req, res) => {
  try {
    const { status } = req.body || {};
    const w = await repo.updateWithdrawalStatus(req.params.id, status);
    if (!w) return res.status(404).json({ error: 'Saque não encontrado.' });
    res.json(w);
  } catch (e) { res.status(500).json({ error: 'Erro ao atualizar saque.' }); }
});

/* ---- Painel do afiliado (login próprio) ---- */
app.post('/api/affiliate/login', async (req, res) => {
  try {
    const { email, pass } = req.body || {};
    const aff = await repo.affiliateByEmail(email || '');
    if (!aff || aff.pass !== pass) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    const token = auth.signAffiliate(aff.id);
    res.json({ token, mustChange: aff.must_change, name: aff.name, code: aff.code });
  } catch (e) { console.error('login afiliado:', e.message); res.status(500).json({ error: 'Erro no login.' }); }
});
app.post('/api/affiliate/change-password', auth.requireAffiliate, async (req, res) => {
  try {
    const { newPass } = req.body || {};
    if (!newPass || String(newPass).length < 6) return res.status(400).json({ error: 'A nova senha deve ter ao menos 6 caracteres.' });
    await repo.changeAffiliatePassword(req.affiliateId, String(newPass));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Erro ao trocar a senha.' }); }
});
app.get('/api/affiliate/me', auth.requireAffiliate, async (req, res) => {
  try {
    const aff = await repo.affiliateById(req.affiliateId);
    if (!aff) return res.status(404).json({ error: 'Afiliado não encontrado.' });
    const stats = await repo.affiliateStats(aff.id);
    const bal = repo.affiliateBalance ? await repo.affiliateBalance(aff.id) : {};
    res.json({ name: aff.name, code: aff.code, mustChange: aff.must_change, ...stats, ...bal });
  } catch (e) { console.error('me afiliado:', e.message); res.status(500).json({ error: 'Erro ao carregar dados.' }); }
});

/* ---- Saques do afiliado (PIX) ---- */
app.get('/api/affiliate/withdrawals', auth.requireAffiliate, async (req, res) => {
  try { res.json(repo.listWithdrawals ? await repo.listWithdrawals(req.affiliateId) : []); }
  catch (e) { console.error('saques:', e.message); res.status(500).json({ error: 'Erro ao listar saques.' }); }
});
app.post('/api/affiliate/withdrawals', auth.requireAffiliate, async (req, res) => {
  try {
    const { holderName, holderDoc, pixKeyType, pixKey, amount } = req.body || {};
    const w = await repo.createWithdrawal(req.affiliateId, { holderName, holderDoc, pixKeyType, pixKey, amount });
    res.json(w);
  } catch (e) { res.status(400).json({ error: e.message || 'Não foi possível solicitar o saque.' }); }
});

/* ---- Sub-afiliados (2º nível): auto-cadastro + rede de indicados ---- */
app.post('/api/affiliate/register', async (req, res) => {
  try {
    if (!repo.registerAffiliate) return res.status(400).json({ error: 'Indisponível.' });
    const { name, email, pass, parentCode } = req.body || {};
    const aff = await repo.registerAffiliate({ name, email, pass, parentCode });
    const token = auth.signAffiliate(aff.id);
    res.json({ token, code: aff.code });
  } catch (e) { res.status(400).json({ error: e.message || 'Não foi possível cadastrar.' }); }
});
app.get('/api/affiliate/network', auth.requireAffiliate, async (req, res) => {
  try { res.json(repo.level2Stats ? await repo.level2Stats(req.affiliateId) : { subs:[], subCount:0, subRevenue:0, level2Commission:0, level2Rate:0.20 }); }
  catch (e) { console.error('rede afiliado:', e.message); res.status(500).json({ error: 'Erro ao carregar indicados.' }); }
});

/* ---- Saldo/prêmios do cliente (cotas premiadas) ---- */
app.get('/api/customer/:cpf/summary', async (req, res) => {
  try { res.json(repo.customerSummary ? await repo.customerSummary(req.params.cpf) : { balance:0, prizesWon:0, prizes:[] }); }
  catch (e) { res.status(500).json({ error: 'Erro ao carregar saldo.' }); }
});

/* ============================================================
   CADASTRO DE CLIENTE (público) — o site salva quem cria conta
   ============================================================ */
app.post('/api/register', async (req, res) => {
  try {
    const { name, cpf, phone, email, affiliateCode } = req.body || {};
    if (!name || !cpf) return res.status(400).json({ error: 'Nome e CPF são obrigatórios.' });
    let affiliateId = null;
    if (affiliateCode && repo.affiliateByCode) {
      try { const aff = await repo.affiliateByCode(String(affiliateCode).trim()); if (aff) affiliateId = aff.id; } catch (_) {}
    }
    if (repo.registerCustomer) await repo.registerCustomer({ name, cpf, phone, email, affiliateId });
    res.json({ ok: true });
  } catch (e) { console.error('register:', e.message); res.status(500).json({ error: 'Erro ao cadastrar.' }); }
});

/* ---------- 1) Criar cobrança PIX ---------- */
app.post('/api/pix/criar', async (req, res) => {
  try {
    const { qty, amount, payer, raffleId, affiliateCode } = req.body || {};
    if (!qty || !payer || !payer.name || !payer.document) {
      return res.status(400).json({ error: 'Dados incompletos.' });
    }

    // Descobre o preço pela RIFA escolhida (nunca confia no valor do front).
    let preco = PRICE_PER_TITLE;
    let raffleName = null;
    if (raffleId && repo.getRaffle) {
      const rifa = await repo.getRaffle(raffleId);
      if (!rifa) return res.status(404).json({ error: 'Rifa não encontrada.' });
      if (rifa.status !== 'Ativa') return res.status(400).json({ error: 'Esta rifa não está disponível no momento.' });
      preco = Number(rifa.price);
      raffleName = rifa.name;
    }
    const valor = Number((Number(qty) * preco).toFixed(2));

    // Atribuição ao afiliado (pelo código de indicação), se houver.
    let affiliateId = null;
    if (affiliateCode && repo.affiliateByCode) {
      try { const aff = await repo.affiliateByCode(String(affiliateCode).trim()); if (aff) affiliateId = aff.id; }
      catch (_) {}
    }

    const externalId = `order-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await repo.criarPedido({ externalId, qty: Number(qty), amount: valor, payer, raffleId: raffleId || null, raffleName, affiliateId });
    // registra/atualiza o cliente (aparece no painel mesmo antes de pagar)
    if (repo.registerCustomer) {
      try { await repo.registerCustomer({ name: payer.name, cpf: payer.document, phone: payer.phone, email: payer.email, affiliateId }); } catch (_) {}
    }

    const callbackUrl = PUBLIC_URL ? `${PUBLIC_URL}/webhooks/veopag` : undefined;

    const dep = await veopag.criarDeposito({
      amount: valor,
      externalId,
      callbackUrl,
      payer,
    });

    await repo.vincularTransacao(externalId, dep.transactionId);

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
  let pedido = await repo.acharPorTransacao(req.params.txId);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado.' });

  // Se o webhook ainda não chegou, tenta reconciliar consultando a VeoPag.
  if (pedido.status !== 'COMPLETED') {
    try {
      const info = await veopag.consultarDeposito({ transactionId: pedido.transactionId });
      const st = (info && (info.status || (info.data && info.data.status) || '')).toString().toUpperCase();
      if (st === 'COMPLETED' || st === 'PAID' || st === 'APPROVED') {
        pedido = await repo.marcarPago(pedido);
      }
    } catch (_) { /* ignora; o site tenta de novo no próximo polling */ }
  }

  let balance = 0; let prizes = [];
  if (pedido.status === 'COMPLETED') {
    prizes = pedido.prizes || [];
    try { if (repo.customerSummary) { const cs = await repo.customerSummary((pedido.payer && pedido.payer.document) || ''); balance = cs.balance; } } catch (_) {}
  }
  res.json({
    status: pedido.status,                    // PENDING | COMPLETED
    paid: pedido.status === 'COMPLETED',
    numbers: pedido.status === 'COMPLETED' ? pedido.numbers : [],
    qty: pedido.qty,
    prizes,                                   // cotas premiadas ganhas neste pedido
    balance,                                  // saldo/crédito atual do cliente
  });
});

/* ---------- 3) Webhook da VeoPag ---------- */
/* A VeoPag faz POST aqui quando o status muda (type=Deposit, status=COMPLETED).
   Handler defensivo: aceita diferentes nomes de campo. Confirme o formato
   exato na doc "Webhooks" da VeoPag e ajuste se necessário.
   ⚠️ Em produção, valide a autenticidade (assinatura/segredo ou IP whitelist). */
app.post('/webhooks/veopag', async (req, res) => {
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

  try {
    const pedido = (txId && await repo.acharPorTransacao(txId)) ||
                   (externalId && await repo.acharPorExternal(externalId));
    if (pedido) {
      await repo.marcarPago(pedido);
      console.log(`✅ Pedido pago: ${pedido.externalId} (${pedido.qty} títulos)`);
      // TODO: aqui você dispara e-mail/WhatsApp de confirmação ao cliente.
    } else {
      console.warn('Webhook recebido sem pedido correspondente:', txId, externalId);
    }
  } catch (e) { console.error('Erro no webhook:', e.message); }
});

const PORT = process.env.PORT || 3000;
async function start() {
  try { if (repo.init) await repo.init(); }
  catch (e) { console.error('Falha ao iniciar o banco:', e.message); }
  app.listen(PORT, () => console.log(`Backend Turbo Prêmios ouvindo na porta ${PORT}`));
}
start();
