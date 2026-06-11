/* ============================================================
   TURBO PRÊMIOS — Banco de dados (PostgreSQL)
   --------------------------------------------------------------
   Guarda os pedidos PERMANENTEMENTE. Usado automaticamente
   quando a variável DATABASE_URL está definida (ex.: Neon).
   Mesma interface do store.js, porém persistente.
   ============================================================ */
const { Pool } = require('pg');
const crypto = require('crypto');

const COMMISSION_RATE = Number(process.env.COMMISSION_RATE || 0.30);

function randomPassword(n = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz';
  let s = ''; const b = crypto.randomBytes(n);
  for (let i = 0; i < n; i++) s += chars[b[i] % chars.length];
  return s;
}
function makeCode(name) {
  const base = (name || 'AF').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'AF';
  return base + crypto.randomBytes(2).toString('hex').toUpperCase();
}

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
    raffleId: r.raffle_id,
    raffleName: r.raffle_name,
    qty: r.qty,
    amount: Number(r.amount),
    payer: { name: r.payer_name, document: r.payer_doc, email: r.payer_email, phone: r.payer_phone },
    status: r.status,
    numbers: r.numbers ? JSON.parse(r.numbers) : [],
    createdAt: r.created_at,
    paidAt: r.paid_at,
  };
}

function rowToRaffle(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    edition: r.edition,
    subtitle: r.subtitle || '',
    altPrize: r.alt_prize || '',
    price: Number(r.price),
    total: r.total,
    sold: r.sold,
    status: r.status,
    featured: r.featured,
    sortOrder: r.sort_order,
    image: r.image || '',
    drawDate: r.draw_date,
  };
}

