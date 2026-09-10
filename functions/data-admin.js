'use strict';
const {getFirestore}=require('firebase-admin/firestore');
const allowed=['timesheets','advances','leaves','stock_logs','driver_jobs','payroll_runs'];
const db=()=>getFirestore();
const fail=message=>{throw Object.assign(Error(message),{status:400});};
const read=async name=>(await db().collection(name).get()).docs.map(d=>({...d.data(),_id:d.id}));
const dateOf=(r,type)=>type==='stock_logs'?new Date(r.checked_at).toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}):r.date||r.pay_date||r.period_end||String(r.created_at||'').slice(0,10);
function reason(type,r,runs,advances){
  if(type==='payroll_runs'&&(r.status==='paid'||(r.advance_ids||[]).length||advances.some(a=>a.run_id===r.run_id)))return 'รอบนี้จ่ายแล้วหรือผูกเงินเบิก ต้องตรวจและย้อนรายการจ่ายร่วมกันก่อน ยังไม่เปิดลบในหน้านี้';
  if(type==='advances'&&(r.status==='deducted'||r.run_id||runs.some(p=>(p.advance_ids||[]).includes(r.advance_id))))return 'เงินเบิกนี้ถูกหักหรือผูกกับ Payroll แล้ว ต้องตรวจรายการจ่ายก่อน';
  if(['timesheets','leaves'].includes(type)&&runs.some(p=>p.status==='paid'&&p.staff_id===r.staff_id&&p.period_start<=r.date&&p.period_end>=r.date))return 'ข้อมูลอยู่ในรอบที่จ่ายเงินแล้ว ยังไม่เปิดลบเพื่อรักษาประวัติ Payroll';
  if(type==='stock_logs'&&((r.orders_json&&r.orders_json!=='[]')||r.mode==='return'||(r.mode==='close'&&(r.branch_id==='BR005'||String(r.branch_name||'').includes('หนองตำลึง')))))return 'รายการนี้ส่งคำสั่งไป Driver แล้ว ยังไม่ลบจนกว่าจะตรวจงานที่เกี่ยวข้อง';
  if(type==='driver_jobs'&&r.items_json&&r.items_json!=='[]')return 'รายการนี้เป็นงานรับของของ Driver ยังไม่ลบจนกว่าจะตรวจงานที่เกี่ยวข้อง';
  return '';
}
exports.handle=async(body,user,safe)=>{
  if(user.role!=='admin')throw Object.assign(Error('เฉพาะผู้ดูแล'),{status:403});
  if(body.action==='getPayrollPeriod'){
    const start=body.date_from,end=body.date_to;if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)fail('ช่วงวันที่ไม่ถูกต้อง');
    const [staff,timesheets,advances,runs]=await Promise.all(['staff','timesheets','advances','payroll_runs'].map(read));
    const selected=runs.filter(r=>r.period_start===start&&r.period_end===end);
    return {staff:staff.map(safe),timesheets:timesheets.filter(t=>t.date>=start&&t.date<=end),advances:advances.filter(a=>(a.period_start===start&&a.period_end===end)||selected.some(p=>(p.advance_ids||[]).includes(a.advance_id))),runs:selected};
  }
  if(body.action==='getStockHistory'){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(body.date||''))fail('กรุณาเลือกวันที่');
    return (await read('stock_logs')).filter(r=>dateOf(r,'stock_logs')===body.date).sort((a,b)=>String(b.checked_at).localeCompare(String(a.checked_at)));
  }
  const type=body.collection;if(!allowed.includes(type))fail('ไม่เปิดจัดการข้อมูลประเภทนี้');
  if(body.action==='deleteDataRecord'){
    if(body.confirm!==true||typeof body.id!=='string'||!body.id||body.id.includes('/'))fail('กรุณายืนยันรายการที่จะลบ');
    await db().runTransaction(async tx=>{
      const ref=db().collection(type).doc(body.id);
      const [record,pay,adv]=await Promise.all([tx.get(ref),tx.get(db().collection('payroll_runs')),tx.get(db().collection('advances'))]);
      if(!record.exists)fail('รายการถูกลบแล้ว กรุณาโหลดใหม่');
      const blocked=reason(type,record.data(),pay.docs.map(d=>d.data()),adv.docs.map(d=>d.data()));if(blocked)fail(blocked);
      tx.delete(ref);
    });return true;
  }
  const [records,runs,advances]=await Promise.all([read(type),read('payroll_runs'),read('advances')]);
  const filtered=records.filter(r=>(!body.date_from||dateOf(r,type)>=body.date_from)&&(!body.date_to||dateOf(r,type)<=body.date_to)&&(!body.staff_id||r.staff_id===body.staff_id)&&(!body.branch_id||r.branch_id===body.branch_id)&&(!body.search||JSON.stringify(r).toLowerCase().includes(String(body.search).toLowerCase()))).sort((a,b)=>dateOf(b,type).localeCompare(dateOf(a,type))||String(b.created_at||b.checked_at||b._id).localeCompare(String(a.created_at||a.checked_at||a._id)));
  const offset=Math.max(0,Number(body.offset)||0);
  return {total:filtered.length,records:filtered.slice(offset,offset+50).map(r=>({...r,delete_blocked:reason(type,r,runs,advances)}))};
};
