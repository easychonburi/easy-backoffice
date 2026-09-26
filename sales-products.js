// Product counts are separate from order sales. Selected add-ons count as units,
// but bundled/free ingredients are not inferred from a menu title.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.easySalesProducts = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  function label(name) {
    return String(name || '')
      .replace(/^(?:\[[^\]]+\]|\(ลด\s*\d+%\))\s*/u, '')
      .replace(/หมี่ไก่ฉีก\s*สูตร/gu, 'หมี่ไก่ฉีก สูตร')
      .replace(/^ชาไทยเย็นๆชื่นใจ$/u, 'ชาไทย')
      .replace(/\s+/gu, ' ').trim();
  }
  function category(name) {
    return /^(?:น้ำเก๊กฮวย|ชาไทย|น้ำดื่ม|น้ำอัดลม|กาแฟ|ชาเขียว)/u.test(name) ? 'เครื่องดื่ม' : 'อาหาร';
  }
  function toppingLabel(name) {
    return String(name || '').replace(/\s*\+\s*\d+(?:\.\d+)?\s*$/u, '').replace(/\s+/gu, ' ').trim();
  }
  function summarize(items, orders, platform = '', branch = '', type = '') {
    const valid = new Set(orders.filter(o => /^(Completed|Delivery Order)$/i.test(o.status)).map(o => o.platform + ':' + o.id));
    const selected = items.filter(i => valid.has(i.platform + ':' + i.orderId) &&
      (!platform || i.platform === platform) && (!branch || i.branch === branch));
    const coveredOrders = new Set(selected.map(i => i.platform + ':' + i.orderId)).size;
    const groups = new Map();
    const add = (name, variant, category, quantity) => {
      if (!quantity || !name || (type && type !== category)) return;
      const key = JSON.stringify([name, variant, category]);
      const row = groups.get(key) || {name, variant, category, quantity: 0};
      row.quantity += quantity;
      groups.set(key, row);
    };
    selected.forEach(i => {
      const quantity = Number(i.quantity) || 0;
      const name = label(i.name);
      add(name, String(i.variant || '').trim(), category(name), quantity);
      for (const topping of i.toppings || []) add(toppingLabel(topping), '', 'ท็อปปิ้ง', quantity);
    });
    const rows = [...groups.values()].sort((a,b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'th') || a.variant.localeCompare(b.variant, 'th'));
    return {rows, coveredOrders, totalUnits: rows.reduce((n,r) => n + r.quantity, 0)};
  }
  return {summarize, label, category, toppingLabel};
});
