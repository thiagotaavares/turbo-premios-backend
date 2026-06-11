/* ============================================================
   Armazenamento de pedidos.
   --------------------------------------------------------------
   ⚠️ Implementação em MEMÓRIA — apenas para começar/testar.
   Em produção, troque por um banco de verdade (PostgreSQL, MySQL,
   MongoDB...). Se o servidor reiniciar, os pedidos aqui se perdem.
   Mantemos a mesma interface (criarPedido/acharPorTx/marcarPago)
   para a troca ser simples.
   ============================================================ */

const pedidos = new Map();        // external_id -> pedido
const porTransacao = new Map();   // transactionId -> external_id

// Rifas em memória (mesma semente do db.js)
const raffles = [
  { id:'fan160', name:'10 Motos Fan 160 0km', edition:'#47', subtitle:'10 ganhadores. Escolha levar a moto 0km na garagem ou o valor direto na sua conta.', altPrize:'OU R$ 150 MIL NO PIX', price:0.15, total:2000000, sold:1417300, status:'Ativa', featured:true, sortOrder:0, image:'banner-fan160.png', drawDate:'2026-06-20T20:00:00' },
  { id:'hilux', name:'Toyota Hilux SRX 0km', edition:'#03', subtitle:'ou R$ 280 mil no PIX', altPrize:'ou R$ 280 mil no PIX', price:0.50, total:1000000, sold:620000, status:'Ativa', featured:false, sortOrder:1, image:'banner-hilux.png', drawDate:'2026-07-15T20:00:00' },
  { id:'iphone', name:'5x iPhone 17 Pro Max', edition:'#08', subtitle:'ou R$ 8 mil cada', altPrize:'ou R$ 8 mil cada', price:0.10, total:1000000, sold:880000, status:'Ativa', featured:false, sortOrder:2, image:'banner-iphone.png', drawDate:'2026-06-30T20:00:00' },
  { id:'pix50', name:'R$ 50.000 no PIX', edition:'#12', subtitle:'sorteio relâmpago', altPrize:'na sua conta', price:0.05, total:1000000, sold:410000, status:'Ativa', featured:false, sortOrder:3, image:'banner-pix.png', drawDate:'2026-06-25T20:00:00' },
  { id:'gamer', name:'Setup Gamer Completo', edition:'#01', subtitle:'PC + monitor + cadeira', altPrize:'ou R$ 12 mil no PIX', price:0.08, total:1000000, sold:730000, status:'Pausada', featured:false, sortOrder:4, image:'banner-gamer.png', drawDate:'2026-08-01T20:00:00' },
];

function gerarNumeros(qty) {
  // Gera números de títulos. Em produção, isso vem de uma faixa
  // controlada no banco para garantir unicidade por rifa.
  const out = [];
  for (let i = 0; i < qty; i++) {
    out.push(String(Math.floor(Math.random() * 9999999)).padStart(7, '0'));
  }
  return out;
}

function criarPedido({ externalId, qty, amount, payer, raffleId, raffleName }) {
  const pedido = {
    externalId,
    qty,
    amount,
    payer,
    raffleId: raffleId || null,
    raffleName: raffleName || null,
    status: 'PENDING',
    transactionId: null,
    numbers: [],
    createdAt: new Date().toISOString(),
    paidAt: null,
  };
  pedidos.set(externalId, pedido);
  return pedido;
}

function vincularTransacao(externalId, transactionId) {
  const p = pedidos.get(externalId);
  if (!p) return;
  p.transactionId = transactionId;
  porTransacao.set(transactionId, externalId);
}

function acharPorExternal(externalId) {
  return pedidos.get(externalId) || null;
}

function acharPorTransacao(transactionId) {
  const ext = porTransacao.get(transactionId);
  return ext ? pedidos.get(ext) : null;
}

function marcarPago(pedido) {
  if (pedido.status === 'COMPLETED') return pedido; // idempotente
  pedido.status = 'COMPLETED';
  pedido.paidAt = new Date().toISOString();
  if (!pedido.numbers.length) pedido.numbers = gerarNumeros(pedido.qty);
  if (pedido.raffleId) {
    const rf = raffles.find((r) => r.id === pedido.raffleId);
    if (rf) rf.sold += pedido.qty;
  }
  return pedido;
}

/* ---- Rifas ---- */
function listRaffles() { return raffles.filter((r) => r.status === 'Ativa').sort((a,b)=> (b.featured-a.featured) || (a.sortOrder-b.sortOrder)); }
function listAllRaffles() { return raffles.slice().sort((a,b)=> (b.featured-a.featured) || (a.sortOrder-b.sortOrder)); }
function getRaffle(id) { return raffles.find((r) => r.id === id) || null; }
function createRaffle(r) {
  const nova = { id: r.id || ('rifa-'+Date.now()), name:r.name||'Nova rifa', edition:r.edition||'#01', subtitle:r.subtitle||'', altPrize:r.altPrize||'', price:Number(r.price)||0.15, total:parseInt(r.total)||1000000, sold:parseInt(r.sold)||0, status:r.status||'Ativa', featured:!!r.featured, sortOrder:parseInt(r.sortOrder)||99, image:r.image||'', drawDate:r.drawDate||null };
  raffles.push(nova);
  return nova;
}
function updateRaffle(id, r) {
  const rf = raffles.find((x) => x.id === id);
  if (!rf) return null;
  Object.assign(rf, { name:r.name, edition:r.edition, subtitle:r.subtitle||'', altPrize:r.altPrize||'', price:Number(r.price)||0, total:parseInt(r.total)||0, sold:parseInt(r.sold)||0, status:r.status||'Ativa', featured:!!r.featured, sortOrder:parseInt(r.sortOrder)||0, image:r.image||'', drawDate:r.drawDate||null });
  return rf;
}

// ---- Leitura para o painel admin ----
function listOrders() {
  return Array.from(pedidos.values())
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((p) => ({
      externalId: p.externalId,
      name: (p.payer && p.payer.name) || 'Cliente',
      document: (p.payer && p.payer.document) || '',
      raffleName: p.raffleName || '',
      qty: p.qty,
      amount: p.amount,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
    }));
}

function metrics() {
  const all = Array.from(pedidos.values());
  const paid = all.filter((p) => p.status === 'COMPLETED');
  const hoje = new Date().toISOString().slice(0, 10);
  const paidHoje = paid.filter((p) => (p.paidAt || '').slice(0, 10) === hoje);
  return {
    receitaTotal: Number(paid.reduce((s, p) => s + p.amount, 0).toFixed(2)),
    receitaHoje: Number(paidHoje.reduce((s, p) => s + p.amount, 0).toFixed(2)),
    titulosVendidos: paid.reduce((s, p) => s + p.qty, 0),
    pedidosPagos: paid.length,
    pedidosTotal: all.length,
    pendentes: all.filter((p) => p.status === 'PENDING').length,
  };
}

module.exports = {
  criarPedido, vincularTransacao, acharPorExternal,
  acharPorTransacao, marcarPago, gerarNumeros,
  listOrders, metrics,
  listRaffles, listAllRaffles, getRaffle, createRaffle, updateRaffle,
};
