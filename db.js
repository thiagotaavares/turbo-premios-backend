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
const LEVEL2_RATE = Number(process.env.LEVEL2_RATE || 0.20); // 2º nível: % sobre as VENDAS do indicado

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
    prizes: (() => { try { return r.prizes ? JSON.parse(r.prizes) : []; } catch(e){ return []; } })(),
  };
}
function publicRaffle(r){ if(!r) return null; const { prizes, ...rest } = r; return rest; }
function normalizePrizesText(p){ if(!Array.isArray(p)){ try{ p=JSON.parse(p||'[]'); }catch(e){ p=[]; } } if(!Array.isArray(p)) return '[]'; return JSON.stringify(p.map(t=>({ value:Number(t.value)||0, qty:parseInt(t.qty)||0 })).filter(t=>t.value>0&&t.qty>0)); }
function prizePoolFromText(txt){ let cfg=[]; try{ cfg=txt?JSON.parse(txt):[]; }catch(e){ cfg=[]; } const out=[]; for(const t of (Array.isArray(cfg)?cfg:[])){ const v=Number(t.value)||0,q=parseInt(t.qty)||0; for(let i=0;i<q;i++) if(v>0) out.push(v); } return out; }

// Rifas iniciais (semeadas só na primeira vez)
const SEED_RAFFLES = [
  { id:'fan160', name:'10 Motos Fan 160 0km', edition:'#47', subtitle:'10 ganhadores. Escolha levar a moto 0km na garagem ou o valor direto na sua conta.', altPrize:'OU R$ 150 MIL NO PIX', price:0.15, total:2000000, sold:1417300, status:'Ativa', featured:true, sortOrder:0, image:'banner-fan160.png', drawDate:'2026-06-20T20:00:00', prizes:[{value:50,qty:30},{value:200,qty:8},{value:1000,qty:2}] },
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
    ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS parent_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_orders_aff ON orders(affiliate_id);
    CREATE INDEX IF NOT EXISTS idx_aff_parent ON affiliates(parent_id);

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
    ALTER TABLE raffles ADD COLUMN IF NOT EXISTS prizes TEXT;

    CREATE TABLE IF NOT EXISTS customers (
      cpf          TEXT PRIMARY KEY,
      name         TEXT,
      email        TEXT,
      phone        TEXT,
      affiliate_id TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS balance NUMERIC(12,2) NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS prize_awards (
      id          TEXT PRIMARY KEY,
      raffle_id   TEXT,
      raffle_name TEXT,
      value       NUMERIC(12,2) NOT NULL,
      doc         TEXT,
      name        TEXT,
      order_id    TEXT,
      number      TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_prize_raffle ON prize_awards(raffle_id);
    CREATE INDEX IF NOT EXISTS idx_prize_doc ON prize_awards(doc);

    CREATE TABLE IF NOT EXISTS withdrawals (
      id           TEXT PRIMARY KEY,
      affiliate_id TEXT NOT NULL,
      holder_name  TEXT NOT NULL,
      holder_doc   TEXT,
      pix_key_type TEXT NOT NULL,
      pix_key      TEXT NOT NULL,
      amount       NUMERIC(12,2) NOT NULL,
      status       TEXT NOT NULL DEFAULT 'PENDING',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at      TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_withdrawals_aff ON withdrawals(affiliate_id);
  `);

  // Semeia as rifas iniciais só se a tabela estiver vazia
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM raffles');
  if (rows[0].n === 0) {
    for (const r of SEED_RAFFLES) {
      await pool.query(
        `INSERT INTO raffles (id,name,edition,subtitle,alt_prize,price,total,sold,status,featured,sort_order,image,draw_date,prizes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
        [r.id, r.name, r.edition, r.subtitle, r.altPrize, r.price, r.total, r.sold, r.status, r.featured, r.sortOrder, r.image, r.drawDate, normalizePrizesText(r.prizes)]
      );
    }
    console.log('🌱 Rifas iniciais semeadas.');
  }
  console.log('🗄️  Banco de dados pronto (PostgreSQL).');
}

/* ---------------- RIFAS ---------------- */
async function listRaffles() {
  // públicas: só ativas, ordenadas (sem expor a config de cotas premiadas)
  const { rows } = await pool.query(`SELECT * FROM raffles WHERE status='Ativa' ORDER BY featured DESC, sort_order ASC`);
  return rows.map(rowToRaffle).map(publicRaffle);
}
async function listAllRaffles() {
  const { rows } = await pool.query(`SELECT * FROM raffles ORDER BY featured DESC, sort_order ASC, created_at ASC`);
  return rows.map(rowToRaffle);
}
async function getRaffle(id) {
  const { rows } = await pool.query(`SELECT * FROM raffles WHERE id=$1`, [id]);
  return publicRaffle(rowToRaffle(rows[0]));
}
async function createRaffle(r) {
  const id = (r.id && String(r.id)) || ('rifa-' + Date.now());
  const { rows } = await pool.query(
    `INSERT INTO raffles (id,name,edition,subtitle,alt_prize,price,total,sold,status,featured,sort_order,image,draw_date,prizes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [id, r.name||'Nova rifa', r.edition||'#01', r.subtitle||'', r.altPrize||'', Number(r.price)||0.15,
     parseInt(r.total)||1000000, parseInt(r.sold)||0, r.status||'Ativa', !!r.featured,
     parseInt(r.sortOrder)||99, r.image||'', r.drawDate||null, normalizePrizesText(r.prizes)]
  );
  return rowToRaffle(rows[0]);
}
async function updateRaffle(id, r) {
  const { rows } = await pool.query(
    `UPDATE raffles SET name=$2, edition=$3, subtitle=$4, alt_prize=$5, price=$6,
       total=$7, sold=$8, status=$9, featured=$10, sort_order=$11, image=$12, draw_date=$13, prizes=$14
     WHERE id=$1 RETURNING *`,
    [id, r.name, r.edition, r.subtitle||'', r.altPrize||'', Number(r.price)||0,
     parseInt(r.total)||0, parseInt(r.sold)||0, r.status||'Ativa', !!r.featured,
     parseInt(r.sortOrder)||0, r.image||'', r.drawDate||null, normalizePrizesText(r.prizes)]
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
    let prizes = [];
    if (rows[0].raffle_id) {
      // cotas premiadas na hora (usa o 'sold' ANTES de incrementar)
      try {
        const rf = await pool.query(`SELECT id,name,total,sold,prizes FROM raffles WHERE id=$1`, [rows[0].raffle_id]);
        if (rf.rows[0]) prizes = await awardInstantPrizes(rf.rows[0], { ...rowToPedido(rows[0]), numbers });
      } catch (e) { console.error('cotas premiadas:', e.message); }
      try { await pool.query(`UPDATE raffles SET sold = sold + $2 WHERE id=$1`, [rows[0].raffle_id, rows[0].qty]); }
      catch (e) { console.error('Falha ao incrementar sold da rifa:', e.message); }
    }
    const out = rowToPedido(rows[0]); out.prizes = prizes; return out;
  }
  return await acharPorExternal(pedido.externalId); // já estava pago
}

/* ---------------- COTAS PREMIADAS NA HORA ---------------- */
async function awardInstantPrizes(rfRow, order){
  const total = parseInt(rfRow.total)||0;
  let remaining = prizePoolFromText(rfRow.prizes);
  if (!remaining.length || total<=0) return [];
  const { rows:aw } = await pool.query(`SELECT value FROM prize_awards WHERE raffle_id=$1`, [rfRow.id]);
  for (const r of aw){ const i=remaining.indexOf(Number(r.value)); if(i>=0) remaining.splice(i,1); }
  if (!remaining.length) return [];
  remaining = remaining.sort(()=>Math.random()-0.5);
  const soldBefore = parseInt(rfRow.sold)||0;
  const nums = order.numbers||[];
  const cap = Math.min(order.qty||0, nums.length, 200000);
  const usedNums = new Set(); const wins=[];
  for (let i=0;i<cap && remaining.length;i++){
    const ticketsRemaining = total - (soldBefore+i);
    if (ticketsRemaining<=0) break;
    if (Math.random() < remaining.length/ticketsRemaining){
      const value = remaining.shift();
      let num=null; for(const n of nums){ if(!usedNums.has(n)){ num=n; usedNums.add(n); break; } }
      if (num==null) num = nums[i] || String(i);
      const id='pz-'+Date.now().toString(36)+crypto.randomBytes(2).toString('hex');
      const doc=(order.payer&&order.payer.document)||'';
      await pool.query(`INSERT INTO prize_awards (id,raffle_id,raffle_name,value,doc,name,order_id,number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, rfRow.id, rfRow.name, value, doc, (order.payer&&order.payer.name)||'', order.externalId, num]);
      await creditCustomer(doc, value);
      wins.push({ value, number:num, raffleName:rfRow.name });
    }
  }
  return wins;
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
async function createAffiliate({ name, email, parentId }) {
  const id = 'aff-' + Date.now().toString(36);
  const password = randomPassword(8);
  let code = makeCode(name);
  for (let i = 0; i < 5; i++) {
    const { rows } = await pool.query('SELECT 1 FROM affiliates WHERE code=$1', [code]);
    if (!rows[0]) break;
    code = makeCode(name);
  }
  await pool.query(
    `INSERT INTO affiliates (id,name,email,pass,code,must_change,rate,parent_id) VALUES ($1,$2,$3,$4,$5,true,$6,$7)`,
    [id, name, email.toLowerCase(), password, code, COMMISSION_RATE, parentId || null]
  );
  return { id, name, email: email.toLowerCase(), code, password, rate: COMMISSION_RATE };
}

