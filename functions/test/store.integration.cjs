const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {initializeApp}=require('firebase-admin/app');const {getFirestore}=require('firebase-admin/firestore');
const {run}=require('../src/store.cjs');const {login,hashPin}=require('../src/auth.cjs');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Integration tests require emulator');
initializeApp({projectId:'demo-easy-backoffice'});const db=getFirestore();
const now=new Date('2026-09-09T02:00:00Z');
test('admin settings reject stale edits and assigned branch deactivation',async()=>{
 const id='CONFIG_'+randomUUID();await seed(id,'admin');
 const branch={branch_id:'BR001',name:'Demo branch',lat:13,lng:101,allowed_radius_m:100,status:'active',expected_version:0};
 assert.equal((await run(db,id,'saveBranch',branch,randomUUID(),now)).success,true);
 await assert.rejects(()=>run(db,id,'saveBranch',branch,randomUUID(),now),/แก้ไขแล้ว/);
 await assert.rejects(()=>run(db,id,'saveBranch',{...branch,status:'inactive',expected_version:1},randomUUID(),now),/ใช้งานอยู่/);
});
test('admin data pagination has no overlap and excludes credentials',async()=>{
 const id='DATA_'+randomUUID();await seed(id,'admin');const batch=db.batch();
 for(let i=0;i<105;i++)batch.set(db.collection('leaves').doc(id+'_'+i),{staff_id:id,date:'2099-01-01',leave_type:'ลากิจ'});
 await batch.commit();const query={collection:'leaves',date_from:'2099-01-01',date_to:'2099-01-01'};
 const first=await run(db,id,'getAdminData',query,undefined,now);assert.equal(first.data.length,100);assert(first.next_cursor);
 const second=await run(db,id,'getAdminData',{...query,cursor:first.next_cursor},undefined,now);
 assert(second.data.length>0);assert(second.data.every(r=>!first.data.some(a=>a._id===r._id)));
 await assert.rejects(()=>run(db,id,'getAdminData',{collection:'credentials'},undefined,now),/Invalid table/);
});
test('PIN reset invalidates the previous auth version and is idempotent',async()=>{
 const admin='RESETADMIN_'+randomUUID(),staff='RESET_'+randomUUID();await seed(admin,'admin');await seed(staff);
 const {setPin}=require('../src/auth.cjs'),request=randomUUID();
 await setPin(db,admin,staff,'6789',request);await setPin(db,admin,staff,'6789',request);
 assert.equal((await db.doc('staff/'+staff).get()).data().auth_version,1);
 const result=await login(db,{createCustomToken:async(uid,claims)=>{assert.equal(claims.auth_version,1);return 'test';}},staff,'6789',staff,now);
 assert(result.success);await assert.rejects(()=>setPin(db,staff,admin,'1234',randomUUID()),/FORBIDDEN/);
});
async function seed(id,role='staff'){
 await db.doc('staff/'+id).set({staff_id:id,role,status:'active',name:'Demo',nickname:'Demo',branch_id:'BR001',shift:'morning',pay_type:'daily',staff_type:'fulltime',rate:400});
 await db.doc('branches/BR001').set({branch_id:'BR001',name:'Demo branch',status:'active',lat:13,lng:101,allowed_radius_m:100});
 await db.doc('settings/shift_morning_start').set({key:'shift_morning_start',value:'09:00'});
 await db.doc('settings/shift_morning_end').set({key:'shift_morning_end',value:'17:00'});
}
test('ten simultaneous clock-ins produce one attendance record',async()=>{
 const id='CONCURRENT_'+randomUUID();await seed(id);
 const results=await Promise.all(Array.from({length:10},()=>run(db,id,'clockIn',{lat:13,lng:101},randomUUID(),now)));
 assert.equal(results.filter(r=>r.success).length,1);
 assert.equal((await db.collection('timesheets').where('staff_id','==',id).get()).size,1);
});
test('retry with same request ID returns original result without duplicate writes',async()=>{
 const id='RETRY_'+randomUUID();await seed(id);const request=randomUUID();
 const results=await Promise.all(Array.from({length:5},()=>run(db,id,'clockIn',{lat:13,lng:101},request,now)));
 assert(results.every(r=>r.success));assert.equal(new Set(results.map(r=>r.record_id)).size,1);
});
test('parallel payroll confirmations deduct advance once and create one payroll',async()=>{
 const admin='ADMIN_'+randomUUID(),staff='PAY_'+randomUUID();await seed(admin,'admin');await seed(staff);
 await db.doc('timesheets/TS_'+staff).set({record_id:'TS_'+staff,staff_id:staff,date:'2026-09-09',clock_in:'09:00',clock_out:'17:00',late_min:0});
 await db.doc('advances/ADV_'+staff).set({advance_id:'ADV_'+staff,staff_id:staff,status:'pending',amount:100,period_start:'2026-09-01',period_end:'2026-09-15'});
 const b={staff_id:staff,period_start:'2026-09-01',period_end:'2026-09-15',pay_date:'2026-09-16',total_pay:300};
 const results=await Promise.all(Array.from({length:5},()=>run(db,admin,'savePayrollRun',b,randomUUID(),now)));
 assert.equal(results.filter(r=>r.success).length,1);
 assert.equal((await db.collection('payroll_runs').where('staff_id','==',staff).get()).size,1);
 assert.equal((await db.doc('advances/ADV_'+staff).get()).data().status,'deducted');
});
test('forged role cannot access another employee or admin data',async()=>{
 const id='ROLE_'+randomUUID();await seed(id);
 await assert.rejects(()=>run(db,id,'getStaff',{role:'admin'},undefined,now),/FORBIDDEN/);
 await assert.rejects(()=>run(db,id,'getTimesheets',{staff_id:'OTHER'},undefined,now),/FORBIDDEN/);
});
test('parallel PIN guesses are limited before verification',async()=>{
 const id='PIN_'+randomUUID();await seed(id);await db.doc('credentials/'+id).set(hashPin('2345'));
 const auth={createCustomToken:async()=> 'test-only-token'};
 const outcomes=await Promise.allSettled(Array.from({length:10},()=>login(db,auth,id,'2345',id,now)));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,5);
 assert(outcomes.filter(r=>r.status==='rejected').every(r=>r.reason.message.includes('15')));
});
