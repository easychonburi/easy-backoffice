const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const core=require('./payroll-core');
const person={staff_id:'sample',staff_type:'parttime',pay_type:'hourly',shift:'night',custom_shift_start:'17:00:00',custom_shift_end:'21:00:00',rate:50,ot_rate:50};
const row=(clock_in,clock_out,date='2026-09-12')=>({staff_id:'sample',clock_in,clock_out,date,ot_hours:20,ot_status:'approved'});
test('sheet time parsing preserves hours and rejects malformed values',()=>{
  assert.equal(core.parseTime('21:00:00'),1260);
  assert.equal(core.parseTime('1899-12-30T01:00:00'),60);
  assert.equal(core.parseTime(0.875),1260);
  for(const value of ['',null,'21','25:00','17:60'])assert.equal(core.parseTime(value),null);
});
test('reported custom shift is zero OT, including the grace period',()=>{
  for(const out of ['21:00','21:02','21:04','21:15'])assert.equal(core.attendance(person,row('17:57',out)).ot_hours,0);
  assert.equal(core.attendance(person,row('17:57','21:16')).ot_hours,0.27);
});
test('overnight global shift distinguishes early exit from next-day OT',()=>{
  const night={...person,staff_type:'fulltime',custom_shift_start:'',custom_shift_end:''};
  assert.equal(core.attendance(night,row('17:00','21:00')).ot_hours,0);
  assert.equal(core.attendance(night,row('17:00','01:00')).base_hours,8);
  assert.equal(core.attendance(night,row('17:00','01:30')).ot_hours,0.5);
  assert.equal(core.attendance(night,row('00:10','01:30')).ot_hours,0.5);
});
test('Sunday keeps EASY 10:30–20:00 rule; flexible staff have no invented OT',()=>{
  assert.equal(core.attendance(person,row('10:30','20:30','2026-09-13')).ot_hours,0.5);
  assert.equal(core.attendance({...person,custom_shift_start:'',custom_shift_end:''},row('17:00','21:00')).ot_hours,0);
});
test('payroll recalculates corrupt stored OT; approved and pending use same hours',()=>{
  const result=core.calculate(person,[row('17:57','21:00')],[],{},'2026-09-07','2026-09-13');
  assert.equal(result.ot_pay,0);assert.equal(result.base_pay,152.5);assert.equal(result.details[0].ot_hours,0);
  const pending=core.calculate(person,[{...row('17:00','21:30'),ot_status:'pending'}],[],{},'2026-09-07','2026-09-13');
  assert.equal(pending.ot_pay,0);assert.equal(pending.pendingOTs[0].ot_hours,0.5);
  assert.equal(core.calculate(person,[row('17:00','21:30')],[],{},'2026-09-07','2026-09-13').ot_pay,25);
});
test('browser and employee backend produce identical payroll',()=>{
  const context={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('./payroll-core'),'utf8'),context);
  const args=[person,[row('17:57','21:00'),row('17:00','21:30')],[],{},'2026-09-07','2026-09-13'];
  assert.equal(JSON.stringify(context.window.EasyPayroll.calculate(...args)),JSON.stringify(core.calculate(...args)));
});