// Auto-cadastro de afiliado (via link de recrutamento de outro afiliado)
async function registerAffiliate({ name, email, pass, parentCode }) {
  const em = (email||'').toLowerCase();
  if (!name || name.trim().length < 2) throw new Error('Informe seu nome completo.');
  if (!/\S+@\S+\.\S+/.test(em)) throw new Error('Informe um e-mail válido.');
  if (!pass || String(pass).length < 6) throw new Error('A senha deve ter ao menos 6 caracteres.');
  if (await affiliateByEmail(em)) throw new Error('Já existe um afiliado com este e-mail.');
  let parentId = null;
  if (parentCode) { const p = await affiliateByCode(String(parentCode).trim()); if (p) parentId = p.id; }
  const id = 'aff-' + Date.now().toString(36);
  let code = makeCode(name);
  for (let i = 0; i < 5; i++) { const { rows } = await pool.query('SELECT 1 FROM affiliates WHERE code=$1', [code]); if (!rows[0]) break; code = makeCode(name); }
  await pool.query(
    `INSERT INTO affiliates (id,name,email,pass,code,must_change,rate,parent_id) VALUES ($1,$2,$3,$4,$5,false,$6,$7)`,
    [id, name.trim(), em, String(pass), code, COMMISSION_RATE, parentId]
  );
  return { id, code };
}

