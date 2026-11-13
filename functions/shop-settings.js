'use strict';
const {getFirestore}=require('firebase-admin/firestore');
const db=()=>getFirestore();
const bad=()=>{throw Object.assign(Error('จำนวนหรือรายการไม่ถูกต้อง'),{status:400});};
exports.targets=async()=>(await db().collection('central_targets').get()).docs.map(d=>d.data());
exports.updateTarget=async body=>{
  if(typeof body.item_name!=='string'||body.target_qty===''||!Number.isFinite(Number(body.target_qty))||Number(body.target_qty)<0||Number(body.target_qty)>100000)bad();
  const rows=await db().collection('central_targets').where('item_name','==',body.item_name).get();if(rows.empty)bad();
  await rows.docs[0].ref.update({target_qty:Number(body.target_qty)});return true;
};
exports.quantities=async()=>((await db().collection('settings').doc('driver_order_quantities').get()).data()||{}).items||{};
exports.updateQuantity=async body=>{
  const ref=db().collection('settings').doc('driver_order_quantities');
  const original=body.item_name;
  const name=String(body.new_item_name??original??'').trim();
  const qty=Number(body.qty),unit=String(body.unit||'').trim();
  if(typeof original!=='string'||!name||name.length>100||/[<>"'`\x00-\x1f\x7f]/.test(name)||['__proto__','constructor','prototype'].includes(name))bad();
  if(body.qty===''||!Number.isFinite(qty)||qty<=0||qty>100000||!unit||unit.length>40||/[<>"'`]/.test(unit))bad();
  await db().runTransaction(async tx=>{
    const snapshot=await tx.get(ref);
    const items={...(snapshot.data()?.items||{})};
    if(original&&!Object.hasOwn(items,original))bad();
    if(name!==original&&Object.hasOwn(items,name))throw Object.assign(Error('มีชื่อรายการนี้อยู่แล้ว'),{status:409});
    if(original&&original!==name)delete items[original];
    items[name]=`${qty} ${unit}`;
    if(snapshot.exists)tx.update(ref,{items});else tx.set(ref,{items});
  });
  return true;
};
