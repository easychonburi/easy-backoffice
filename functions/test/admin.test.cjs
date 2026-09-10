const test=require('node:test'),assert=require('node:assert/strict');
const {execute}=require('../src/domain.cjs');const {authorize}=require('../src/policy.cjs');
const admin={staff_id:'ADMIN',status:'active',role:'admin'},staff={...admin,role:'staff'};
test('admin configuration and table browser are forbidden to staff',()=>{for(const action of ['saveSettings','saveBranch','saveShift','getAdminStaff','getAdminData'])assert.throws(()=>authorize(action,{},staff),/FORBIDDEN/);});
test('stale branch edits cannot overwrite a newer version',()=>{
 const tables={branches:[{branch_id:'B1',name:'Updated',version:2}]};
 assert.throws(()=>execute('saveBranch',{branch_id:'B1',name:'Stale',expected_version:1},tables),/แก้ไขแล้ว/);
 const result=execute('saveBranch',{branch_id:'B1',name:'New',expected_version:2},tables);assert.equal(result.result.success,true);assert.equal(tables.branches[0].version,3);
});
test('settings compare values independent of object key order and reject lost updates',()=>{
 const tables={settings:[{key:'late_grace_min',value:15},{key:'ot_grace_min',value:15}]};
 const result=execute('saveSettings',{values:{ot_grace_min:30,late_grace_min:15},expected:{ot_grace_min:15,late_grace_min:15}},tables);assert.equal(result.changes.length,2);
 assert.throws(()=>execute('saveSettings',{values:{ot_grace_min:20},expected:{ot_grace_min:15}},tables),/แก้ไขแล้ว/);
});
test('reject invalid GPS, integration secrets in public settings, and stored markup',()=>{
 assert.throws(()=>authorize('saveBranch',{name:'branch',lat:91,lng:100,allowed_radius_m:100,status:'active'},admin),/Invalid GPS/);
 assert.throws(()=>authorize('saveSettings',{values:{telegram_token:'secret'}},admin),/Invalid setting/);
 assert.throws(()=>authorize('updateStaff',{staff_id:'S1',name:'<script>'},admin),/Invalid text/);
});
test('create and edit shifts retain overnight times and versioning',()=>{
 const tables={shifts:[]};const body=authorize('saveShift',{name:'Night',start:'17:00',end:'01:00',status:'active'},admin);const first=execute('saveShift',body,tables);assert.equal(first.result.success,true);assert.equal(tables.shifts[0].end,'01:00');assert.equal(tables.shifts[0].version,1);
});
