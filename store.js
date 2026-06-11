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

function gerarNumeros(qty) {
  // Gera números de títulos. Em produção, isso vem de uma faixa
  // controlada no banco para garantir unicidade por rifa.
  const out = [];
  for (let i = 0; i < qty; i++) {
    out.push(String(Math.floor(Math.random() * 9999999)).padStart(7, '0'));
  }
  return out;
}

function criarPedido({ externalId, qty, amount, payer }) {
  const pedido = {
    externalId,
    qty,
    amount,
    payer,
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
  return pedido;
}

module.exports = {
  criarPedido, vincularTransacao, acharPorExternal,
  acharPorTransacao, marcarPago, gerarNumeros,
};
