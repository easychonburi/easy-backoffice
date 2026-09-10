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
  const qty=Number(body.qty),unit=String(body.unit||'').trim();
  if(body.qty===''||!Number.isFinite(qty)||qty<=0||qty>100000||!unit||unit.length>40||/[<>"'`]/.test(unit))bad();
  await db().runTransaction(async tx=>{const items=(await tx.get(ref)).data()?.items||{};if(!Object.hasOwn(items,body.item_name))bad();items[body.item_name]=`${qty} ${unit}`;tx.set(ref,{items});});return true;
};