// Rede de 2º nível: indicados diretos + comissão de 20% sobre as vendas deles
async function level2Stats(id) {
  const { rows: subs } = await pool.query(`SELECT id,name,code,email,created_at FROM affiliates WHERE parent_id=$1 ORDER BY created_at DESC`, [id]);
  let subRevenue = 0; const list = [];
  for (const s of subs) {
    const st = await affiliateStats(s.id);
    subRevenue += st.revenue;
    list.push({ id:s.id, name:s.name, code:s.code, email:s.email, clients:st.clients, titles:st.titles, revenue:st.revenue, myCommission:Number((st.revenue*LEVEL2_RATE).toFixed(2)), createdAt:s.created_at });
  }
  return { subCount: subs.length, subRevenue: Number(subRevenue.toFixed(2)), level2Commission: Number((subRevenue*LEVEL2_RATE).toFixed(2)), level2Rate: LEVEL2_RATE, subs: list };
}

async function listAffiliates() {
  const { rows } = await pool.query(`SELECT * FROM affiliates ORDER BY created_at DESC`);
  const byId = {}; rows.forEach(a => { byId[a.id] = a; });
  const out = [];
  for (const a of rows) {
    const st = await affiliateStats(a.id);
    const bal = await affiliateBalance(a.id);
    const parent = a.parent_id ? byId[a.parent_id] : null;
    out.push({ id:a.id, name:a.name, email:a.email, code:a.code, rate:Number(a.rate),
      mustChange:a.must_change, createdAt:a.created_at,
      parentCode: parent ? parent.code : '', parentName: parent ? parent.name : '',
      ...st, ...bal });
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

/* ---------------- SAQUES / PIX ---------------- */
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW || 50);
const PIX_KEY_TYPES = ['cpf','cnpj','email','phone','random'];

async function affiliateBalance(id) {
  const { commission } = await affiliateStats(id);
  const l2 = await level2Stats(id);
  const earnings = commission + l2.level2Commission;
  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE status='PAID'),0)    AS withdrawn,
      COALESCE(SUM(amount) FILTER (WHERE status='PENDING'),0) AS pending
    FROM withdrawals WHERE affiliate_id=$1
  `, [id]);
  const withdrawn = Number(rows[0].withdrawn);
  const pending = Number(rows[0].pending);
  const available = Math.max(0, earnings - withdrawn - pending);
  return {
    ownCommission: Number(commission.toFixed(2)),
    level2Commission: l2.level2Commission,
    subRevenue: l2.subRevenue,
    subCount: l2.subCount,
    withdrawn: Number(withdrawn.toFixed(2)),
    pendingWithdraw: Number(pending.toFixed(2)),
    available: Number(available.toFixed(2)),
    minWithdraw: MIN_WITHDRAW,
  };
}
async function createWithdrawal(id, { holderName, holderDoc, pixKeyType, pixKey, amount }) {
  const amt = Number(amount);
  if (!holderName || !pixKey || !pixKeyType) throw new Error('Preencha todos os campos.');
  if (!PIX_KEY_TYPES.includes(pixKeyType)) throw new Error('Tipo de chave inválido.');
  if (!(amt > 0)) throw new Error('Informe um valor válido.');
  const bal = await affiliateBalance(id);
  if (amt < bal.minWithdraw) throw new Error('O valor mínimo para saque é R$ ' + bal.minWithdraw.toFixed(2).replace('.',',') + '.');
  if (amt > bal.available + 0.001) throw new Error('Valor acima do seu saldo disponível.');
  const wid = 'wd-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  const { rows } = await pool.query(
    `INSERT INTO withdrawals (id, affiliate_id, holder_name, holder_doc, pix_key_type, pix_key, amount, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING') RETURNING *`,
    [wid, id, String(holderName).trim(), String(holderDoc||'').trim(), pixKeyType, String(pixKey).trim(), Number(amt.toFixed(2))]
  );
  return rowToWithdrawal(rows[0]);
}
function rowToWithdrawal(r) {
  if (!r) return null;
  return {
    id: r.id, affiliateId: r.affiliate_id, holderName: r.holder_name, holderDoc: r.holder_doc || '',
    pixKeyType: r.pix_key_type, pixKey: r.pix_key, amount: Number(r.amount), status: r.status,
    createdAt: r.created_at, paidAt: r.paid_at,
    affiliateName: r.affiliate_name, affiliateCode: r.affiliate_code,
  };
}
async function listWithdrawals(id) {
  const { rows } = await pool.query(`SELECT * FROM withdrawals WHERE affiliate_id=$1 ORDER BY created_at DESC`, [id]);
  return rows.map(rowToWithdrawal);
}
async function listAllWithdrawals() {
  const { rows } = await pool.query(`
    SELECT w.*, a.name AS affiliate_name, a.code AS affiliate_code
    FROM withdrawals w LEFT JOIN affiliates a ON a.id = w.affiliate_id
    ORDER BY w.created_at DESC LIMIT 500
  `);
  return rows.map(rowToWithdrawal);
}
async function updateWithdrawalStatus(wid, status) {
  const st = status==='PAID' ? 'PAID' : (status==='REJECTED' ? 'REJECTED' : 'PENDING');
  const { rows } = await pool.query(
    `UPDATE withdrawals SET status=$2, paid_at = CASE WHEN $2='PAID' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`,
    [wid, st]
  );
  return rowToWithdrawal(rows[0]);
}

