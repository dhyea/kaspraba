// =========================================================
// Kas Keluarga — app.js
// Menggunakan Supabase sebagai backend realtime.
// Konfigurasi ada di config.js (SUPABASE_URL, SUPABASE_ANON_KEY)
// =========================================================

const MONTH_NAMES = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

let supabaseClient = null;
let CONFIG_OK = false;
try{
  if(SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes('GANTI') && !SUPABASE_ANON_KEY.includes('GANTI')){
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    CONFIG_OK = true;
  }
}catch(e){ console.error(e); }

let currentPeriod = localStorage.getItem('kas_period') || todayPeriod();
let USER_NAME = localStorage.getItem('kas_user') || 'Suami';
let activeTab = 'anggaran';
let realtimeConnected = false;

let STATE = { income: [], categories: [], transactions: [], emergencyFund: [] };

function todayPeriod(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function periodLabel(period){
  const [y,m] = period.split('-').map(Number);
  return `${MONTH_NAMES[m-1]} ${y}`;
}
function shiftPeriod(period, delta){
  let [y,m] = period.split('-').map(Number);
  m += delta;
  if(m<1){ m=12; y--; } if(m>12){ m=1; y++; }
  return `${y}-${String(m).padStart(2,'0')}`;
}
function todayStr(){ return new Date().toISOString().slice(0,10); }
function formatRp(n){ n = Number(n)||0; return 'Rp' + n.toLocaleString('id-ID'); }

function totalIncome(){ return STATE.income.reduce((s,i)=>s+Number(i.amount||0),0); }
function totalBudget(){ return STATE.categories.reduce((s,c)=>s+Number(c.budget||0),0); }
function totalSpent(){ return STATE.transactions.reduce((s,t)=>s+Number(t.amount||0),0); }
function spentByCategory(catName){ return STATE.transactions.filter(t=>t.category===catName).reduce((s,t)=>s+Number(t.amount||0),0); }
function totalEmergencyFund(){ return STATE.emergencyFund.reduce((s,e)=>s+Number(e.amount||0),0); }

// ---------------- DATA LOADING ----------------
async function loadPeriodData(){
  const [{data: income}, {data: categories}, {data: transactions}] = await Promise.all([
    supabaseClient.from('income').select('*').eq('period', currentPeriod).order('created_at'),
    supabaseClient.from('categories').select('*').eq('period', currentPeriod).order('created_at'),
    supabaseClient.from('transactions').select('*').eq('period', currentPeriod).order('tx_date', {ascending:false}),
  ]);
  STATE.income = income || [];
  STATE.categories = categories || [];
  STATE.transactions = transactions || [];
}
async function loadEmergencyFund(){
  const {data} = await supabaseClient.from('emergency_fund').select('*').order('ef_date', {ascending:false});
  STATE.emergencyFund = data || [];
}

async function copyFromPreviousMonth(){
  const prev = shiftPeriod(currentPeriod, -1);
  const [{data: prevIncome}, {data: prevCategories}] = await Promise.all([
    supabaseClient.from('income').select('*').eq('period', prev),
    supabaseClient.from('categories').select('*').eq('period', prev),
  ]);
  if((prevIncome||[]).length){
    await supabaseClient.from('income').insert(prevIncome.map(i=>({period: currentPeriod, label:i.label, amount:i.amount})));
  }
  if((prevCategories||[]).length){
    await supabaseClient.from('categories').insert(prevCategories.map(c=>({period: currentPeriod, name:c.name, budget:c.budget})));
  }else{
    // default kategori kalau bulan sebelumnya juga kosong
    const defaults = ['Belanja Dapur/Sembako','Listrik, Air, Gas','Cicilan/Tagihan','Pendidikan Anak','Kesehatan','Transportasi','Hiburan/Lain-lain'];
    await supabaseClient.from('categories').insert(defaults.map(name=>({period: currentPeriod, name, budget:0})));
  }
  await loadPeriodData();
  render();
}

// ---------------- REALTIME ----------------
function setupRealtime(){
  supabaseClient.channel('kas-keluarga-changes')
    .on('postgres_changes', {event:'*', schema:'public', table:'income'}, handleChange)
    .on('postgres_changes', {event:'*', schema:'public', table:'categories'}, handleChange)
    .on('postgres_changes', {event:'*', schema:'public', table:'transactions'}, handleChange)
    .on('postgres_changes', {event:'*', schema:'public', table:'emergency_fund'}, handleChange)
    .subscribe(status=>{
      realtimeConnected = (status === 'SUBSCRIBED');
      updateStatusBadge();
    });
}
let refreshTimeout = null;
async function handleChange(){
  clearTimeout(refreshTimeout);
  refreshTimeout = setTimeout(async ()=>{
    await Promise.all([loadPeriodData(), loadEmergencyFund()]);
    render();
  }, 250);
}
function updateStatusBadge(){
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  if(!dot) return;
  dot.classList.toggle('off', !realtimeConnected);
  label.textContent = realtimeConnected ? 'Realtime aktif' : 'Menyambungkan…';
}

// ---------------- INIT ----------------
async function init(){
  const app = document.getElementById('app');
  if(!CONFIG_OK){
    app.innerHTML = `
      <div class="config-warning">
        <b>Konfigurasi Supabase belum diisi.</b><br>
        Buka file <code>config.js</code>, isi <code>SUPABASE_URL</code> dan <code>SUPABASE_ANON_KEY</code>
        dari Supabase Dashboard &gt; Project Settings &gt; API, lalu simpan &amp; muat ulang halaman ini.
      </div>`;
    return;
  }
  try{
    await Promise.all([loadPeriodData(), loadEmergencyFund()]);
    render();
    setupRealtime();
  }catch(err){
    console.error(err);
    app.innerHTML = `
      <div class="config-warning">
        <b>Gagal memuat data dari Supabase.</b><br>
        Pesan error: <code>${(err && err.message) || String(err)}</code><br><br>
        Kemungkinan penyebab:<br>
        • URL atau anon key di <code>config.js</code> salah/kepotong<br>
        • Skrip <code>supabase_schema.sql</code> belum berhasil dijalankan di Supabase SQL Editor<br>
        • Nama tabel tidak sesuai (income, categories, transactions, emergency_fund)<br><br>
        Buka DevTools (F12) &gt; tab Console untuk detail lengkap, lalu kirim pesan errornya.
      </div>`;
  }
}

// ---------------- RENDER ----------------
function render(){
  const app = document.getElementById('app');
  const income = totalIncome();
  const spent = totalSpent();
  const balance = income - spent;
  const ef = totalEmergencyFund();
  const isEmptyPeriod = STATE.categories.length===0 && STATE.income.length===0;

  app.innerHTML = `
    <header>
      <div class="brand">
        <div class="brand-mark">K</div>
        <div>
          <h1>Kas Keluarga</h1>
          <div class="tagline">Sinkron realtime lewat Supabase — suami &amp; istri lihat data yang sama</div>
        </div>
      </div>
      <div class="header-right">
        <div class="status-box"><span id="statusLabel">Menyambungkan…</span><div class="status-dot off" id="statusDot"></div></div>
        <div class="user-box">
          <label>Mencatat sebagai</label>
          <select id="userSelect">
            ${['Suami','Istri'].map(n=>`<option value="${n}" ${USER_NAME===n?'selected':''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>
    </header>

    <div class="month-switch">
      <button id="prevMonth">‹</button>
      <div class="month-label">${periodLabel(currentPeriod)}</div>
      <button id="nextMonth">›</button>
    </div>

    ${isEmptyPeriod ? `
    <div class="copy-prompt">
      <span>Bulan ini belum ada data anggaran/pemasukan.</span>
      <button id="copyPrevBtn">Salin dari bulan sebelumnya</button>
    </div>` : ''}

    <div class="stats">
      <div class="stat"><div class="label">Total Pemasukan</div><div class="value">${formatRp(income)}</div></div>
      <div class="stat"><div class="label">Total Pengeluaran</div><div class="value">${formatRp(spent)}</div></div>
      <div class="stat ${balance<0?'negative':'positive'}"><div class="label">Sisa Saldo</div><div class="value">${formatRp(balance)}</div></div>
      <div class="stat"><div class="label">Dana Darurat</div><div class="value">${formatRp(ef)}</div></div>
    </div>

    <div class="tabs">
      <button class="tab-btn ${activeTab==='anggaran'?'active':''}" data-tab="anggaran">Amplop Anggaran</button>
      <button class="tab-btn ${activeTab==='transaksi'?'active':''}" data-tab="transaksi">Catatan Transaksi</button>
      <button class="tab-btn ${activeTab==='darurat'?'active':''}" data-tab="darurat">Dana Darurat</button>
    </div>

    <div id="panel-anggaran" class="tab-panel ${activeTab==='anggaran'?'active':''}"></div>
    <div id="panel-transaksi" class="tab-panel ${activeTab==='transaksi'?'active':''}"></div>
    <div id="panel-darurat" class="tab-panel ${activeTab==='darurat'?'active':''}"></div>
  `;

  updateStatusBadge();

  document.getElementById('userSelect').addEventListener('change', e=>{
    USER_NAME = e.target.value; localStorage.setItem('kas_user', USER_NAME);
  });
  document.getElementById('prevMonth').addEventListener('click', async ()=>{
    currentPeriod = shiftPeriod(currentPeriod, -1); localStorage.setItem('kas_period', currentPeriod);
    await loadPeriodData(); render();
  });
  document.getElementById('nextMonth').addEventListener('click', async ()=>{
    currentPeriod = shiftPeriod(currentPeriod, 1); localStorage.setItem('kas_period', currentPeriod);
    await loadPeriodData(); render();
  });
  const copyBtn = document.getElementById('copyPrevBtn');
  if(copyBtn) copyBtn.addEventListener('click', copyFromPreviousMonth);

  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{ activeTab = btn.dataset.tab; render(); });
  });

  renderAnggaran();
  renderTransaksi();
  renderDarurat();
}

function renderAnggaran(){
  const panel = document.getElementById('panel-anggaran');
  const envelopesHtml = STATE.categories.map(cat=>{
    const spent = spentByCategory(cat.name);
    const budget = Number(cat.budget||0);
    const pct = budget>0 ? Math.min(100,(spent/budget)*100) : (spent>0?100:0);
    const over = budget>0 && spent>budget;
    return `
      <div class="envelope">
        <button class="del-cat" data-del-cat="${cat.id}" title="Hapus kategori">✕</button>
        <input class="envelope-name-input" type="text" value="${cat.name}" data-name-cat="${cat.id}">
        <div class="envelope-row"><span>Terpakai</span><b>${formatRp(spent)}</b></div>
        <div class="bar-track"><div class="bar-fill ${over?'over':''}" style="width:${pct}%"></div></div>
        <div class="envelope-row"><span>Sisa</span><b>${formatRp(budget-spent)}</b></div>
        <label style="font-size:11px;color:var(--ink-soft);display:block;margin-top:8px;">Anggaran bulanan</label>
        <input class="budget-input" type="number" min="0" value="${cat.budget}" data-budget-cat="${cat.id}">
      </div>`;
  }).join('');

  panel.innerHTML = `
    <h2 class="section-title">Amplop Anggaran</h2>
    <div class="envelopes">
      ${envelopesHtml}
      <button class="add-envelope" id="addCatBtn">+ Tambah Kategori</button>
    </div>

    <h2 class="section-title">Pemasukan</h2>
    <div class="income-list">
      ${STATE.income.map(i=>`
        <div class="income-row">
          <input type="text" value="${i.label}" data-income-label="${i.id}">
          <input type="number" min="0" value="${i.amount}" data-income-amount="${i.id}">
          <button data-del-income="${i.id}" title="Hapus">✕</button>
        </div>`).join('')}
      <button class="link-btn" id="addIncomeBtn">+ Tambah sumber pemasukan</button>
      <div class="income-total"><span>Total Pemasukan</span><span>${formatRp(totalIncome())}</span></div>
    </div>
  `;

  panel.querySelectorAll('[data-name-cat]').forEach(inp=>{
    inp.addEventListener('change', async e=>{
      const cat = STATE.categories.find(c=>c.id===e.target.dataset.nameCat);
      const oldName = cat.name, newName = e.target.value.trim();
      if(!newName){ e.target.value = oldName; return; }
      if(newName === oldName) return;
      const affected = STATE.transactions.filter(t=>t.category===oldName);
      await Promise.all(affected.map(t=>supabaseClient.from('transactions').update({category:newName}).eq('id', t.id)));
      await supabaseClient.from('categories').update({name:newName}).eq('id', cat.id);
      await loadPeriodData(); render();
    });
  });
  panel.querySelectorAll('[data-budget-cat]').forEach(inp=>{
    inp.addEventListener('change', async e=>{
      await supabaseClient.from('categories').update({budget: Number(e.target.value)||0}).eq('id', e.target.dataset.budgetCat);
      await loadPeriodData(); render();
    });
  });
  panel.querySelectorAll('[data-del-cat]').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      if(!confirm('Hapus kategori ini? Transaksi yang sudah tercatat tidak akan terhapus.')) return;
      await supabaseClient.from('categories').delete().eq('id', e.target.dataset.delCat);
      await loadPeriodData(); render();
    });
  });
  document.getElementById('addCatBtn').addEventListener('click', async ()=>{
    const name = prompt('Nama kategori baru:');
    if(!name) return;
    await supabaseClient.from('categories').insert({period: currentPeriod, name, budget:0});
    await loadPeriodData(); render();
  });

  panel.querySelectorAll('[data-income-label]').forEach(inp=>{
    inp.addEventListener('change', async e=>{
      await supabaseClient.from('income').update({label: e.target.value}).eq('id', e.target.dataset.incomeLabel);
      await loadPeriodData();
    });
  });
  panel.querySelectorAll('[data-income-amount]').forEach(inp=>{
    inp.addEventListener('change', async e=>{
      await supabaseClient.from('income').update({amount: Number(e.target.value)||0}).eq('id', e.target.dataset.incomeAmount);
      await loadPeriodData(); render();
    });
  });
  panel.querySelectorAll('[data-del-income]').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      await supabaseClient.from('income').delete().eq('id', e.target.dataset.delIncome);
      await loadPeriodData(); render();
    });
  });
  document.getElementById('addIncomeBtn').addEventListener('click', async ()=>{
    await supabaseClient.from('income').insert({period: currentPeriod, label:'Sumber baru', amount:0});
    await loadPeriodData(); render();
  });
}

function renderTransaksi(){
  const panel = document.getElementById('panel-transaksi');
  const catOptions = STATE.categories.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
  const rows = STATE.transactions;

  panel.innerHTML = `
    <h2 class="section-title">Tambah Transaksi</h2>
    <div class="form-card">
      <div class="form-grid">
        <div class="field"><label>Tanggal</label><input type="date" id="txDate" value="${todayStr()}"></div>
        <div class="field"><label>Keterangan</label><input type="text" id="txDesc" placeholder="Beli sayur, dll"></div>
        <div class="field"><label>Kategori</label><select id="txCat">${catOptions || '<option value="">Belum ada kategori</option>'}</select></div>
        <div class="field"><label>Jumlah (Rp)</label><input type="number" id="txAmount" min="0" placeholder="0"></div>
        <button class="btn-primary" id="txAddBtn">+ Simpan</button>
      </div>
    </div>
    <h2 class="section-title">Riwayat Transaksi</h2>
    <table>
      <thead><tr><th>Tanggal</th><th>Keterangan</th><th>Kategori</th><th>Oleh</th><th style="text-align:right">Jumlah</th><th></th></tr></thead>
      <tbody>
        ${rows.map(t=>`
          <tr>
            <td>${t.tx_date}</td>
            <td>${t.description||'-'}</td>
            <td><span class="cat-tag">${t.category}</span></td>
            <td class="who">${t.by_user||'-'}</td>
            <td class="amount">${formatRp(t.amount)}</td>
            <td><button class="del-row" data-del-tx="${t.id}">✕</button></td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${rows.length===0 ? '<div class="empty">Belum ada transaksi bulan ini.</div>' : ''}
  `;

  document.getElementById('txAddBtn').addEventListener('click', async ()=>{
    const date = document.getElementById('txDate').value || todayStr();
    const description = document.getElementById('txDesc').value.trim();
    const category = document.getElementById('txCat').value;
    const amount = Number(document.getElementById('txAmount').value)||0;
    if(!category){ alert('Buat kategori dulu di tab Amplop Anggaran.'); return; }
    if(amount<=0){ alert('Isi jumlah pengeluaran terlebih dahulu.'); return; }
    await supabaseClient.from('transactions').insert({period: currentPeriod, tx_date:date, description, category, amount, by_user:USER_NAME});
    await loadPeriodData(); render(); activeTab='transaksi'; render();
  });
  panel.querySelectorAll('[data-del-tx]').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      await supabaseClient.from('transactions').delete().eq('id', e.target.dataset.delTx);
      await loadPeriodData(); render(); activeTab='transaksi'; render();
    });
  });
}

