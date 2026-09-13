'use strict';
const {getFirestore}=require('firebase-admin/firestore');
const payroll=require('./payroll-core');
const db=()=>getFirestore();
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const rows=snapshot=>snapshot.docs.map(d=>({...d.data(),request_id:d.id}));
const own=name=>db().collection(name);
function periodFor(user,onDate){const p=payroll.getCurrentPeriods(onDate),ft=user.pay_type==='daily';return {start:ft?p.ftStart:p.ptStart,end:ft?p.ftEnd:p.ptEnd,payDate:ft?p.ftPayDate:p.ptPayDate};}
function payoutSunday(value){const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+(7-d.getUTCDay())%7);return d.toISOString().slice(0,10);}
function usedForSunday(requests,advances,sunday){
  const active=requests.filter(r=>r.type==='advance'&&['pending','approved'].includes(r.status));
  const ids=new Set(active.map(r=>r.request_id));
  const requested=active.filter(r=>(r.payout_date||payoutSunday(r.date))===sunday).reduce((n,r)=>n+Number(r.amount||0),0);
  const manual=advances.filter(a=>['pending','deducted'].includes(a.status)&&!ids.has(a.request_id)&&!ids.has(String(a.advance_id||'').replace(/^REQ_/,''))&&(a.payout_date||payoutSunday(a.date))===sunday).reduce((n,a)=>n+Number(a.amount||0),0);
  return requested+manual;
}
function validDate(value){const d=new Date(value+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
async function income(user){
  const period=periodFor(user);
  const [ts,adv,runs,requests,work]=await Promise.all(['timesheets','advances','payroll_runs','employee_requests'].map(name=>own(name).where('staff_id','==',user.staff_id).get()).concat(db().collection('settings').doc('work').get()));
  const timesheets=ts.docs.map(d=>d.data()).filter(t=>t.date>=period.start&&t.date<=period.end);
  const advances=adv.docs.map(d=>d.data());
  const run=runs.docs.map(d=>d.data()).find(r=>r.status==='paid'&&r.period_start===period.start&&r.period_end===period.end);
  const settings=work.data()||{};
  const result=payroll.calculate(user,timesheets,advances,settings,period.start,period.end);
  let summary={base:result.base_pay,otApproved:result.ot_pay,late:result.late_deduct,early:0,adjust:0,advance:result.advance_total,total:result.total};
  let attendance=result.details;
  if(run){summary={base:Number(run.base_pay||0),otApproved:Number(run.ot_pay||0),late:Number(run.late_deduct||0),early:Number(run.early_out_deduct||0),adjust:Number(run.manual_adjust||0),advance:Number(run.advance_total??advances.filter(a=>(run.advance_ids||[]).includes(a.advance_id)).reduce((n,a)=>n+Number(a.amount||0),0)),total:Number(run.total_pay||0)};attendance=run.details||[];}
  const pending=run?[]:result.pendingOTs;
  const pendingHours=pending.reduce((n,t)=>n+Number(t.ot_hours||0),0);
  const allRequests=rows(requests).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const currentDay=today(),payoutDate=payoutSunday(currentDay),remaining=Math.max(0,1000-usedForSunday(allRequests,advances,payoutDate));
  return {period:{...period,payDate:run?.pay_date||period.payDate},summary,paid:Boolean(run),missingHistory:Boolean(run&&!run.details),attendance:attendance.sort((a,b)=>b.date.localeCompare(a.date)),otPendingHours:pendingHours,otPendingAmount:Math.round(pendingHours*(Number(user.ot_rate)||Number(settings.ot_rate_per_hour)||50)*100)/100,pendingAdvance:allRequests.filter(r=>r.type==='advance'&&r.status==='pending'&&r.period_start===period.start&&r.period_end===period.end).reduce((n,r)=>n+r.amount,0),requests:allRequests.slice(0,30),today:currentDay,canAdvance:remaining>=500,advanceRemaining:remaining,advancePayoutDate:payoutDate,advancePeriod:periodFor(user,payoutDate)};
}
async function submit(body,user){
  if(!['leave','advance'].includes(body.type))fail('ประเภทคำขอไม่ถูกต้อง');
  if(typeof body.request_id!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(body.request_id))fail('กรุณาเปิดแบบฟอร์มใหม่');
  const date=today(),payoutDate=payoutSunday(date),period=periodFor(user,payoutDate);
  const request={request_id:body.request_id,staff_id:user.staff_id,staff_name:user.nickname||user.name,branch_id:user.branch_id||'',type:body.type,status:'pending',created_at:new Date().toISOString()};
  if(body.type==='leave'){
    if(!['ลากิจ','ลาป่วย'].includes(body.leave_type)||!validDate(body.date)||body.date<date)fail('เลือกประเภทลาและวันที่ตั้งแต่วันนี้เป็นต้นไป');
    if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.trim().length>500)fail('กรอกเหตุผลการลาไม่เกิน 500 ตัวอักษร');
    Object.assign(request,{date:body.date,leave_type:body.leave_type,reason:body.reason.trim()});
  }else{
    if(![500,1000].includes(body.amount))fail('เลือกยอดเบิก 500 หรือ 1,000 บาท');
    Object.assign(request,{date,payout_date:payoutDate,amount:body.amount,period_start:period.start,period_end:period.end,pay_date:period.payDate});
  }
  const ref=own('employee_requests').doc(body.request_id);
  await db().runTransaction(async tx=>{
    const existing=await tx.get(ref);
    if(existing.exists){if(existing.data().staff_id!==user.staff_id)fail('คำขอไม่ถูกต้อง');return;}
    const runs=await tx.get(own('payroll_runs').where('staff_id','==',user.staff_id));
    const coveredDate=request.type==='leave'?request.date:request.period_start;
    if(runs.docs.some(d=>{const r=d.data();return r.status==='paid'&&r.period_start<=coveredDate&&r.period_end>=coveredDate;}))fail('รอบนี้จ่ายเงินแล้ว');
    if(request.type==='leave'){
      const [pending,leave]=await Promise.all([tx.get(own('employee_requests').where('staff_id','==',user.staff_id)),tx.get(own('leaves').doc(user.staff_id+'_'+request.date))]);
      if(leave.exists||pending.docs.some(d=>{const r=d.data();return r.type==='leave'&&r.date===request.date&&r.status==='pending';}))fail('วันที่นี้มีรายการลาหรือคำขอรออนุมัติแล้ว');
    }
    if(request.type==='advance'){
      const guard=own('employee_advance_limits').doc(user.staff_id+'_'+payoutDate);
      const [existingRequests,existingAdvances]=await Promise.all([tx.get(own('employee_requests').where('staff_id','==',user.staff_id)),tx.get(own('advances').where('staff_id','==',user.staff_id)),tx.get(guard)]);
      const used=usedForSunday(rows(existingRequests),existingAdvances.docs.map(d=>d.data()),payoutDate);
      if(used+request.amount>1000)fail('วันอาทิตย์นี้เบิกได้รวมไม่เกิน 1,000 บาท (วงเงินเหลือ '+Math.max(0,1000-used)+' บาท)');
      tx.set(guard,{staff_id:user.staff_id,payout_date:payoutDate,last_request_id:ref.id});
    }
    tx.create(ref,request);
  });
  return {request_id:ref.id};
}
async function decide(body,user){
  if(user.role!=='admin')fail('เฉพาะผู้ดูแล',403);
  if(typeof body.request_id!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(body.request_id)||!['approved','rejected'].includes(body.decision))fail('คำขอไม่ถูกต้อง');
  const ref=own('employee_requests').doc(body.request_id);
  await db().runTransaction(async tx=>{
    const snapshot=await tx.get(ref);if(!snapshot.exists)fail('ไม่พบคำขอ');const r=snapshot.data();
    if(r.status===body.decision)return;if(r.status!=='pending')fail('คำขอนี้ดำเนินการแล้ว');
    let target,row;
    if(body.decision==='approved'){
      const [person,runs]=await Promise.all([tx.get(own('staff').doc(r.staff_id)),tx.get(own('payroll_runs').where('staff_id','==',r.staff_id))]);
      if(!person.exists||person.data().status!=='active')fail('พนักงานไม่ได้อยู่ในสถานะใช้งาน');
      const d=r.type==='leave'?r.date:r.period_start;
      if(runs.docs.some(doc=>{const p=doc.data();return p.status==='paid'&&p.period_start<=d&&p.period_end>=d;}))fail('รอบนี้จ่ายเงินแล้ว ไม่สามารถอนุมัติได้');
      if(r.type==='leave'){
        target=own('leaves').doc(r.staff_id+'_'+r.date);
        if((await tx.get(target)).exists)fail('วันที่นี้มีข้อมูลลาแล้ว');
        row={leave_id:target.id,staff_id:r.staff_id,date:r.date,leave_type:r.leave_type,note:r.reason,request_id:ref.id};
      }else{
        const sunday=r.payout_date||payoutSunday(r.date);
        const guard=own('employee_advance_limits').doc(r.staff_id+'_'+sunday);
        const [requests,advances]=await Promise.all([tx.get(own('employee_requests').where('staff_id','==',r.staff_id)),tx.get(own('advances').where('staff_id','==',r.staff_id)),tx.get(guard)]);
        const approved=rows(requests).filter(q=>q.status==='approved'||q.request_id===ref.id);
        if(usedForSunday(approved,advances.docs.map(d=>d.data()),sunday)>1000)fail('วันอาทิตย์นี้ยอดเบิกรวมเกิน 1,000 บาท');
        tx.set(guard,{staff_id:r.staff_id,payout_date:sunday,last_request_id:ref.id});
        target=own('advances').doc('REQ_'+ref.id);
        row={advance_id:target.id,staff_id:r.staff_id,amount:r.amount,date:r.payout_date||r.date,payout_date:r.payout_date||r.date,note:'คำขอเบิกที่อนุมัติแล้ว · รับเงินวันอาทิตย์',period_start:r.period_start,period_end:r.period_end,status:'pending',created_at:new Date().toISOString(),request_id:ref.id};
      }
    }
    if(target)tx.create(target,row);
    tx.update(ref,{status:body.decision,reviewed_by:user.staff_id,reviewed_at:new Date().toISOString()});
  });return {success:true};
}
exports.actions=new Set(['getEmployeeOverview','submitEmployeeRequest','listEmployeeRequests','reviewEmployeeRequest']);
exports.handle=async(body,user)=>{
  if(body.action==='listEmployeeRequests'){if(user.role!=='admin')fail('เฉพาะผู้ดูแล',403);return rows(await own('employee_requests').where('status','==','pending').get()).sort((a,b)=>a.created_at.localeCompare(b.created_at));}
  if(body.action==='reviewEmployeeRequest')return decide(body,user);
  if(!['staff','driver'].includes(user.role))fail('เฉพาะพนักงาน',403);
  if(body.action==='getEmployeeOverview')return income(user);
  return submit(body,user);
};