/* ---------------- CLIENTES (cadastrados no site) ---------------- */
async function creditCustomer(doc, amount){
  const d=(doc||'').replace(/\D/g,''); if(!d || !(Number(amount)>0)) return;
  await pool.query(
    `INSERT INTO customers (cpf, balance) VALUES ($1,$2)
     ON CONFLICT (cpf) DO UPDATE SET balance = customers.balance + EXCLUDED.balance`,
    [d, Number(amount)]
  );
}
async function customerSummary(doc){
  const d=(doc||'').replace(/\D/g,'');
  const c = await pool.query(`SELECT name, balance FROM customers WHERE cpf=$1`, [d]);
  const pr = await pool.query(`SELECT raffle_name, value, number, created_at FROM prize_awards WHERE doc=$1 ORDER BY created_at DESC`, [d]);
  return { cpf:d, name:(c.rows[0]&&c.rows[0].name)||'', balance:Number((c.rows[0]&&c.rows[0].balance)||0), prizesWon:pr.rows.length, prizes:pr.rows.map(p=>({ raffleName:p.raffle_name, value:Number(p.value), number:p.number, at:p.created_at })) };
}
async function listPrizeAwards(){
  const { rows } = await pool.query(`SELECT * FROM prize_awards ORDER BY created_at DESC LIMIT 500`);
  return rows.map(a=>({ id:a.id, raffleName:a.raffle_name, value:Number(a.value), name:a.name, doc:a.doc, number:a.number, at:a.created_at }));
}
async function prizeSummary(){
  const { rows } = await pool.query(`SELECT id,name,prizes FROM raffles`);
  const out=[];
  for(const rf of rows){ const pool2=prizePoolFromText(rf.prizes); if(!pool2.length) continue;
    const aw=await pool.query(`SELECT COALESCE(SUM(value),0) AS v, COUNT(*)::int AS c FROM prize_awards WHERE raffle_id=$1`,[rf.id]);
    out.push({ raffleId:rf.id, raffleName:rf.name, totalPrizes:pool2.length, totalValue:pool2.reduce((s,v)=>s+v,0), awardedCount:Number(aw.rows[0].c), awardedValue:Number(aw.rows[0].v) }); }
  return out;
}
async function registerCustomer({ name, cpf, phone, email, affiliateId }) {
  const doc = (cpf || '').replace(/\D/g, '');
  if (!doc) return null;
  await pool.query(
    `INSERT INTO customers (cpf, name, email, phone, affiliate_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (cpf) DO UPDATE SET
       name = COALESCE(NULLIF(EXCLUDED.name,''), customers.name),
       email = COALESCE(NULLIF(EXCLUDED.email,''), customers.email),
       phone = COALESCE(NULLIF(EXCLUDED.phone,''), customers.phone),
       affiliate_id = COALESCE(customers.affiliate_id, EXCLUDED.affiliate_id)`,
    [doc, name || '', (email||'').toLowerCase(), phone || '', affiliateId || null]
  );
  return { cpf: doc };
}