function renderDarurat(){
  const panel = document.getElementById('panel-darurat');
  const target = totalBudget()>0 ? totalBudget()*6 : totalIncome()*3;
  const ef = totalEmergencyFund();
  const pct = target>0 ? Math.min(100,(ef/target)*100) : 0;
  const rows = STATE.emergencyFund;

  panel.innerHTML = `
    <h2 class="section-title">Dana Darurat</h2>
    <div class="ef-progress">
      <div class="ef-labels"><span>Terkumpul: <b>${formatRp(ef)}</b></span><span>Target (6x anggaran bulan ini): ${formatRp(target)}</span></div>
      <div class="ef-bar-track"><div class="ef-bar-fill" style="width:${pct}%"></div></div>
      <div class="ef-labels"><span>${pct.toFixed(1)}% tercapai</span></div>
    </div>

    <h2 class="section-title">Tambah Setoran</h2>
    <div class="form-card">
      <div class="form-grid">
        <div class="field"><label>Tanggal</label><input type="date" id="efDate" value="${todayStr()}"></div>
        <div class="field"><label>Keterangan</label><input type="text" id="efDesc" placeholder="Setoran bulanan"></div>
        <div class="field"><label>Jumlah (Rp)</label><input type="number" id="efAmount" min="0" placeholder="0"></div>
        <button class="btn-primary" id="efAddBtn">+ Simpan</button>
      </div>
    </div>

    <h2 class="section-title">Riwayat Setoran</h2>
    <table>
      <thead><tr><th>Tanggal</th><th>Keterangan</th><th>Oleh</th><th style="text-align:right">Jumlah</th><th></th></tr></thead>
      <tbody>
        ${rows.map(e=>`
          <tr>
            <td>${e.ef_date}</td>
            <td>${e.description||'-'}</td>
            <td class="who">${e.by_user||'-'}</td>
            <td class="amount">${formatRp(e.amount)}</td>
            <td><button class="del-row" data-del-ef="${e.id}">✕</button></td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${rows.length===0 ? '<div class="empty">Belum ada setoran dana darurat.</div>' : ''}
  `;

  document.getElementById('efAddBtn').addEventListener('click', async ()=>{
    const date = document.getElementById('efDate').value || todayStr();
    const description = document.getElementById('efDesc').value.trim();
    const amount = Number(document.getElementById('efAmount').value)||0;
    if(amount<=0){ alert('Isi jumlah setoran terlebih dahulu.'); return; }
    await supabaseClient.from('emergency_fund').insert({ef_date:date, description, amount, by_user:USER_NAME});
    await loadEmergencyFund(); render(); activeTab='darurat'; render();
  });
  panel.querySelectorAll('[data-del-ef]').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      await supabaseClient.from('emergency_fund').delete().eq('id', e.target.dataset.delEf);
      await loadEmergencyFund(); render(); activeTab='darurat'; render();
    });
  });
}

init();
