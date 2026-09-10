'use strict';
// Direct ports of the supplied EASY code.gs; the existing pages keep their response shapes.
const {getFirestore}=require('firebase-admin/firestore');
const crypto=require('node:crypto');
const notify=require('./notifications');
const shop=require('./shop-settings');
const {getItemsListByMode,calcLateMin,calcOtMins,calcHoursWorked,haversine}=require('./legacy-rules');
const db=()=>getFirestore();
const list=async name=>(await db().collection(name).get()).docs.map(d=>({...d.data(),_id:d.id}));
const get=async(name,id)=>(await db().collection(name).doc(String(id)).get()).data();
const id=prefix=>prefix+'_'+crypto.randomUUID();
const day=(offset=0)=>new Date(Date.now()+offset*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});
const clock=()=>new Date().toLocaleTimeString('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'});
const now=()=>new Date().toISOString();
const ok=data=>({success:true,data});
function fail(message,status=400){throw Object.assign(Error(message),{status});}
const txt=value=>String(value??'').trim();
function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||'')||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('วันที่ไม่ถูกต้อง');return value;}
function time(value){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value||''))fail('เวลาไม่ถูกต้อง');return value;}
function amount(value,min=0){if(value===''||!Number.isFinite(Number(value))||Number(value)<min)fail('จำนวนไม่ถูกต้อง');return Number(value);}
function admin(user){if(user.role!=='admin')fail('เฉพาะผู้ดูแล',403);}
function driver(user){if(!['admin','driver'].includes(user.role))fail('เฉพาะคนขับหรือผู้ดูแล',403);}
const settings=async()=>({shift_morning_start:'09:00',shift_morning_end:'17:00',shift_night_start:'17:00',shift_night_end:'01:00',ot_rate_per_hour:50,late_grace_min:15,ot_grace_min:15,...await get('settings','work')});
const tsId=(staffId,date)=>staffId+'_'+date;
async function staff(id){const row=await get('staff',id);if(!row)fail('ไม่พบพนักงาน');return row;}
async function timesheets(body,user){let rows=user.role==='admin'?await list('timesheets'):(await db().collection('timesheets').where('staff_id','==',user.staff_id).get()).docs.map(d=>d.data());return rows.filter(r=>(!body.staff_id||r.staff_id===body.staff_id)&&(!body.date_from||r.date>=body.date_from)&&(!body.date_to||r.date<=body.date_to));}
async function paid(staffId,date){return (await list('payroll_runs')).some(p=>p.staff_id===staffId&&p.status==='paid'&&p.period_start<=date&&p.period_end>=date);}
async function clockIn(body,user){
  const branches=(await list('branches')).filter(b=>b.status==='active');let near=null,distance=Infinity;
  const lat=Number(body.lat),lng=Number(body.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)fail('พิกัดไม่ถูกต้อง');
  for(const b of branches){if(b.lat==null||b.lng==null)continue;const d=haversine(lat,lng,Number(b.lat),Number(b.lng));if(d<=Number(b.allowed_radius_m)&&d<distance){near=b;distance=d;}}
  if(!near)fail('คุณอยู่นอกพื้นที่สาขา ไม่สามารถบันทึกได้');
  const cfg=await settings(),date=day(),clock_in=clock(),ref=db().collection('timesheets').doc(tsId(user.staff_id,date));
  const late_min=calcLateMin(user.shift==='night'?cfg.shift_night_start:cfg.shift_morning_start,clock_in);
  const row={record_id:ref.id,staff_id:user.staff_id,staff_name:user.nickname||user.name,branch_id:near.branch_id,branch_name:near.name,date,clock_in,clock_out:'',hours_worked:'',late_min,late_reason:txt(body.late_reason),ot_hours:'',ot_requested:'',ot_reason:'',ot_status:'',early_out_min:'',early_out_flag:'',early_out_note:'',note:'',status:'active',clock_in_lat:lat,clock_in_lng:lng,clock_out_lat:'',clock_out_lng:'',location_flagged:false,created_at:now()};
  await db().runTransaction(async tx=>{const old=await tx.get(ref);if(old.exists)fail('บันทึกเข้างานวันนี้แล้ว');tx.create(ref,row);});
  return {success:true,record_id:ref.id,branch_name:near.name,clock_in,late_min,...await notify.after(()=>notify.telegram(`✅ ${user.nickname||user.name} เข้างานแล้ว ${clock_in} (${near.name})${late_min>15?'\n⚠️ สาย '+late_min+' นาที':''}${late_min>15&&row.late_reason?'\nเหตุผล: '+row.late_reason:''}`,'telegram_chat_clock'))};
}
async function clockOut(body,user){
  const rows=await timesheets({},user),record=rows.find(r=>r.staff_id===user.staff_id&&r.clock_out===''&&(r.date===day()||r.date===day(-1)));
  if(!record)fail('ไม่พบข้อมูลการเข้างานที่ค้างอยู่');
  const cfg=await settings(),clock_out=clock(),shift_end=user.shift==='night'?cfg.shift_night_end:cfg.shift_morning_end;
  const hours_worked=calcHoursWorked(record.clock_in,clock_out),ot_mins=calcOtMins(shift_end,clock_out),has_ot=ot_mins>(Number(cfg.ot_grace_min)||15);
  const ref=db().collection('timesheets').doc(record.record_id);
  await db().runTransaction(async tx=>{const current=await tx.get(ref);if(!current.exists||current.data().clock_out)fail('บันทึกออกงานแล้ว');tx.update(ref,{clock_out,clock_out_lat:body.lat??'',clock_out_lng:body.lng??'',hours_worked,ot_hours:has_ot?Number((ot_mins/60).toFixed(2)):0,ot_requested:body.ot_requested==='yes'?'yes':'no',ot_reason:txt(body.ot_reason),ot_status:body.ot_requested==='yes'?'pending':'no',status:'complete'});});
  return {success:true,clock_out,hours_worked,ot_mins,has_ot,shift_end,...await notify.after(()=>notify.telegram(`🚪 ${user.nickname||user.name} ออกงานแล้ว ${clock_out}${has_ot&&body.ot_requested==='yes'?'\n⏰ ขอ OT '+ot_mins+' นาที':''}`,'telegram_chat_clock'))};
}
async function upsert(body){
  const person=await staff(body.staff_id),d=date(body.date),start=time(body.clock_in),end=time(body.clock_out),note=txt(body.admin_note);
  if(!note||start===end)fail('กรุณากรอกเวลาและเหตุผลให้ครบ');if(await paid(person.staff_id,d))fail('รอบนี้จ่ายเงินแล้ว ไม่สามารถแก้เวลา');
  const ref=db().collection('timesheets').doc(tsId(person.staff_id,d));
  if(body.record_id&&body.record_id!==ref.id)fail('รายการเวลาไม่ตรงกับพนักงานและวันที่');
  const cfg=await settings(),branch=await get('branches',person.branch_id||'_none');
  const shiftStart=person.custom_shift_start||(person.shift==='night'?cfg.shift_night_start:cfg.shift_morning_start),shiftEnd=person.custom_shift_end||(person.shift==='night'?cfg.shift_night_end:cfg.shift_morning_end);
  const late=person.staff_type==='fulltime'?calcLateMin(shiftStart,start):0,ot=calcOtMins(shiftEnd,end);
  await ref.set({record_id:ref.id,staff_id:person.staff_id,staff_name:person.nickname||person.name,branch_id:person.branch_id||'',branch_name:branch?.name||'',date:d,clock_in:start,clock_out:end,hours_worked:calcHoursWorked(start,end),late_min:late,late_reason:late?'แก้ไขโดยแอดมิน: '+note:'',ot_hours:ot>(Number(cfg.ot_grace_min)||15)?Number((ot/60).toFixed(2)):0,ot_requested:'no',ot_reason:'',ot_status:'no',note:'แก้ไขเวลาโดยแอดมิน: '+note,status:'complete',clock_in_lat:'',clock_in_lng:'',clock_out_lat:'',clock_out_lng:'',location_flagged:false},{merge:true});
  return {success:true,record_id:ref.id};
}
async function savePayroll(body,safe){
  const person=await staff(body.staff_id);const start=date(body.period_start),end=date(body.period_end);if(end<start)fail('ช่วงวันที่ไม่ถูกต้อง');date(body.pay_date);
  const ref=db().collection('payroll_runs').doc(body.staff_id+'_'+start+'_'+end),row={run_id:ref.id,staff_id:body.staff_id,period_start:start,period_end:end,pay_date:body.pay_date,status:'paid',paid_at:now(),adjust_note:txt(body.adjust_note)};
  for(const key of ['days_worked','hours_worked','base_pay','ot_pay','late_deduct','early_out_deduct','manual_adjust','total_pay'])row[key]=amount(body[key]??0,key==='manual_adjust'||key==='total_pay'?-100000000:0);
  // Same three-step page flow, but the payment and its exact advance IDs commit together.
  const advanceIds=body.advance_ids||[];if(!Array.isArray(advanceIds)||advanceIds.length>400)fail('รายการเงินเบิกไม่ถูกต้อง');
  await db().runTransaction(async tx=>{const old=await tx.get(ref);const refs=advanceIds.map(v=>db().collection('advances').doc(String(v)));const advances=await Promise.all(refs.map(r=>tx.get(r)));if(old.exists){if(JSON.stringify(old.data().advance_ids||[])!==JSON.stringify(advanceIds))fail('รอบนี้บันทึกจ่ายแล้ว');return;}
    for(const a of advances)if(!a.exists||a.data().staff_id!==body.staff_id||a.data().status!=='pending')fail('ข้อมูลเงินเบิกเปลี่ยน กรุณาโหลดใหม่');
    const detailKeys=['date','clock_in','clock_out','late_min','late_deduct','ot_hours','ot_pay','ot_status','ot_reason','record_id','day_total','effective_clock_in','effective_clock_out'];
    const details=Array.isArray(body.details)?body.details.slice(0,366).map(d=>Object.fromEntries(detailKeys.filter(k=>d[k]!=null&&['string','number','boolean'].includes(typeof d[k])).map(k=>[k,d[k]]))):[];
    const savedAdvances=advances.map(a=>{const v=a.data();return {advance_id:v.advance_id,amount:v.amount,date:v.date,note:v.note||''};});
    tx.create(ref,{...row,advance_ids:advanceIds,staff_snapshot:safe(person),details,advance_items:savedAdvances,advance_total:savedAdvances.reduce((n,a)=>n+Number(a.amount||0),0)});for(const r of refs)tx.update(r,{status:'deducted',run_id:ref.id});});
  return {success:true,run_id:ref.id};
}
const cutoffNoon=()=>{const noon=new Date(day()+'T12:00:00+07:00');return Date.now()<noon.getTime()?noon.getTime()-86400000:noon.getTime();};
async function saveStock(body,user){
  const branchId=user.role==='admin'?body.branch_id:user.branch_id,branch=await get('branches',branchId||'_none');if(!branch||branch.status!=='active')fail('กรุณาเลือกสาขาที่เปิดใช้งาน');
  if(!['open','close'].includes(body.mode)||!Array.isArray(body.stocks)||!Array.isArray(body.orders))fail('ข้อมูลสต็อกไม่ถูกต้อง');
  const log_id=id('ST'),workOrders=[];
  if(body.order_names){if(!Array.isArray(body.order_names)||!Array.isArray(body.custom_orders))fail('รายการสั่งเพิ่มไม่ถูกต้อง');const quantities=await shop.quantities();body.orders=[...body.order_names.map(name=>quantities[name]?`${name} ${quantities[name]}`:String(name)),...body.custom_orders.map(String)];}
  const targets=await shop.targets();
  if((branch.branch_id==='BR005'||branch.name.includes('หนองตำลึง'))&&body.mode==='open')for(const s of body.stocks){const target=targets.find(t=>t.item_name===s.name);if(!target)continue;const val=parseFloat(s.value)||0,qty=Number(target.target_qty)||0,ratio=Number(target.conversion_ratio)||1;let batches=0;if(target.trigger_type==='zero'&&val===0)batches=Math.ceil(qty/ratio);else if(target.trigger_type==='diff'&&qty>val)batches=Math.ceil((qty-val)/ratio);if(batches>0)workOrders.push({name:s.name,qty:batches,unit:target.production_unit});}
  await db().collection('stock_logs').doc(log_id).set({log_id,branch_id:branchId,branch_name:branch.name,mode:body.mode,items_json:JSON.stringify(body.stocks),orders_json:JSON.stringify(body.orders),staff_id:user.staff_id,staff_name:user.nickname||user.name,checked_at:now()});
  const notice=await notify.after(()=>notify.telegram(`📦 สรุปเช็คสต็อก (${body.mode==='open'?'เปิดร้าน':'ปิดร้าน'})\n📍 สาขา: ${branch.name}\n👤 พนักงาน: ${user.nickname||user.name}\n\n🟡 สต๊อกคงเหลือ\n${body.stocks.map(s=>s.name+' '+s.value+' '+(s.unit||'')).join('\n')}${body.mode==='close'&&body.orders.length?'\n🚨 รายการที่ต้องสั่งเพิ่ม:\n'+body.orders.join('\n'):''}`,body.mode==='open'?'telegram_chat_stock_open':'telegram_chat_stock_close'));
  const lineNotice=workOrders.length?await notify.after(()=>notify.line('📝 ใบสั่งงานครัวกลาง ('+day()+')\n\n'+workOrders.map(w=>`👉 ${w.name}: +${w.qty} ${w.unit}`).join('\n'))):{};
  return {success:true,log_id,workOrders,...notice,...lineNotice};
}
exports.actions=new Set(['getCentralTargets','updateCentralTarget','getDriverOrderQuantities','updateDriverOrderQuantity','getNotificationSettings','saveNotificationSettings','submitDriverPacking','getStaff','getBranches','getSettings','clockIn','clockOut','getTodayStatus','getTimesheets','upsertTimesheet','updateTimesheetOT','getPayrollRuns','savePayrollRun','markAdvancesDeducted','sendPayrollNotify','getAdvances','saveAdvance','getLeaves','saveLeave','deleteLeave','getStockItems','saveStockLog','getTodayStockOrders','getDriverOrders','getPickups','getPendingPurchases','approvePurchase','submitDriverReturn','uploadDriverPhoto']);
exports.handle=async(body,user,safe)=>{
  const action=body.action;
  if(action==='getBranches')return ok((await list('branches')).filter(b=>b.status==='active'));
  if(action==='getSettings')return ok(await settings());
  if(action==='getTimesheets')return ok(await timesheets(body,user));
  if(action==='getTodayStatus'){const allStaff=await list('staff');return ok((await timesheets({},user)).filter(t=>t.date===day()||(t.date===day(-1)&&t.clock_out===''&&allStaff.find(s=>s.staff_id===t.staff_id)?.shift==='night')));}
  if(action==='clockIn')return clockIn(body,user);
  if(action==='clockOut')return clockOut(body,user);
  if(action==='getStockItems'){const branch=await get('branches',(user.role==='admin'?body.branch_id:user.branch_id)||'_none');return ok(getItemsListByMode(body.mode,branch?.name.includes('หนองตำลึง')?'BR005':branch?.branch_id));}
  if(action==='saveStockLog')return saveStock(body,user);
  if(['getDriverOrders','getPickups','submitDriverReturn','uploadDriverPhoto','submitDriverPacking'].includes(action)){
    driver(user);
    if(action==='uploadDriverPhoto')return notify.photo(body,user);
    if(action==='submitDriverPacking')return packing(body,user);
    if(action==='submitDriverReturn'){if(!Array.isArray(body.items))fail('รายการไม่ถูกต้อง');const log_id=id('ST_DRV');await db().collection('stock_logs').doc(log_id).set({log_id,branch_id:'DRIVER',branch_name:'รถคนขับ',mode:'return',items_json:JSON.stringify(body.items),orders_json:'[]',staff_id:user.staff_id,staff_name:user.nickname||user.name,checked_at:now()});return {success:true,...await notify.after(()=>notify.telegram(`📥 ${user.nickname||user.name} คืนสต็อกเรียบร้อย!\n${body.items.map(i=>i.name+' '+(i.qty??i.value??'')+' '+(i.unit||'')).join('\n')}`,'telegram_chat_driver'))};}
    if(action==='getPickups'){const job=(await list('driver_jobs')).filter(j=>j.date===day()).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0],group={};for(const item of job?JSON.parse(job.items_json):[])(group[item.location]??=[]).push(`${item.name} ${item.qty} ${item.unit}`);return ok(group);}
    const group={};for(const log of (await list('stock_logs')).filter(l=>l.mode==='close'&&Date.parse(l.checked_at)>=Date.now()-18*3600000&&l.branch_id!=='BR005'&&!l.branch_name.includes('หนองตำลึง'))){const key=log.branch_name||log.branch_id;for(const item of JSON.parse(log.orders_json||'[]')){group[key]??=[];if(!group[key].includes(item))group[key].push(item);}}return ok(group);
  }
  admin(user);
  if(action==='getNotificationSettings')return ok(await notify.read());
  if(action==='saveNotificationSettings')return ok(await notify.save(body));
  if(action==='getCentralTargets')return ok(await shop.targets());
  if(action==='updateCentralTarget')return ok(await shop.updateTarget(body));
  if(action==='getDriverOrderQuantities')return ok(await shop.quantities());
  if(action==='updateDriverOrderQuantity')return ok(await shop.updateQuantity(body));
  if(action==='getStaff')return ok((await list('staff')).filter(s=>s.status==='active').map(safe));
  if(action==='upsertTimesheet')return upsert(body);
  if(action==='updateTimesheetOT'){const row=await get('timesheets',body.record_id);if(!row||!['approved','rejected'].includes(body.ot_status))fail('รายการ OT ไม่ถูกต้อง');if(await paid(row.staff_id,row.date))fail('รอบนี้จ่ายเงินแล้ว');await db().collection('timesheets').doc(body.record_id).update({ot_status:body.ot_status});return {success:true};}
  if(action==='getPayrollRuns')return ok((await list('payroll_runs')).filter(r=>(!body.staff_id||r.staff_id===body.staff_id)&&(!body.status||r.status===body.status)));
  if(action==='savePayrollRun')return savePayroll(body,safe);
  if(action==='markAdvancesDeducted'){for(const advId of body.advance_ids||[]){const row=await get('advances',advId);if(!row||row.status!=='deducted'||!row.run_id)fail('ต้องบันทึกจ่ายเงินเดือนพร้อมเงินเบิกก่อน');}return {success:true};}
  if(action==='sendPayrollNotify')return {success:true,...await notify.after(()=>notify.telegram(`💰 จ่ายเงินเดือนแล้ว\n👤 ${txt(body.staff_name)}\n💵 ${Number(body.total_pay).toLocaleString('th-TH',{minimumFractionDigits:2})} บาท\n📅 รอบ: ${body.period_start} – ${body.period_end}`,'telegram_chat_payroll'))};
  if(action==='getAdvances')return ok((await list('advances')).filter(r=>(!body.staff_id||r.staff_id===body.staff_id)&&(!body.status||r.status===body.status)));
  if(action==='saveAdvance'){await staff(body.staff_id);const advance_id=id('ADV'),start=date(body.period_start),end=date(body.period_end);if(end<start)fail('ช่วงวันที่ไม่ถูกต้อง');await db().collection('advances').doc(advance_id).set({advance_id,staff_id:body.staff_id,amount:amount(body.amount,0.01),date:date(body.date||day()),note:txt(body.note),period_start:start,period_end:end,status:'pending',created_at:now()});return {success:true,advance_id,...await notify.after(async()=>{const person=await staff(body.staff_id);await notify.telegram(`💸 บันทึกเบิกล่วงหน้า\n👤 ${person.nickname||person.name}\n💵 ฿${Number(body.amount).toLocaleString('th-TH')} บาท\n📝 ${txt(body.note)||'—'}\n📅 หักรอบ: ${start} – ${end}`,'telegram_chat_payroll');})};}
  if(action==='getLeaves')return ok((await list('leaves')).filter(r=>(!body.date_from||r.date>=body.date_from)&&(!body.date_to||r.date<=body.date_to)));
  if(action==='saveLeave'){await staff(body.staff_id);const d=date(body.date);if(await paid(body.staff_id,d))fail('รอบนี้จ่ายเงินแล้ว');if(!['ลากิจ','ลาป่วย','ลาพักร้อน'].includes(body.leave_type))fail('ประเภทลาไม่ถูกต้อง');const leave_id=tsId(body.staff_id,d);await db().collection('leaves').doc(leave_id).set({leave_id,staff_id:body.staff_id,date:d,leave_type:body.leave_type,note:txt(body.note)});return {success:true,leave_id};}
  if(action==='deleteLeave'){const row=await get('leaves',body.leave_id);if(!row)fail('ไม่พบวันลา');if(await paid(row.staff_id,row.date))fail('รอบนี้จ่ายเงินแล้ว');await db().collection('leaves').doc(body.leave_id).delete();return {success:true};}
  if(action==='getTodayStockOrders')return ok((await list('stock_logs')).filter(l=>Date.parse(l.checked_at)>=cutoffNoon()&&l.orders_json!=='[]').sort((a,b)=>b.checked_at.localeCompare(a.checked_at)).map(l=>({branch_id:l.branch_id,branch_name:l.branch_name,time:new Date(l.checked_at).toLocaleTimeString('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'}),orders:JSON.parse(l.orders_json||'[]')})));
  if(action==='approvePurchase'){if(!Array.isArray(body.items)||body.items.some(i=>!i.name||!i.location||!i.qty))fail('กรอกรายการสั่งของให้ครบ');const ref=db().collection('driver_jobs').doc();await ref.set({date:day(),items_json:JSON.stringify(body.items),status:'pending',created_at:now()});return {success:true,...await notify.after(()=>notify.telegram('🛒 สรุปรายการสั่งของ/รับของ\n📅 '+day()+'\n'+Object.entries(Object.groupBy(body.items,i=>i.location)).map(([loc,items])=>'📍 จุดรับ: '+loc+'\n'+items.map(i=>'- '+i.name+': '+i.qty+' '+i.unit).join('\n')).join('\n\n')+'\n✅ ผู้ดูแลอนุมัติแล้ว','telegram_chat_driver'))};}
  if(action==='getPendingPurchases'){
    const logs=(await list('stock_logs')).filter(l=>Date.parse(l.checked_at)>=cutoffNoon()).sort((a,b)=>b.checked_at.localeCompare(a.checked_at));
    const central=logs.find(l=>(l.branch_id==='BR005'||l.branch_name?.includes('หนองตำลึง'))&&l.mode==='close'),returned=logs.find(l=>l.branch_id==='DRIVER'&&l.mode==='return'),map={};
    for(const c of JSON.parse(central?.items_json||'[]'))map[c.name]={name:c.name,remaining:parseFloat(c.value)||0,unit:c.unit||''};
    for(const d of JSON.parse(returned?.items_json||'[]')){const val=d.qty||d.value||0;if(map[d.name]){const prev=map[d.name].remaining;map[d.name].remaining=isNaN(parseFloat(val))||String(val).includes('/')?`${prev} + ${val}`:Number(prev)+parseFloat(val);}else map[d.name]={name:d.name,remaining:val,unit:d.unit||''};}
    return ok(Object.keys(map).length?[{date:day(),items_json:JSON.stringify(Object.values(map)),meta_info:JSON.stringify([central,returned].filter(Boolean).map(l=>`${l.branch_name}: ${l.staff_name} (${l.checked_at})`))}]:[]);
  }
  fail('ไม่พบรายการ',404);
};

