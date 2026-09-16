const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
  const records=new Map([['staff/one',{name:'Before',nickname:'N',bank_account:'0012345',pin_hash:'private',role:'staff',rate:500}],['staff/two',{name:'Other'}]]);
  let access=0;const snapshot=key=>({exists:records.has(key),data:()=>records.get(key)});
  const db={collection:c=>({doc:id=>({key:c+'/'+id,get:async()=>{access++;return snapshot(c+'/'+id);}})}),runTransaction:async fn=>fn({get:async ref=>snapshot(ref.key),update:(ref,data)=>records.set(ref.key,{...records.get(ref.key),...data}),set:(ref,data,options)=>records.set(ref.key,options?.merge?{...records.get(ref.key),...data}:data)})};
  const context={exports:{},Buffer,require:name=>{assert.equal(name,'firebase-admin/firestore');return {getFirestore:()=>{access++;return db;}};}};
  vm.runInNewContext(fs.readFileSync(require.resolve('./profile'),'utf8'),context);
  return {handle:context.exports.handle,records,access:()=>access};
}
const user={staff_id:'one',role:'staff'};
test('employee cannot read or change another employee, even by forged staff_id',async()=>{
  const s=setup();for(const action of ['getEmployeeProfile','saveEmployeeProfile','getEmployeeDocument','saveEmployeeDocument'])await assert.rejects(s.handle({action,staff_id:'two'},user),e=>e.status===403);assert.equal(s.access(),0);
});
test('admin can read another profile but cannot change it through self-service API',async()=>{
  const s=setup(),admin={staff_id:'admin',role:'admin'};assert.equal((await s.handle({action:'getEmployeeProfile',staff_id:'one'},admin)).name,'Before');await assert.rejects(s.handle({action:'saveEmployeeProfile',staff_id:'one'},admin),e=>e.status===403);
});
test('profile response omits authentication and payroll fields',async()=>{
  const p=await setup().handle({action:'getEmployeeProfile'},user);assert(!('pin_hash' in p));assert(!('rate' in p));assert(!('role' in p));
});
test('self edits only allowed fields, preserving leading zero and login/payroll data',async()=>{
  const s=setup();await s.handle({action:'saveEmployeeProfile',name:'New Name',nickname:'New',age:'27',address:'Current address',bank_account:'0012345678',role:'admin',rate:9000,pin:'0000'},user);
  const r=s.records.get('staff/one');assert.equal(r.name,'New Name');assert.equal(r.bank_account,'0012345678');assert.equal(r.role,'staff');assert.equal(r.rate,500);assert.equal(r.pin_hash,'private');assert.equal(s.records.get('employee_profiles/one').age,27);
});
test('document replacement is private and rejects invalid kinds or oversized data',async()=>{
  const s=setup(),image='data:image/jpeg;base64,'+Buffer.from([255,216,1,2,255,217]).toString('base64');
  await s.handle({action:'saveEmployeeDocument',kind:'id_card',image},user);assert.equal((await s.handle({action:'getEmployeeDocument',kind:'id_card'},user)).image,image);
  await assert.rejects(s.handle({action:'getEmployeeDocument',staff_id:'one',kind:'id_card'},{staff_id:'two',role:'staff'}),e=>e.status===403);
  for(const body of [{kind:'../id_card',image},{kind:'id_card',image:'data:image/svg+xml;base64,AA=='},{kind:'id_card',image:'x'.repeat(700001)}])await assert.rejects(s.handle({action:'saveEmployeeDocument',...body},user));
});