// Rifas iniciais (semeadas só na primeira vez)
const SEED_RAFFLES = [
  { id:'fan160', name:'10 Motos Fan 160 0km', edition:'#47', subtitle:'10 ganhadores. Escolha levar a moto 0km na garagem ou o valor direto na sua conta.', altPrize:'OU R$ 150 MIL NO PIX', price:0.15, total:2000000, sold:1417300, status:'Ativa', featured:true, sortOrder:0, image:'banner-fan160.png', drawDate:'2026-06-20T20:00:00' },
  { id:'hilux', name:'Toyota Hilux SRX 0km', edition:'#03', subtitle:'ou R$ 280 mil no PIX', altPrize:'ou R$ 280 mil no PIX', price:0.50, total:1000000, sold:620000, status:'Ativa', featured:false, sortOrder:1, image:'banner-hilux.png', drawDate:'2026-07-15T20:00:00' },
  { id:'iphone', name:'5x iPhone 17 Pro Max', edition:'#08', subtitle:'ou R$ 8 mil cada', altPrize:'ou R$ 8 mil cada', price:0.10, total:1000000, sold:880000, status:'Ativa', featured:false, sortOrder:2, image:'banner-iphone.png', drawDate:'2026-06-30T20:00:00' },
  { id:'pix50', name:'R$ 50.000 no PIX', edition:'#12', subtitle:'sorteio relâmpago', altPrize:'na sua conta', price:0.05, total:1000000, sold:410000, status:'Ativa', featured:false, sortOrder:3, image:'banner-pix.png', drawDate:'2026-06-25T20:00:00' },
  { id:'gamer', name:'Setup Gamer Completo', edition:'#01', subtitle:'PC + monitor + cadeira', altPrize:'ou R$ 12 mil no PIX', price:0.08, total:1000000, sold:730000, status:'Pausada', featured:false, sortOrder:4, image:'banner-gamer.png', drawDate:'2026-08-01T20:00:00' },
];

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
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS raffle_id   TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS raffle_name TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_id TEXT;

    CREATE TABLE IF NOT EXISTS affiliates (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT UNIQUE NOT NULL,
      pass        TEXT NOT NULL,
      code        TEXT UNIQUE NOT NULL,
      must_change BOOLEAN NOT NULL DEFAULT true,
      rate        NUMERIC(4,3) NOT NULL DEFAULT 0.30,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_orders_aff ON orders(affiliate_id);

    CREATE TABLE IF NOT EXISTS raffles (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      edition     TEXT,
      subtitle    TEXT,
      alt_prize   TEXT,
      price       NUMERIC(12,2) NOT NULL,
      total       INTEGER NOT NULL DEFAULT 1000000,
      sold        INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'Ativa',
      featured    BOOLEAN NOT NULL DEFAULT false,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      image       TEXT,
      draw_date   TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Semeia as rifas iniciais só se a tabela estiver vazia
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM raffles');
  if (rows[0].n === 0) {
    for (const r of SEED_RAFFLES) {
      await pool.query(
        `INSERT INTO raffles (id,name,edition,subtitle,alt_prize,price,total,sold,status,featured,sort_order,image,draw_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
        [r.id, r.name, r.edition, r.subtitle, r.altPrize, r.price, r.total, r.sold, r.status, r.featured, r.sortOrder, r.image, r.drawDate]
      );
    }
    console.log('🌱 Rifas iniciais semeadas.');
  }
  console.log('🗄️  Banco de dados pronto (PostgreSQL).');
}

/* ---------------- RIFAS ---------------- */
async function listRaffles() {
  // públicas: só ativas, ordenadas
  const { rows } = await pool.query(`SELECT * FROM raffles WHERE status='Ativa' ORDER BY featured DESC, sort_order ASC`);
  return rows.map(rowToRaffle);
}
async function listAllRaffles() {
  const { rows } = await pool.query(`SELECT * FROM raffles ORDER BY featured DESC, sort_order ASC, created_at ASC`);
  return rows.map(rowToRaffle);
}
async function getRaffle(id) {
  const { rows } = await pool.query(`SELECT * FROM raffles WHERE id=$1`, [id]);
  return rowToRaffle(rows[0]);
}
async function createRaffle(r) {
  const id = (r.id && String(r.id)) || ('rifa-' + Date.now());
  const { rows } = await pool.query(
    `INSERT INTO raffles (id,name,edition,subtitle,alt_prize,price,total,sold,status,featured,sort_order,image,draw_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [id, r.name||'Nova rifa', r.edition||'#01', r.subtitle||'', r.altPrize||'', Number(r.price)||0.15,
     parseInt(r.total)||1000000, parseInt(r.sold)||0, r.status||'Ativa', !!r.featured,
     parseInt(r.sortOrder)||99, r.image||'', r.drawDate||null]
  );
  return rowToRaffle(rows[0]);
}
async function updateRaffle(id, r) {
  const { rows } = await pool.query(
    `UPDATE raffles SET name=$2, edition=$3, subtitle=$4, alt_prize=$5, price=$6,
       total=$7, sold=$8, status=$9, featured=$10, sort_order=$11, image=$12, draw_date=$13
     WHERE id=$1 RETURNING *`,
    [id, r.name, r.edition, r.subtitle||'', r.altPrize||'', Number(r.price)||0,
     parseInt(r.total)||0, parseInt(r.sold)||0, r.status||'Ativa', !!r.featured,
     parseInt(r.sortOrder)||0, r.image||'', r.drawDate||null]
  );
  return rowToRaffle(rows[0]);
}

async function criarPedido({ externalId, qty, amount, payer, raffleId, raffleName, affiliateId }) {
  await pool.query(
    `INSERT INTO orders (external_id, qty, amount, payer_name, payer_doc, payer_email, payer_phone, status, raffle_id, raffle_name, affiliate_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9,$10)
     ON CONFLICT (external_id) DO NOTHING`,
    [externalId, qty, amount, payer.name || '', payer.document || '', payer.email || '', payer.phone || '', raffleId || null, raffleName || null, affiliateId || null]
  );
  return { externalId, qty, amount, payer, raffleId, raffleName, affiliateId, status: 'PENDING', numbers: [] };
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
  if (rows[0]) {
    // incrementa os títulos vendidos da rifa correspondente
    if (rows[0].raffle_id) {
      try { await pool.query(`UPDATE raffles SET sold = sold + $2 WHERE id=$1`, [rows[0].raffle_id, rows[0].qty]); }
      catch (e) { console.error('Falha ao incrementar sold da rifa:', e.message); }
    }
    return rowToPedido(rows[0]);
  }
  return await acharPorExternal(pedido.externalId); // já estava pago
}

async function listOrders() {
  const { rows } = await pool.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 500`);
  return rows.map((r) => ({
    externalId: r.external_id,
    name: r.payer_name || 'Cliente',
    document: r.payer_doc || '',
    raffleName: r.raffle_name || '',
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

/* ---------------- AFILIADOS ---------------- */
async function createAffiliate({ name, email }) {
  const id = 'aff-' + Date.now().toString(36);
  const password = randomPassword(8);
  let code = makeCode(name);
  // garante código único
  for (let i = 0; i < 5; i++) {
    const { rows } = await pool.query('SELECT 1 FROM affiliates WHERE code=$1', [code]);
    if (!rows[0]) break;
    code = makeCode(name);
  }
  await pool.query(
    `INSERT INTO affiliates (id,name,email,pass,code,must_change,rate) VALUES ($1,$2,$3,$4,$5,true,$6)`,
    [id, name, email.toLowerCase(), password, code, COMMISSION_RATE]
  );
  // devolve a senha em texto puro UMA vez (para o admin enviar ao afiliado)
  return { id, name, email: email.toLowerCase(), code, password, rate: COMMISSION_RATE };
}

async function listAffiliates() {
  const { rows } = await pool.query(`SELECT * FROM affiliates ORDER BY created_at DESC`);
  const out = [];
  for (const a of rows) {
    const st = await affiliateStats(a.id);
    out.push({ id:a.id, name:a.name, email:a.email, code:a.code, rate:Number(a.rate),
      mustChange:a.must_change, createdAt:a.created_at, ...st });
  }
  return out;
}

async function affiliateByEmail(email) {
  const { rows } = await pool.query(`SELECT * FROM affiliates WHERE email=$1`, [(email||'').toLowerCase()]);
  return rows[0] || null;
}
async function affiliateById(id) {
  const { rows } = await pool.query(`SELECT * FROM affiliates WHERE id=$1`, [id]);
  return rows[0] || null;
}
async function affiliateByCode(code) {
  if (!code) return null;
  const { rows } = await pool.query(`SELECT * FROM affiliates WHERE code=$1`, [code]);
  return rows[0] || null;
}
async function changeAffiliatePassword(id, newPass) {
  await pool.query(`UPDATE affiliates SET pass=$2, must_change=false WHERE id=$1`, [id, newPass]);
}
async function resetAffiliatePassword(id) {
  const password = randomPassword(8);
  await pool.query(`UPDATE affiliates SET pass=$2, must_change=true WHERE id=$1`, [id, password]);
  return password;
}

// estatísticas reais do afiliado (apenas pedidos PAGOS atribuídos a ele)
async function affiliateStats(id) {
  const { rows } = await pool.query(`
    SELECT
      COUNT(DISTINCT payer_doc) FILTER (WHERE status='COMPLETED')  AS clients,
      COALESCE(SUM(qty)    FILTER (WHERE status='COMPLETED'),0)     AS titles,
      COALESCE(SUM(amount) FILTER (WHERE status='COMPLETED'),0)     AS revenue
    FROM orders WHERE affiliate_id=$1
  `, [id]);
  const r = rows[0];
  const aff = await affiliateById(id);
  const rate = aff ? Number(aff.rate) : COMMISSION_RATE;
  const revenue = Number(r.revenue);
  return {
    clients: Number(r.clients),
    titles: Number(r.titles),
    revenue: Number(revenue.toFixed(2)),
    commission: Number((revenue * rate).toFixed(2)),
    rate,
  };
}

module.exports = {
  init, criarPedido, vincularTransacao, acharPorExternal,
  acharPorTransacao, marcarPago, listOrders, metrics, gerarNumeros,
  listRaffles, listAllRaffles, getRaffle, createRaffle, updateRaffle,
  createAffiliate, listAffiliates, affiliateByEmail, affiliateById,
  affiliateByCode, changeAffiliatePassword, resetAffiliatePassword, affiliateStats,
};
