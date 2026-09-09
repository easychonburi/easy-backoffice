const backendRequire=require('node:module').createRequire(require('node:path').resolve(__dirname,'../functions/package.json'));
const {initializeApp}=backendRequire('firebase-admin/app');
const {getFirestore}=backendRequire('firebase-admin/firestore');
const {hashPin}=require('../functions/src/auth.cjs');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Demo seed requires Firestore emulator');
initializeApp({projectId:'demo-easy-backoffice'});
(async()=>{
 const db=getFirestore(),batch=db.batch();
 for(const [staff_id,role,pin] of [['TEST_ADMIN','admin','1234'],['TEST_STAFF','staff','2345'],['TEST_DRIVER','driver','3456']]){
 batch.set(db.doc('staff/'+staff_id),{staff_id,role,name:staff_id,nickname:staff_id,status:'active',branch_id:'BR001',shift:'morning',staff_type:'fulltime',pay_type:'daily',rate:400,ot_rate:50});
 batch.set(db.doc('credentials/'+staff_id),hashPin(pin));}
 batch.set(db.doc('branches/BR001'),{branch_id:'BR001',name:'สาขาทดสอบ',lat:13,lng:101,allowed_radius_m:100,status:'active'});
 for(const [key,value] of Object.entries({shift_morning_start:'09:00',shift_morning_end:'17:00',shift_night_start:'17:00',shift_night_end:'01:00',late_grace_min:15,ot_grace_min:15}))batch.set(db.doc('settings/'+key),{key,value});
 await batch.commit();console.log('Demo accounts: TEST_ADMIN/1234, TEST_STAFF/2345, TEST_DRIVER/3456 (emulator only)');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
