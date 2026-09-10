'use strict';
// One-time staging defaults, never overwrites saved values or imports target quantities.
if(process.env.GOOGLE_CLOUD_PROJECT!=='easy-backoffice-simple-staging')throw Error('Staging project required');
require('firebase-admin/app').initializeApp();
const db=require('firebase-admin/firestore').getFirestore();
const defaults=require('./shop-defaults.json');
(async()=>{
  const existing=await db.collection('central_targets').get();
  for(const row of defaults.targets)if(!existing.docs.some(d=>d.data().item_name===row.item_name))await db.collection('central_targets').doc().set(row);
  const ref=db.collection('settings').doc('driver_order_quantities');
  await db.runTransaction(async tx=>{if(!(await tx.get(ref)).exists)tx.create(ref,{items:defaults.quantities});});
  console.log('Staging shop defaults ready; existing settings preserved.');
})().catch(()=>{console.error('Shop defaults setup failed');process.exitCode=1;});
