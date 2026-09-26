const test = require('node:test');
const assert = require('node:assert/strict');
const snapshot = require('./sales-snapshot.json');
const products = require('../sales-products.js');

test('product detail counts completed orders, drinks and selected toppings', () => {
  const all = products.summarize(snapshot.items, snapshot.orders);
  const food = products.summarize(snapshot.items, snapshot.orders, '', '', 'อาหาร');
  const drinks = products.summarize(snapshot.items, snapshot.orders, '', '', 'เครื่องดื่ม');
  const toppings = products.summarize(snapshot.items, snapshot.orders, '', '', 'ท็อปปิ้ง');
  assert.equal(all.coveredOrders, 65);
  assert.equal(food.totalUnits + drinks.totalUnits, 90);
  assert.equal(drinks.totalUnits, 4);
  assert.equal(toppings.totalUnits, 11);
  assert.equal(all.totalUnits, 101);
  assert.equal(products.summarize(snapshot.items, snapshot.orders, 'LINE MAN').totalUnits, 0);
  assert.equal(products.summarize(snapshot.items, snapshot.orders, 'ShopeeFood').coveredOrders, 30);
  assert.equal(products.summarize(snapshot.items, snapshot.orders, 'GrabFood').coveredOrders, 35);
});

test('cancelled lines are omitted and add-ons scale with quantity', () => {
  const orders = [{id:'1',platform:'GrabFood',status:'Completed'}, {id:'2',platform:'GrabFood',status:'Cancelled'}];
  const items = [
    {orderId:'1',platform:'GrabFood',name:'ชาไทย',quantity:2,toppings:['เพิ่มไก่ +15']},
    {orderId:'2',platform:'GrabFood',name:'น้ำเก๊กฮวย',quantity:9,toppings:[]}
  ];
  const result = products.summarize(items, orders);
  assert.equal(result.totalUnits, 4);
  assert.deepEqual(result.rows.map(x => [x.name,x.quantity]), [['ชาไทย',2],['เพิ่มไก่',2]]);
});
