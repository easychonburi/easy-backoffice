// Read-only design preview. The source sheet snapshot is served by the admin API.
const $ = id => document.getElementById(id);
const baht = n => '฿' + n.toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const money = v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const branchName = v => (v.match(/\(([^)]+)\)$/) || [null, v])[1];
const complete = o => /^(Completed|Delivery Order)$/i.test(o.status);
const timeOf = o => (o.completedAt.match(/\b(\d{1,2}:\d{2})\b/) || [,'—'])[1];
let snapshot, page = 0, currentOrders = [];
const size = 15;

function selected(list) {
  const platform = $('platform').value, branch = $('branch').value;
  return list.filter(row => (!platform || row.platform === platform) && (!branch || row.branch === branch));
}
function totals(orders, finance) {
  const done = orders.filter(complete);
  return {
    count: done.length,
    cancelled: orders.length - done.length,
    sales: done.reduce((n, o) => n + money(o.sales), 0),
    received: finance.reduce((n, f) => n + money(f.transfer) + money(f.government), 0)
  };
}
function rowHTML(label, stats, maximum, kind) {
  return `<div class="row ${kind}"><div class="row-main"><div class="row-title"><span title="${esc(label)}">${esc(label)}</span><span>${baht(stats.sales)}</span></div><div class="row-sub">${stats.count} ออเดอร์ · ยอดรับตามรายงาน ${baht(stats.received)}</div><div class="bar"><i style="width:${maximum ? 100 * stats.sales / maximum : 0}%"></i></div></div></div>`;
}
function renderGroups(orders, finance, field, id, kind) {
  const names = [...new Set([...orders.map(o => o[field]), ...finance.map(f => f[field])])];
  const groups = names.map(name => {
    const stats = totals(orders.filter(o => o[field] === name), finance.filter(f => f[field] === name));
    return {name, stats};
  }).sort((a,b) => b.stats.sales - a.stats.sales);
  const maximum = groups[0]?.stats.sales || 0;
  $(id).innerHTML = groups.map(g => rowHTML(field === 'branch' ? branchName(g.name) : g.name, g.stats, maximum, kind)).join('') || '<div class="empty">ไม่มีข้อมูลในตัวกรองนี้</div>';
}
function renderProducts(orders) {
  const filtered = selected(snapshot.orders).filter(complete);
  const {rows, coveredOrders, totalUnits} = easySalesProducts.summarize(
    snapshot.items || [], snapshot.orders, $('platform').value, $('branch').value, $('product-category').value);
  const platform = $('platform').value;
  $('product-coverage').textContent = `ข้อมูลรายการสินค้าจาก ShopeeFood และ GrabFood ครอบคลุม ${coveredOrders} จาก ${filtered.length} ออเดอร์สำเร็จในตัวกรองนี้${!platform || platform === 'LINE MAN' ? ' · LINE MAN ยังไม่มีรายละเอียดสินค้า' : ''} · นับท็อปปิ้งที่เลือกเพิ่มแยกจากสินค้า ไม่แยกส่วนประกอบที่แถมในเซ็ต`;
  $('product-total').textContent = `${rows.length} รายการ · ${totalUnits} ชิ้น/รายการเพิ่ม`;
  const display = r => esc(r.name) + (r.variant ? ` <small>${esc(r.variant)}</small>` : '');
  $('top-products').innerHTML = rows.slice(0,5).map((r,i) => `<div class="product-item"><span class="rank">${i+1}</span><div class="product-name">${display(r)}<small>${esc(r.category === 'อาหาร' ? 'อาหาร / ของทานคู่' : r.category)}</small></div><span class="product-qty">${r.quantity} ชิ้น</span></div>`).join('') || '<div class="empty">ไม่มีข้อมูลสินค้าสำหรับตัวกรองนี้</div>';
  $('product-rows').innerHTML = rows.map(r => `<tr><td>${display(r)}<div class="category">${esc(r.category === 'อาหาร' ? 'อาหาร / ของทานคู่' : r.category)}</div></td><td class="num">${r.quantity}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">ไม่มีข้อมูลสินค้า</td></tr>';
}
function renderOrders() {
  const q = $('search').value.trim().toLocaleLowerCase();
  const matching = currentOrders.filter(o => !q || [o.id, o.platform, o.branch].some(v => v.toLocaleLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(matching.length / size));
  page = Math.min(page, pages - 1);
  const rows = matching.slice(page * size, (page + 1) * size);
  $('order-rows').innerHTML = rows.map(o => `<tr data-id="${esc(o.id)}"><td>${esc(timeOf(o))}</td><td>${esc(o.id)}</td><td>${esc(o.platform)}</td><td>${esc(branchName(o.branch))}</td><td><span class="pill ${complete(o) ? '' : 'cancel'}">${complete(o) ? 'สำเร็จ' : 'ยกเลิก'}</span></td><td class="num">${baht(money(o.sales))}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">ไม่พบออเดอร์</td></tr>';
  $('page-label').textContent = `${matching.length ? page * size + 1 : 0}–${Math.min((page + 1) * size, matching.length)} จาก ${matching.length}`;
  $('page-prev').disabled = page === 0;
  $('page-next').disabled = page >= pages - 1;
}
function render() {
  const orders = selected(snapshot.orders), finance = selected(snapshot.finance);
  const t = totals(orders, finance);
  $('sales').textContent = baht(t.sales);
  $('count').textContent = t.count.toLocaleString('th-TH');
  $('cancel-count').textContent = `${t.cancelled} ออเดอร์ยกเลิก (ไม่นับในยอดขาย)`;
  $('received').textContent = baht(t.received);
  $('rate').textContent = t.sales ? (100 * t.received / t.sales).toFixed(2) + '%' : '—';
  renderGroups(orders, finance, 'platform', 'platform-rows', 'platform-row');
  renderGroups(orders, finance, 'branch', 'branch-rows', 'branch');
  renderProducts(orders);
  currentOrders = orders.slice().sort((a,b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  page = 0;
  renderOrders();
}
function detail(id) {
  const o = currentOrders.find(item => item.id === id);
  if (!o) return;
  const cells = [
    ['เลขออเดอร์',o.id,'wide id'],['สถานะ',complete(o) ? 'สำเร็จ' : 'ยกเลิก'],['เวลา',o.completedAt || '—'],
    ['แพลตฟอร์ม',o.platform],['สาขา',branchName(o.branch)],['จำนวนสินค้า',o.items || '—'],
    ['ยอดก่อนส่วนลด',baht(money(o.gross))],['ยอดขายสุทธิ',baht(money(o.sales))],
    ['ยอดรับระดับออเดอร์',o.net ? baht(money(o.net)) : 'ไม่มีข้อมูล'],
    ['หมายเหตุ',o.note || '—','wide']
  ];
  const products = (snapshot.items || []).filter(i => i.platform === o.platform && i.orderId === o.id);
  if (products.length) cells.push(['รายการสินค้า',products.map(i => `${i.quantity} × ${i.name}${i.variant ? ' · '+i.variant : ''}${i.toppings?.length ? ' · '+i.toppings.join(', ') : ''}`).join(' | '),'wide']);
  $('order-detail').innerHTML = cells.map(([label,value,cls]) => `<div class="${cls || ''}"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
  $('order-dialog').showModal();
}
async function start() {
  await window.easyPageReady;
  if (!window.easyCurrentSession) return;
  if (window.easyCurrentSession.role !== 'admin') { location.replace('/clock.html'); return; }
  try {
    snapshot = await easyApi('getSalesPreview');
    const date = new Date(snapshot.snapshotDate + 'T12:00:00+07:00');
    $('date-label').textContent = date.toLocaleDateString('th-TH', {day:'numeric',month:'short',year:'numeric'});
    $('prev').disabled = $('next').disabled = true;
    $('snapshot-note').textContent = 'ตัวอย่างข้อมูลวันที่ 25 ก.ย. 2569 · มีข้อมูลเพียงวันเดียว จึงยังเลือกวันอื่นไม่ได้';
    $('source').href = snapshot.source;
    for (const platform of [...new Set(snapshot.orders.map(o => o.platform))].sort()) $('platform').add(new Option(platform,platform));
    for (const branch of [...new Set(snapshot.finance.map(f => f.branch).concat(snapshot.orders.map(o => o.branch)))].sort((a,b) => branchName(a).localeCompare(branchName(b),'th'))) $('branch').add(new Option(branchName(branch),branch));
    render();
  } catch(error) {
    $('snapshot-note').textContent = 'โหลดข้อมูลยอดขายไม่สำเร็จ: ' + error.message;
  }
}
$('platform').addEventListener('change', render);
$('branch').addEventListener('change', render);
$('product-category').addEventListener('change', () => renderProducts(selected(snapshot.orders)));
$('search').addEventListener('input', () => {page = 0; renderOrders();});
$('page-prev').addEventListener('click', () => {page--; renderOrders();});
$('page-next').addEventListener('click', () => {page++; renderOrders();});
$('order-rows').addEventListener('click', e => {const row = e.target.closest('tr[data-id]'); if (row) detail(row.dataset.id);});
$('close-dialog').addEventListener('click', () => $('order-dialog').close());
start();
