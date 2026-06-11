/* ============================================================
   TURBO PRÊMIOS — Banco de dados (PostgreSQL)
   --------------------------------------------------------------
   Guarda os pedidos PERMANENTEMENTE. Usado automaticamente
   quando a variável DATABASE_URL está definida (ex.: Neon).
   Mesma interface do store.js, porém persistente.
   ============================================================ */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon/Render exigem SSL
  max: 5,
});

function gerarNumeros(qty) {
  const out = [];
  for (let i = 0; i < qty; i++) out.push(String(Math.floor(Math.random() * 9999999)).padStart(7, '0'));
  return out;
}

function rowToPedido(r) {
  if (!r) return null;
  return {
    externalId: r.external_id,
    transactionId: r.transaction_id,
    qty: r.qty,
    amount: Number(r.amount),
    payer: { name: r.payer_name, document: r.payer_doc, email: r.payer_email, phone: r.payer_phone },
    status: r.status,
    numbers: r.numbers ? JSON.parse(r.numbers) : [],
    createdAt: r.created_at,
    paidAt: r.paid_at,
  };
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      external_id    TEXT PRIMARY KEY,
      transaction_id TEXT,
      qty            INTEGER NOT NULL,
      amount         NUMERIC(12,2) NOT NULL,
      payer_name     TEXT,
      payer_doc      TEXT,
      payer_email    TEXT,
      payer_phone    TEXT,
      status         TEXT NOT NULL DEFAULT 'PENDING',
      numbers        TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at        TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_orders_tx ON orders(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  `);
  console.log('🗄️  Banco de dados pronto (PostgreSQL).');
}

async function criarPedido({ externalId, qty, amount, payer }) {
  await pool.query(
    `INSERT INTO orders (external_id, qty, amount, payer_name, payer_doc, payer_email, payer_phone, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING')
     ON CONFLICT (external_id) DO NOTHING`,
    [externalId, qty, amount, payer.name || '', payer.document || '', payer.email || '', payer.phone || '']
  );
  return { externalId, qty, amount, payer, status: 'PENDING', numbers: [] };
}

async function vincularTransacao(externalId, transactionId) {
  await pool.query(`UPDATE orders SET transaction_id=$2 WHERE external_id=$1`, [externalId, transactionId]);
}

async function acharPorExternal(externalId) {
  const { rows } = await pool.query(`SELECT * FROM orders WHERE external_id=$1`, [externalId]);
  return rowToPedido(rows[0]);
}

async function acharPorTransacao(transactionId) {
  const { rows } = await pool.query(`SELECT * FROM orders WHERE transaction_id=$1`, [transactionId]);
  return rowToPedido(rows[0]);
}

async function marcarPago(pedido) {
  if (!pedido) return null;
  if (pedido.status === 'COMPLETED') return pedido;
  const numbers = (pedido.numbers && pedido.numbers.length) ? pedido.numbers : gerarNumeros(pedido.qty);
  const { rows } = await pool.query(
    `UPDATE orders SET status='COMPLETED', paid_at=now(), numbers=$2
     WHERE external_id=$1 AND status <> 'COMPLETED'
     RETURNING *`,
    [pedido.externalId, JSON.stringify(numbers)]
  );
  if (rows[0]) return rowToPedido(rows[0]);
  return await acharPorExternal(pedido.externalId); // já estava pago
}

async function listOrders() {
  const { rows } = await pool.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 500`);
  return rows.map((r) => ({
    externalId: r.external_id,
    name: r.payer_name || 'Cliente',
    document: r.payer_doc || '',
    qty: r.qty,
    amount: Number(r.amount),
    status: r.status,
    createdAt: r.created_at,
    paidAt: r.paid_at,
  }));
}

async function metrics() {
  const q = await pool.query(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE status='COMPLETED'),0)                                            AS receita_total,
      COALESCE(SUM(amount) FILTER (WHERE status='COMPLETED' AND paid_at::date = now()::date),0)            AS receita_hoje,
      COALESCE(SUM(qty)    FILTER (WHERE status='COMPLETED'),0)                                            AS titulos_vendidos,
      COUNT(*)             FILTER (WHERE status='COMPLETED')                                               AS pedidos_pagos,
      COUNT(*)                                                                                             AS pedidos_total,
      COUNT(*)             FILTER (WHERE status='PENDING')                                                 AS pendentes
    FROM orders
  `);
  const r = q.rows[0];
  return {
    receitaTotal: Number(r.receita_total),
    receitaHoje: Number(r.receita_hoje),
    titulosVendidos: Number(r.titulos_vendidos),
    pedidosPagos: Number(r.pedidos_pagos),
    pedidosTotal: Number(r.pedidos_total),
    pendentes: Number(r.pendentes),
  };
}

module.exports = {
  init, criarPedido, vincularTransacao, acharPorExternal,
  acharPorTransacao, marcarPago, listOrders, metrics, gerarNumeros,
};
