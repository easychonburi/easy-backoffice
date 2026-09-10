const test=require('node:test'),assert=require('node:assert/strict');
const {execute,cutoff}=require('../src/domain.cjs');
const {authorize}=require('../src/policy.cjs');
const now=new Date('2026-09-09T02:00:00Z');
const staff={staff_id:'TEST_STAFF',name:'Test',nickname:'Test',role:'staff',status:'active',branch_id:'BR001',shift:'morning',staff_type:'fulltime',pay_type:'daily',rate:400};
function fixture(){return {staff:[{...staff}],branches:[{branch_id:'BR001',name:'Test branch',lat:13,lng:101,allowed_radius_m:100,status:'active'}],settings:[{key:'shift_morning_start',value:'09:00'},{key:'shift_morning_end',value:'17:00'},{key:'ot_grace_min',value:15}],timesheets:[],payroll_runs:[],advances:[],leaves:[],stock_logs:[],central_targets:[],driver_jobs:[],pending_purchases:[]};}
test('staff cannot impersonate another person or read payroll',()=>{
 assert.throws(()=>authorize('clockIn',{staff_id:'OTHER'},staff),/FORBIDDEN/);
 assert.throws(()=>authorize('getStaff',{},staff),/FORBIDDEN/);
 assert.throws(()=>authorize('saveStockLog',{branch_id:'OTHER'},staff),/FORBIDDEN/);
});
test('server selects today and requires valid GPS',()=>{
 const b=authorize('clockIn',{date:'1999-01-01',lat:13,lng:101},staff,now);assert.equal(b.date,'2026-09-09');
 assert.throws(()=>authorize('clockIn',{lat:'x',lng:101},staff),/Invalid coordinates/);
});
test('attendance preserves contract and rejects repeated clock-in',()=>{
 const t=fixture(),b={staff_id:staff.staff_id,lat:13,lng:101,date:'2026-09-09'};
 const first=execute('clockIn',b,t,now);assert.equal(first.result.success,true);assert.equal(first.result.clock_in,'09:00');assert.equal(first.changes.length,1);
 const duplicate=execute('clockIn',b,t,now);assert.equal(duplicate.result.success,false);assert.equal(duplicate.changes.length,0);
});
test('out-of-area clock-in commits no writes or notifications',()=>{
 const out=execute('clockIn',{staff_id:staff.staff_id,lat:0,lng:0,date:'2026-09-09'},fixture(),now);assert.equal(out.result.success,false);assert.deepEqual(out.changes,[]);assert.deepEqual(out.notifications,[]);
});
test('night shift clock-out finds yesterday and computes overnight hours',()=>{
 const t=fixture();t.staff[0].shift='night';t.settings.push({key:'shift_night_end',value:'01:00'});t.timesheets=[{record_id:'TS1',staff_id:staff.staff_id,date:'2026-09-08',clock_in:'17:00',clock_out:''}];
 const out=execute('clockOut',{staff_id:staff.staff_id,date:'2026-09-09',lat:13,lng:101},t,new Date('2026-09-08T18:30:00Z'));assert.equal(out.result.success,true);assert.equal(out.result.hours_worked,8.5);assert.equal(out.result.ot_mins,30);
});
test('payroll and advance deduction are one outcome with server-calculated total',()=>{
 const t=fixture();t.timesheets=[{record_id:'TS1',staff_id:staff.staff_id,date:'2026-09-09',clock_in:'09:00',clock_out:'17:00',late_min:0}];t.advances=[{advance_id:'ADV1',staff_id:staff.staff_id,amount:100,status:'pending',period_start:'2026-09-01',period_end:'2026-09-15'}];
 const b={staff_id:staff.staff_id,period_start:'2026-09-01',period_end:'2026-09-15',total_pay:300};
 assert.throws(()=>execute('savePayrollRun',{...b,total_pay:999},structuredClone(t),now),/เปลี่ยน/);
 const out=execute('savePayrollRun',b,t,now);assert.equal(out.result.total_pay,300);assert.equal(t.advances[0].status,'deducted');assert.equal(out.changes.length,2);
 assert.equal(execute('savePayrollRun',b,t,now).result.success,false);
});
test('payroll blocks pending overtime',()=>{
 const t=fixture();t.timesheets=[{staff_id:staff.staff_id,date:'2026-09-09',clock_in:'09:00',ot_status:'pending'}];assert.throws(()=>execute('savePayrollRun',{staff_id:staff.staff_id,period_start:'2026-09-01',period_end:'2026-09-15'},t,now),/OT/);
});
test('settings never expose integration secrets and staff never expose PINs',()=>{
 const t=fixture();t.settings.push({key:'telegram_token',value:'private'});t.staff[0].pin='1234';assert.equal(execute('getSettings',{},t,now).result.data.telegram_token,undefined);assert.equal(execute('getStaff',{},t,now).result.data[0].pin,undefined);
});
test('stock period uses Bangkok noon across midnight',()=>{
 assert.equal(cutoff('2026-09-09T04:59:00Z'),'2026-09-08T05:00:00.000Z');assert.equal(cutoff('2026-09-09T05:00:00Z'),'2026-09-09T05:00:00.000Z');
});
test('leave writes have unique staff-date identity and delete correctly',()=>{
 const t=fixture(),b={staff_id:staff.staff_id,date:'2026-09-09',leave_type:'ลากิจ'};const first=execute('saveLeave',b,t,now);assert.equal(first.result.success,true);assert.equal(execute('saveLeave',b,t,now).result.success,false);assert.equal(execute('deleteLeave',{leave_id:first.result.leave_id},t,now).result.success,true);
});