// Lista TODOS os clientes cadastrados + qualquer comprador, com estatísticas de pedidos pagos.
async function listCustomers() {
  const { rows } = await pool.query(`
    WITH stats AS (
      SELECT payer_doc AS doc,
        MAX(payer_name) AS name,
        COUNT(*)             FILTER (WHERE status='COMPLETED') AS orders,
        COALESCE(SUM(qty)    FILTER (WHERE status='COMPLETED'),0) AS titles,
        COALESCE(SUM(amount) FILTER (WHERE status='COMPLETED'),0) AS spent,
        MAX(created_at) AS last_order
      FROM orders WHERE COALESCE(payer_doc,'') <> '' GROUP BY payer_doc
    )
    SELECT
      COALESCE(c.cpf, s.doc)                        AS cpf,
      COALESCE(NULLIF(c.name,''), s.name, 'Cliente') AS name,
      c.email, c.phone,
      c.created_at                                  AS registered_at,
      COALESCE(s.orders,0)                          AS orders,
      COALESCE(s.titles,0)                          AS titles,
      COALESCE(s.spent,0)                           AS spent,
      COALESCE(s.last_order, c.created_at)          AS last_at,
      (c.cpf IS NOT NULL)                           AS registered
    FROM customers c
    FULL OUTER JOIN stats s ON s.doc = c.cpf
    ORDER BY last_at DESC NULLS LAST
    LIMIT 1000
  `);
  return rows.map((r) => ({
    cpf: r.cpf,
    name: r.name,
    email: r.email || '',
    phone: r.phone || '',
    orders: Number(r.orders),
    titles: Number(r.titles),
    spent: Number(Number(r.spent).toFixed(2)),
    last: r.last_at,
    registered: !!r.registered,
    paid: Number(r.orders) > 0,
  }));
}

module.exports = {
  init, criarPedido, vincularTransacao, acharPorExternal,
  acharPorTransacao, marcarPago, listOrders, metrics, gerarNumeros,
  listRaffles, listAllRaffles, getRaffle, createRaffle, updateRaffle,
  createAffiliate, registerAffiliate, listAffiliates, affiliateByEmail, affiliateById,
  affiliateByCode, changeAffiliatePassword, resetAffiliatePassword, affiliateStats,
  affiliateBalance, level2Stats, createWithdrawal, listWithdrawals, listAllWithdrawals, updateWithdrawalStatus,
  registerCustomer, listCustomers, customerSummary, listPrizeAwards, prizeSummary,
};
