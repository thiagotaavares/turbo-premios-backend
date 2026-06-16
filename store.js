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
  { id:'fan160', name:'10 Motos Fan 160 0km', edition:'#47', subtitle:'10 ganhadores. Escolha levar a moto 0km na garagem ou o valor direto na sua conta.', altPrize:'OU R$ 150 MIL NO PIX', price:0.15, total:2000000, sold:1417300, status:'Ativa', featured:true, sortOrder:0, image:'banner-fan160.png', drawDate:'2026-06-20T20:00:00', prizes:[{value:50,qty:30},{value:200,qty:8},{value:1000,qty:2}] },
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

function criarPedido({ externalId, qty, amount, payer, raffleId, raffleName, affiliateId }) {
  const pedido = {
    externalId,
    qty,
    amount,
    payer,
    raffleId: raffleId || null,
    raffleName: raffleName || null,
    affiliateId: affiliateId || null,
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
  const rf = pedido.raffleId ? raffles.find((r) => r.id === pedido.raffleId) : null;
  pedido.prizes = rf ? awardInstantPrizes(pedido, rf) : []; // cotas premiadas na hora
  if (rf) rf.sold += pedido.qty;
  return pedido;
}

/* ---- Cotas premiadas na hora ---- */
function normalizePrizes(p){ if(!Array.isArray(p)) return []; return p.map(t=>({ value:Number(t.value)||0, qty:parseInt(t.qty)||0 })).filter(t=>t.value>0 && t.qty>0); }
function prizePool(rf){ const out=[]; for(const t of (Array.isArray(rf.prizes)?rf.prizes:[])){ const v=Number(t.value)||0, q=parseInt(t.qty)||0; for(let i=0;i<q;i++) if(v>0) out.push(v); } return out; }
// Sorteio justo, sem reposição, sobre os títulos restantes da rifa.
function awardInstantPrizes(order, rf){
  const total = parseInt(rf.total)||0;
  let remaining = prizePool(rf);
  if (!remaining.length || total<=0) return [];
  const awardedValues = prizeAwards.filter(a=>a.raffleId===rf.id).map(a=>a.value);
  for (const v of awardedValues){ const i=remaining.indexOf(v); if(i>=0) remaining.splice(i,1); }
  if (!remaining.length) return [];
  remaining = remaining.sort(()=>Math.random()-0.5); // ordem aleatória dos valores
  const soldBefore = parseInt(rf.sold)||0;
  const cap = Math.min(order.qty||0, order.numbers.length, 200000);
  const usedNums = new Set();
  const wins = [];
  for (let i=0;i<cap && remaining.length;i++){
    const ticketsRemaining = total - (soldBefore + i);
    if (ticketsRemaining <= 0) break;
    if (Math.random() < remaining.length / ticketsRemaining){
      const value = remaining.shift();
      let num = null;
      for (const n of order.numbers){ if(!usedNums.has(n)){ num=n; usedNums.add(n); break; } }
      if (num==null) num = order.numbers[i] || String(i);
      const award = { id:'pz-'+Date.now().toString(36)+Math.random().toString(16).slice(2,5), raffleId:rf.id, raffleName:rf.name, value, doc:(order.payer&&order.payer.document)||'', name:(order.payer&&order.payer.name)||'', orderId:order.externalId, number:num, createdAt:new Date().toISOString() };
      prizeAwards.push(award);
      creditCustomer(award.doc, value);
      wins.push({ value, number:num, raffleName:rf.name });
    }
  }
  return wins;
}

/* ---- Rifas ---- */
function publicRaffle(r){ const { prizes, ...rest } = r; return rest; } // esconde a config de cotas premiadas do site
function listRaffles() { return raffles.filter((r) => r.status === 'Ativa').sort((a,b)=> (b.featured-a.featured) || (a.sortOrder-b.sortOrder)).map(publicRaffle); }
function listAllRaffles() { return raffles.slice().sort((a,b)=> (b.featured-a.featured) || (a.sortOrder-b.sortOrder)); }
function getRaffle(id) { const r = raffles.find((x) => x.id === id); return r ? publicRaffle(r) : null; }
function createRaffle(r) {
  const nova = { id: r.id || ('rifa-'+Date.now()), name:r.name||'Nova rifa', edition:r.edition||'#01', subtitle:r.subtitle||'', altPrize:r.altPrize||'', price:Number(r.price)||0.15, total:parseInt(r.total)||1000000, sold:parseInt(r.sold)||0, status:r.status||'Ativa', featured:!!r.featured, sortOrder:parseInt(r.sortOrder)||99, image:r.image||'', drawDate:r.drawDate||null, prizes:normalizePrizes(r.prizes) };
  raffles.push(nova);
  return nova;
}
function updateRaffle(id, r) {
  const rf = raffles.find((x) => x.id === id);
  if (!rf) return null;
  Object.assign(rf, { name:r.name, edition:r.edition, subtitle:r.subtitle||'', altPrize:r.altPrize||'', price:Number(r.price)||0, total:parseInt(r.total)||0, sold:parseInt(r.sold)||0, status:r.status||'Ativa', featured:!!r.featured, sortOrder:parseInt(r.sortOrder)||0, image:r.image||'', drawDate:r.drawDate||null, prizes:normalizePrizes(r.prizes) });
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

/* ---- Afiliados (memória) ---- */
const crypto = require('crypto');
const affiliates = [];
const RATE = Number(process.env.COMMISSION_RATE || 0.30);
const LEVEL2_RATE = Number(process.env.LEVEL2_RATE || 0.20); // 2º nível: % sobre as VENDAS do indicado
function _rndPass(n=8){ const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz'; let s=''; for(let i=0;i<n;i++) s+=c[Math.floor(Math.random()*c.length)]; return s; }
function _code(name){ return ((name||'AF').replace(/[^a-zA-Z]/g,'').slice(0,4).toUpperCase()||'AF') + Math.random().toString(16).slice(2,6).toUpperCase(); }
function createAffiliate({ name, email, parentId }){
  const id='aff-'+Date.now().toString(36); const password=_rndPass(8); const code=_code(name);
  affiliates.push({ id, name, email:(email||'').toLowerCase(), pass:password, code, must_change:true, rate:RATE, parent_id:parentId||null, created_at:new Date().toISOString() });
  return { id, name, email:(email||'').toLowerCase(), code, password, rate:RATE };
}
// Auto-cadastro de afiliado (via link de recrutamento de outro afiliado)
function registerAffiliate({ name, email, pass, parentCode }){
  const em=(email||'').toLowerCase();
  if(!name || name.trim().length<2) throw new Error('Informe seu nome completo.');
  if(!/\S+@\S+\.\S+/.test(em)) throw new Error('Informe um e-mail válido.');
  if(!pass || String(pass).length<6) throw new Error('A senha deve ter ao menos 6 caracteres.');
  if(affiliateByEmail(em)) throw new Error('Já existe um afiliado com este e-mail.');
  let parentId=null; if(parentCode){ const p=affiliateByCode(String(parentCode).trim()); if(p) parentId=p.id; }
  const id='aff-'+Date.now().toString(36); const code=_code(name);
  affiliates.push({ id, name:name.trim(), email:em, pass:String(pass), code, must_change:false, rate:RATE, parent_id:parentId, created_at:new Date().toISOString() });
  return { id, code };
}
function subAffiliates(id){ return affiliates.filter(a=>a.parent_id===id); }
function level2Stats(id){
  const subs=subAffiliates(id); let subRevenue=0; const list=[];
  for(const s of subs){ const st=affiliateStats(s.id); subRevenue+=st.revenue; list.push({ id:s.id, name:s.name, code:s.code, email:s.email, clients:st.clients, titles:st.titles, revenue:st.revenue, myCommission:Number((st.revenue*LEVEL2_RATE).toFixed(2)), createdAt:s.created_at }); }
  list.sort((a,b)=> a.createdAt<b.createdAt?1:-1);
  return { subCount:subs.length, subRevenue:Number(subRevenue.toFixed(2)), level2Commission:Number((subRevenue*LEVEL2_RATE).toFixed(2)), level2Rate:LEVEL2_RATE, subs:list };
}
function affiliateById(id){ return affiliates.find(a=>a.id===id)||null; }
function affiliateByEmail(email){ return affiliates.find(a=>a.email===(email||'').toLowerCase())||null; }
function affiliateByCode(code){ return code ? (affiliates.find(a=>a.code===code)||null) : null; }
function changeAffiliatePassword(id,newPass){ const a=affiliateById(id); if(a){ a.pass=newPass; a.must_change=false; } }
function resetAffiliatePassword(id){ const a=affiliateById(id); const p=_rndPass(8); if(a){ a.pass=p; a.must_change=true; } return p; }
function affiliateStats(id){
  const paid=Array.from(pedidos.values()).filter(p=>p.affiliateId===id && p.status==='COMPLETED');
  const revenue=paid.reduce((s,p)=>s+p.amount,0);
  const clients=new Set(paid.map(p=>(p.payer&&p.payer.document)||'')).size;
  const a=affiliateById(id); const rate=a?Number(a.rate):RATE;
  return { clients, titles:paid.reduce((s,p)=>s+p.qty,0), revenue:Number(revenue.toFixed(2)), commission:Number((revenue*rate).toFixed(2)), rate };
}
function listAffiliates(){ return affiliates.map(a=>{ const parent=a.parent_id?affiliateById(a.parent_id):null; const l2=level2Stats(a.id); return { id:a.id,name:a.name,email:a.email,code:a.code,rate:Number(a.rate),mustChange:a.must_change,createdAt:a.created_at, parentCode:parent?parent.code:'', parentName:parent?parent.name:'', subCount:l2.subCount, level2Commission:l2.level2Commission, ...affiliateStats(a.id), ...affiliateBalance(a.id) }; }); }

/* ---- Saques / PIX (memória) ---- */
const withdrawals = [];
const MIN_WITHDRAW = Number(process.env.MIN_WITHDRAW || 50);
const PIX_KEY_TYPES = ['cpf','cnpj','email','phone','random'];

function affiliateBalance(id){
  const { commission } = affiliateStats(id);
  const l2 = level2Stats(id);
  const earnings = commission + l2.level2Commission;
  const mine = withdrawals.filter(w=>w.affiliateId===id);
  const withdrawn = mine.filter(w=>w.status==='PAID').reduce((s,w)=>s+w.amount,0);
  const pending   = mine.filter(w=>w.status==='PENDING').reduce((s,w)=>s+w.amount,0);
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
function createWithdrawal(id, { holderName, holderDoc, pixKeyType, pixKey, amount }){
  const amt = Number(amount);
  if (!holderName || !pixKey || !pixKeyType) throw new Error('Preencha todos os campos.');
  if (!PIX_KEY_TYPES.includes(pixKeyType)) throw new Error('Tipo de chave inválido.');
  if (!(amt > 0)) throw new Error('Informe um valor válido.');
  const bal = affiliateBalance(id);
  if (amt < bal.minWithdraw) throw new Error('O valor mínimo para saque é R$ ' + bal.minWithdraw.toFixed(2).replace('.',',') + '.');
  if (amt > bal.available + 0.001) throw new Error('Valor acima do seu saldo disponível.');
  const w = {
    id: 'wd-' + Date.now().toString(36) + Math.random().toString(16).slice(2,5),
    affiliateId: id,
    holderName: String(holderName).trim(),
    holderDoc: String(holderDoc||'').trim(),
    pixKeyType,
    pixKey: String(pixKey).trim(),
    amount: Number(amt.toFixed(2)),
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    paidAt: null,
  };
  withdrawals.push(w);
  return w;
}
function listWithdrawals(id){ return withdrawals.filter(w=>w.affiliateId===id).sort((a,b)=> a.createdAt<b.createdAt?1:-1); }
function listAllWithdrawals(){ return withdrawals.slice().sort((a,b)=> a.createdAt<b.createdAt?1:-1).map(w=>{ const a=affiliateById(w.affiliateId); return { ...w, affiliateName:a?a.name:'', affiliateCode:a?a.code:'' }; }); }
function updateWithdrawalStatus(wid, status){ const w=withdrawals.find(x=>x.id===wid); if(!w) return null; w.status = status==='PAID'?'PAID':(status==='REJECTED'?'REJECTED':'PENDING'); w.paidAt = w.status==='PAID' ? new Date().toISOString() : null; return w; }

/* ---- Clientes (cadastrados no site) ---- */
const customers = new Map(); // cpf(digits) -> { cpf, name, email, phone, affiliateId, balance, createdAt }
const prizeAwards = []; // cotas premiadas distribuídas
function creditCustomer(doc, amount){
  const d=(doc||'').replace(/\D/g,''); if(!d || !(amount>0)) return;
  const ex = customers.get(d) || { cpf:d, createdAt:new Date().toISOString(), affiliateId:null };
  ex.balance = Number(((ex.balance||0)+Number(amount)).toFixed(2));
  customers.set(d, ex);
}
function customerSummary(doc){
  const d=(doc||'').replace(/\D/g,'');
  const c = customers.get(d);
  const prizes = prizeAwards.filter(a=>a.doc===d).sort((a,b)=> a.createdAt<b.createdAt?1:-1);
  return { cpf:d, name:(c&&c.name)||'', balance:Number(((c&&c.balance)||0).toFixed(2)), prizesWon:prizes.length, prizes:prizes.map(p=>({ raffleName:p.raffleName, value:p.value, number:p.number, at:p.createdAt })) };
}
function listPrizeAwards(){ return prizeAwards.slice().sort((a,b)=> a.createdAt<b.createdAt?1:-1).map(a=>({ id:a.id, raffleName:a.raffleName, value:a.value, name:a.name, doc:a.doc, number:a.number, at:a.createdAt })); }
function prizeSummary(){ return raffles.map(rf=>{ const pool=prizePool(rf); const aw=prizeAwards.filter(a=>a.raffleId===rf.id); return { raffleId:rf.id, raffleName:rf.name, totalPrizes:pool.length, totalValue:pool.reduce((s,v)=>s+v,0), awardedCount:aw.length, awardedValue:Number(aw.reduce((s,a)=>s+a.value,0).toFixed(2)) }; }).filter(x=>x.totalPrizes>0); }
function registerCustomer({ name, cpf, phone, email, affiliateId }) {
  const doc = (cpf || '').replace(/\D/g, '');
  if (!doc) return null;
  const ex = customers.get(doc) || { cpf: doc, createdAt: new Date().toISOString(), affiliateId: affiliateId || null };
  customers.set(doc, {
    ...ex,
    name: name || ex.name || '',
    email: (email || ex.email || '').toLowerCase(),
    phone: phone || ex.phone || '',
    affiliateId: ex.affiliateId || affiliateId || null,
  });
  return { cpf: doc };
}
function listCustomers() {
  // agrega pedidos pagos por documento
  const stats = {};
  for (const p of pedidos.values()) {
    const doc = (p.payer && p.payer.document) || '';
    if (!doc) continue;
    if (!stats[doc]) stats[doc] = { name:(p.payer&&p.payer.name)||'Cliente', orders:0, titles:0, spent:0, last:p.createdAt };
    if (p.status === 'COMPLETED') { stats[doc].orders++; stats[doc].titles += p.qty; stats[doc].spent += p.amount; }
    if (p.createdAt > stats[doc].last) stats[doc].last = p.createdAt;
  }
  const docs = new Set([...customers.keys(), ...Object.keys(stats)]);
  const out = [];
  for (const doc of docs) {
    const c = customers.get(doc);
    const s = stats[doc];
    out.push({
      cpf: doc,
      name: (c && c.name) || (s && s.name) || 'Cliente',
      email: (c && c.email) || '',
      phone: (c && c.phone) || '',
      orders: s ? s.orders : 0,
      titles: s ? s.titles : 0,
      spent: s ? Number(s.spent.toFixed(2)) : 0,
      last: (s && s.last) || (c && c.createdAt) || null,
      registered: !!c,
      paid: s ? s.orders > 0 : false,
    });
  }
  return out.sort((a,b)=> (b.last||'') < (a.last||'') ? -1 : 1);
}

module.exports = {
  criarPedido, vincularTransacao, acharPorExternal,
  acharPorTransacao, marcarPago, gerarNumeros,
  listOrders, metrics,
  listRaffles, listAllRaffles, getRaffle, createRaffle, updateRaffle,
  createAffiliate, registerAffiliate, listAffiliates, affiliateByEmail, affiliateById,
  affiliateByCode, changeAffiliatePassword, resetAffiliatePassword, affiliateStats,
  affiliateBalance, level2Stats, createWithdrawal, listWithdrawals, listAllWithdrawals, updateWithdrawalStatus,
  registerCustomer, listCustomers, customerSummary, listPrizeAwards, prizeSummary,
};