async function packing(body,user){
  const branch=txt(body.branch),items=body.items;
  if(!branch||branch.length>150||!Array.isArray(items)||!items.length||items.length>100)fail('รายการจัดของไม่ถูกต้อง');
  let missing=false;
  const lines=items.map(item=>{
    const name=txt(item.name);if(!name||name.length>250||!['ok','partial','no'].includes(item.status))fail('กรุณาเลือกครบ/ขาดให้ทุกรายการ');
    const match=name.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s+(.+)$/),qty=match?Number(match[2]):null,unit=match?match[3]:'';
    if(item.status==='ok')return '- '+name+' — ครบ';
    missing=true;
    if(item.status==='no')return '- '+name+' — ขาดทั้งหมด'+(qty===null?' (ต้นทางไม่ระบุจำนวน)':' '+qty+' '+unit);
    const actual=Number(item.actualQty);
    if(qty===null||String(item.actualQty??'').trim()===''||!Number.isFinite(actual)||actual<0||actual>=qty)fail('จำนวนที่จัดได้ต้องน้อยกว่าที่สั่งและไม่ติดลบ');
    return '- '+name+' — ขาด '+Number((qty-actual).toFixed(4))+' '+unit+' (จัดได้ '+actual+' '+unit+')';
  });
  await notify.telegram('📦 สรุปจัดของขึ้นรถ\n👤 คนขับ: '+(user.nickname||user.name)+'\n📍 สาขาปลายทาง: '+branch+'\n\n'+lines.join('\n')+'\n\n'+(missing?'⚠️ สรุป: มีของขาด':'✅ สรุป: ครบทั้งหมด'),'telegram_chat_driver');
  return {success:true};
}
