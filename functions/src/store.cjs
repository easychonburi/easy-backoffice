const {createHash}=require('node:crypto');
const {execute,day,cutoff,ids}=require('./domain.cjs');
const {authorize,writes}=require('./policy.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
const key=(collection,id)=>collection==='central_targets'?hash(id):id;
const plans={
  getAdminStaff:['staff'],getAdminBranches:['branches'],getShifts:['shifts'],saveBranch:['branches','staff'],saveShift:['shifts','staff'],saveSettings:['settings'],
  getStaff:['staff'],getSettings:['settings'],getBranches:['branches'],getStockItems:[],getCentralTargets:['central_targets'],updateCentralTarget:['central_targets'],
  clockIn:['staff','branches','settings','timesheets'],clockOut:['staff','settings','timesheets'],getTodayStatus:['staff','timesheets'],getTimesheets:['timesheets'],
  updateTimesheetOT:['timesheets'],upsertTimesheet:['staff','branches','settings','timesheets'],
  getPayrollRuns:['payroll_runs'],savePayrollRun:['staff','settings','timesheets','payroll_runs','advances'],markPaid:['payroll_runs'],
  getAdvances:['advances'],saveAdvance:['staff','advances'],
  saveStockLog:['staff','branches','settings','central_targets','stock_logs'],submitDriverReturn:['stock_logs'],
  getTodayStockOrders:['stock_logs','branches'],getDriverOrders:['stock_logs','branches'],getPendingPurchases:['stock_logs','branches'],
  getPickups:['driver_jobs'],approvePurchase:['driver_jobs','pending_purchases'],uploadDriverPhoto:['deliveries'],
  getLeaves:['leaves'],saveLeave:['leaves'],deleteLeave:['leaves'],addStaff:['staff'],updateStaff:['staff'],updateStaffStatus:['staff']
};
function queryFor(db,name,action,b,now,actor){
  let q=db.collection(name);
  if(['saveStockLog','submitDriverReturn','saveAdvance','uploadDriverPhoto','addStaff'].includes(action)&&name==={saveStockLog:'stock_logs',submitDriverReturn:'stock_logs',saveAdvance:'advances',uploadDriverPhoto:'deliveries',addStaff:'staff'}[action])return null;
  if(action==='approvePurchase'&&name==='driver_jobs')return null;
  if(name==='staff'&&b.staff_id&&action!=='getTodayStatus')q=q.where('staff_id','==',b.staff_id);
  if(name==='timesheets'){
    if(b.record_id&&action==='updateTimesheetOT')return q.where('record_id','==',b.record_id);
    if(b.staff_id)q=q.where('staff_id','==',b.staff_id);
    else if(actor.role!=='admin')q=q.where('staff_id','==',actor.staff_id);
    let from=b.period_start||b.date_from,to=b.period_end||b.date_to;
    if(['clockIn','clockOut','getTodayStatus'].includes(action)){from=day(new Date(+now-86400000));to=day(now);}
    if(action==='upsertTimesheet'){from=b.date;to=b.date;}
    if(from)q=q.where('date','>=',from);if(to)q=q.where('date','<=',to);
  }
  if(name==='payroll_runs'){
    if(b.staff_id)q=q.where('staff_id','==',b.staff_id);
    if(action==='savePayrollRun')q=q.where('period_start','==',b.period_start).where('period_end','==',b.period_end);
    if(b.run_id)q=q.where('run_id','==',b.run_id);
    if(b.status&&action==='getPayrollRuns')q=q.where('status','==',b.status);
  }
  if(name==='advances'){
    if(b.staff_id)q=q.where('staff_id','==',b.staff_id);
    if(b.status||action==='savePayrollRun')q=q.where('status','==',b.status||'pending');
    if(action==='savePayrollRun')q=q.where('period_start','==',b.period_start).where('period_end','==',b.period_end);
  }
  if(name==='stock_logs')q=q.where('checked_at','>=',action==='getDriverOrders'?new Date(+now-18*3600000).toISOString():cutoff(now));
  if(name==='driver_jobs')q=q.where('date','==',day(now));
  if(name==='pending_purchases')q=q.where('date','==',day(now));
  if(name==='leaves'){
    if(b.staff_id)q=q.where('staff_id','==',b.staff_id);
    if(b.leave_id)q=q.where('leave_id','==',b.leave_id);
    if(b.date)q=q.where('date','==',b.date);
    if(b.date_from)q=q.where('date','>=',b.date_from);if(b.date_to)q=q.where('date','<=',b.date_to);
  }
  return q;
}
async function runOnce(db,uid,action,input,requestId,now){
  const writing=writes.has(action);
  if(writing&&!/^[a-f0-9-]{36}$/i.test(requestId||''))throw Error('Missing request ID');
  return db.runTransaction(async tx=>{
    const account=await tx.get(db.collection('staff').doc(uid));
    const actor=account.exists?account.data():null;
    const b=authorize(action,input,actor,now);
    const requestRef=db.collection('requests').doc(hash(uid+':'+requestId));
    const fingerprint=hash(JSON.stringify({action,b}));
    if(writing){const prior=await tx.get(requestRef);if(prior.exists){if(prior.data().fingerprint!==fingerprint)throw Error('Request ID reused with different payload');return prior.data().result;}}
    // A concrete per-staff guard also protects empty query results from concurrent inserts.
    const guarded=['clockIn','clockOut','upsertTimesheet','savePayrollRun','saveAdvance','saveLeave','saveSettings'].includes(action);
    const guard=guarded?db.collection('write_guards').doc(hash(action==='saveSettings'?'settings':'staff:'+b.staff_id)):null;
    const guardVersion=guard?(await tx.get(guard)).data()?.version||0:0;
    if(action==='getAdminData')return await readAdminData(db,tx,b);
    const tables={};
    const names=[...plans[action]];
    if(['clockIn','clockOut','upsertTimesheet','savePayrollRun','addStaff','updateStaff'].includes(action)&&!names.includes('shifts'))names.push('shifts');
    if(['addStaff','updateStaff'].includes(action)&&!names.includes('branches'))names.push('branches');
    for(const name of names){
      const q=queryFor(db,name,action,b,now,actor);
      if(!q){tables[name]=[];continue;}
      const snap=await tx.get(q.limit(2001));
      if(snap.size>2000)throw Error('ข้อมูลเกิน 2,000 รายการ กรุณาระบุช่วงวันที่ให้แคบลง');
      tables[name]=snap.docs.map(d=>({...d.data(),...(ids[name]==='_id'?{_id:d.id}:{})}));
    }
    if(tables.staff&&b.staff_id&&!tables.staff.some(s=>s.staff_id===b.staff_id)&&action!=='addStaff')throw Error('ไม่พบพนักงาน');
    if(action==='upsertTimesheet'&&b.record_id&&!tables.timesheets.some(t=>t.record_id===b.record_id))throw Error('Record does not match staff/date');
    if(action==='saveShift'&&b.status==='inactive'&&tables.staff.some(s=>s.status==='active'&&s.shift_id===b.shift_id))throw Error('กะนี้ยังมีพนักงานใช้งานอยู่');
    if(action==='saveBranch'&&b.status==='inactive'&&tables.staff.some(s=>s.status==='active'&&s.branch_id===b.branch_id))throw Error('สาขานี้ยังมีพนักงานใช้งานอยู่');
    if(['updateStaff','updateStaffStatus'].includes(action)&&b.staff_id===uid&&(b.status==='inactive'||b.role&&b.role!=='admin'))throw Error('ไม่สามารถปิดสิทธิ์ผู้ดูแลของตัวเอง');
    if(['addStaff','updateStaff'].includes(action)){
      if(b.branch_id&&!tables.branches.some(r=>r.branch_id===b.branch_id&&r.status==='active'))throw Error('สาขาไม่ได้เปิดใช้งาน');
      if(b.shift_id&&!tables.shifts.some(r=>r.shift_id===b.shift_id&&r.status==='active'))throw Error('กะไม่ได้เปิดใช้งาน');
    }
    if(tables.shifts&&tables.staff&&!['addStaff','updateStaff'].includes(action))tables.staff=tables.staff.map(s=>{const shift=tables.shifts.find(r=>r.shift_id===s.shift_id);return shift?{...s,custom_shift_start:shift.start,custom_shift_end:shift.end,shift:shift.end<shift.start?'night':'morning'}:s;});
    const outcome=execute(action,b,tables,now);
    if(guard&&outcome.result.success)tx.set(guard,{version:guardVersion+1});
    if(outcome.changes.length+outcome.notifications.length>450)throw Error('Too many writes');
    for(const change of outcome.changes){const ref=db.collection(change.collection).doc(key(change.collection,change.id));if(change.type==='delete')tx.delete(ref);else tx.set(ref,change.data);}
    for(const [i,n] of outcome.notifications.entries())tx.set(db.collection('notification_outbox').doc(hash(uid+':'+requestId+':'+i)),{...n,status:'suppressed',reason:'staging',created_at:now.toISOString()});
    if(writing){tx.set(requestRef,{uid,action,fingerprint,result:outcome.result,created_at:now.toISOString()});if(outcome.result.success)tx.set(db.collection('audit_log').doc(hash(uid+':'+requestId)),{uid,action,created_at:now.toISOString(),records:outcome.changes.map(c=>({collection:c.collection,id:c.id,type:c.type}))});}
    return outcome.result;
  });
}
const dataCollections=new Set(['timesheets','leaves','advances','payroll_runs','stock_logs','driver_jobs','audit_log']);
async function readAdminData(db,tx,b){
  if(!dataCollections.has(b.collection))throw Error('Invalid table');
  let q=db.collection(b.collection);
  const field=b.collection==='stock_logs'?'checked_at':b.collection==='audit_log'?'created_at':b.collection==='payroll_runs'?'period_start':'date';
  const timestamp=['checked_at','created_at'].includes(field);
  if(b.date_from)q=q.where(field,'>=',timestamp?new Date(b.date_from+'T00:00:00+07:00').toISOString():b.date_from);
  if(b.date_to)q=q.where(field,'<=',timestamp?new Date(b.date_to+'T23:59:59.999+07:00').toISOString():b.date_to);
  const {FieldPath}=require('firebase-admin/firestore');q=q.orderBy(field,'desc').orderBy(FieldPath.documentId(),'desc');
  if(b.cursor){let c;try{c=JSON.parse(Buffer.from(b.cursor,'base64url').toString());}catch{throw Error('Invalid cursor');}if(!Array.isArray(c)||c.length!==2||!c.every(v=>typeof v==='string'))throw Error('Invalid cursor');q=q.startAfter(...c);}
  const snap=await tx.get(q.limit(101)),docs=snap.docs.slice(0,100),last=docs.at(-1);
  return {success:true,data:docs.map(d=>({_id:d.id,...d.data()})),next_cursor:snap.size>100?Buffer.from(JSON.stringify([last.data()[field],last.id])).toString('base64url'):null};
}
async function run(db,uid,action,input,requestId,now=new Date()){
  for(let attempt=0;;attempt++){
    try{return await runOnce(db,uid,action,input,requestId,now);}
    catch(e){
      // Some emulator/transport failures close the transaction without returning ABORTED.
      // Retrying the entire transaction is safe: no external effects occur inside it and
      // committed request IDs return their stored result.
      const transient=[10,14].includes(Number(e.code))||(Number(e.code)===3&&/Transaction is invalid or closed/.test(e.message));
      if(!transient||attempt>=2)throw e;
      await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));
    }
  }
}
module.exports={run,queryFor,key,hash};
