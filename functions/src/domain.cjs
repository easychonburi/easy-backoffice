const {randomUUID}=require('node:crypto');
const legacyFactory=require('./business.cjs');
const calculate=require('./payroll.cjs');
const ids={staff:'staff_id',branches:'branch_id',timesheets:'record_id',payroll_runs:'run_id',advances:'advance_id',stock_logs:'log_id',central_targets:'item_name',leaves:'leave_id',driver_jobs:'job_id',settings:'key'};
const safeSettings=new Set(['shift_morning_start','shift_morning_end','shift_night_start','shift_night_end','late_grace_min','ot_grace_min','ot_rate_per_hour','gps_block_on_fail','allow_cross_branch']);
function formatDate(value,zone,pattern){
  const d=new Date(new Date(value).getTime()+7*3600000),iso=d.toISOString();
  const parts={'yyyy':iso.slice(0,4),'MM':iso.slice(5,7),'dd':iso.slice(8,10),'HH':iso.slice(11,13),'mm':iso.slice(14,16),'ss':iso.slice(17,19)};
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g,k=>parts[k]);
}
const day=(now)=>formatDate(now,'Asia/Bangkok','yyyy-MM-dd');
function cutoff(now){const today=day(now),noon=Date.parse(today+'T12:00:00+07:00');return new Date(noon>(+new Date(now))?noon-86400000:noon).toISOString();}
function safeStaff(s){const {pin,pin_hash,pin_salt,...rest}=s;return rest;}
function execute(action,body,tables,now=new Date()){
  const changes=[],notifications=[];
  const list=name=>{if(!Object.hasOwn(tables,name))throw Error('Collection was not loaded: '+name);return tables[name];};
  const append=(name,obj)=>{const row={...obj};const key=ids[name];if(key&&!row[key])row[key]=randomUUID();list(name).push(row);changes.push({type:'set',collection:name,id:String(row[key]),data:row});};
  const update=(name,key,id,values)=>{const row=list(name).find(r=>String(r[key])===String(id));if(!row)return false;Object.assign(row,values);changes.push({type:'set',collection:name,id:String(row[ids[name]]),data:{...row}});return true;};
  const remove=(name,id)=>{const i=list(name).findIndex(r=>String(r[ids[name]])===id);if(i<0)return false;list(name).splice(i,1);changes.push({type:'delete',collection:name,id});return true;};
  const nowMs=+new Date(now);
  class RequestDate extends Date {constructor(...args){super(...(args.length?args:[nowMs]));}static now(){return nowMs;}}
  const legacy=legacyFactory({sheetToJson:list,appendRow:append,updateRowById:update,generateId:p=>p+'_'+randomUUID(),Utilities:{formatDate},Date:RequestDate,
    sendTelegram:(message,destination)=>notifications.push({channel:'telegram',message,destination}),
    sendLineMessage:message=>notifications.push({channel:'line',message,destination:'line_group_central'})});
  let result;
  function upsertConfig(collection,field,prefix){
    const {expected_version,...values}=body;
    const old=values[field]?list(collection).find(r=>r[field]===values[field]):null;
    if(values[field]&&!old)throw Error('ไม่พบรายการ');
    if(old&&Number(expected_version)!==Number(old.version||0))throw Error('ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่');
    values[field]=old?.[field]||prefix+randomUUID();values.version=Number(old?.version||0)+1;
    if(old)update(collection,field,values[field],values);else append(collection,values);
    return {success:true,id:values[field]};
  }
  if(action==='getAdminStaff')result={success:true,data:list('staff').map(safeStaff)};
  else if(action==='getAdminBranches')result={success:true,data:list('branches')};
  else if(action==='getShifts')result={success:true,data:list('shifts')};
  else if(action==='saveBranch')result=upsertConfig('branches','branch_id','BR_');
  else if(action==='saveShift')result=upsertConfig('shifts','shift_id','SHIFT_');
  else if(action==='saveSettings'){
    const current=Object.fromEntries(list('settings').filter(s=>Object.hasOwn(body.values,s.key)).map(s=>[s.key,s.value]));
    const expected=body.expected||{};
    if(Object.keys(current).length!==Object.keys(expected).length||Object.entries(current).some(([k,v])=>v!==expected[k]))throw Error('การตั้งค่าถูกแก้ไขแล้ว กรุณาโหลดใหม่');
    for(const [key,value] of Object.entries(body.values))if(!update('settings','key',key,{value}))append('settings',{key,value});
    result={success:true};
  }
  else if(action==='getSettings') result={success:true,data:Object.fromEntries(list('settings').filter(r=>safeSettings.has(r.key)).map(r=>[r.key,r.value]))};
  else if(action==='getStaff') result={success:true,data:list('staff').filter(s=>s.status==='active').map(safeStaff)};
  else if(action==='getCentralTargets')result={success:true,data:list('central_targets')};
  else if(action==='updateCentralTarget')result={success:update('central_targets','item_name',body.item_name,{target_qty:body.target_qty})};
  else if(action==='addStaff'){const staff_id='STF_'+randomUUID();append('staff',{...body,staff_id,status:body.status||'active',created_at:new Date(now).toISOString()});result={success:true,staff_id};}
  else if(action==='updateStaff'||action==='updateStaffStatus'){
    const {expected_version,...values}=body,old=list('staff').find(s=>s.staff_id===body.staff_id);
    if(!old)throw Error('ไม่พบพนักงาน');
    if(Number(expected_version)!==Number(old.version||0))throw Error('ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่');
    result={success:update('staff','staff_id',body.staff_id,{...values,version:Number(old.version||0)+1})};
  }
  else if(action==='getLeaves')result={success:true,data:list('leaves').filter(r=>!body.staff_id||r.staff_id===body.staff_id)};
  else if(action==='saveLeave'){
    const leave_id=body.staff_id+'_'+body.date;
    if(list('leaves').some(l=>l.leave_id===leave_id))result={success:false,message:'มีวันลานี้แล้ว'};
    else{append('leaves',{...body,leave_id,created_at:new Date(now).toISOString()});result={success:true,leave_id};}
  }else if(action==='deleteLeave')result={success:remove('leaves',body.leave_id)};
  else if(action==='savePayrollRun'){
    const existing=list('payroll_runs').find(p=>p.staff_id===body.staff_id&&p.period_start===body.period_start&&p.period_end===body.period_end);
    if(existing) return {result:{success:false,message:'ยืนยันเงินเดือนรอบนี้แล้ว'},changes:[],notifications:[]};
    const staff=list('staff').find(s=>s.staff_id===body.staff_id);
    const settings=Object.fromEntries(list('settings').map(s=>[s.key,s.value]));
    const p=calculate(staff,list('timesheets'),body.period_start,body.period_end,settings,list('advances'));
    if(p.pendingOTs.length)throw Error('กรุณาอนุมัติ OT ก่อนยืนยันเงินเดือน');
    const total=Math.round((p.total+(Number(body.manual_adjust)||0))*100)/100;
    if(!Number.isFinite(total)||Math.abs(total-Number(body.total_pay))>0.009)throw Error('ข้อมูลเงินเดือนเปลี่ยนแล้ว กรุณาโหลดใหม่');
    const run_id='PR_'+randomUUID();
    append('payroll_runs',{...body,run_id,days_worked:p.days_worked,hours_worked:p.hours_worked,base_pay:p.base_pay,ot_pay:p.ot_pay,late_deduct:p.late_deduct,advance_total:p.advance_total,advance_ids:p.advance_items.map(a=>a.advance_id),total_pay:total,status:'paid',paid_at:new Date(now).toISOString()});
    p.advance_items.forEach(a=>update('advances','advance_id',a.advance_id,{status:'deducted',run_id}));
    legacy.sendPayrollNotify({...body,total_pay:total,staff_name:staff.nickname||staff.name});
    result={success:true,run_id,total_pay:total};
  }else if(['getTodayStockOrders','getDriverOrders','getPendingPurchases'].includes(action)){
    const logs=list('stock_logs').filter(l=>l.checked_at>=cutoff(now)).sort((a,b)=>b.checked_at.localeCompare(a.checked_at));
    const branches=Object.fromEntries(list('branches').map(b=>[b.branch_id,b.name]));
    if(action==='getTodayStockOrders')result={success:true,data:logs.filter(l=>l.orders_json&&l.orders_json!=='[]').map(l=>({branch_id:l.branch_id,branch_name:l.branch_name||branches[l.branch_id],time:formatDate(l.checked_at,'Asia/Bangkok','HH:mm')+(day(l.checked_at)!==day(now)?' (เมื่อคืน)':''),orders:JSON.parse(l.orders_json)}))};
    else if(action==='getDriverOrders'){
      const data={};for(const l of list('stock_logs').filter(l=>l.mode==='close'&&l.branch_id!=='BR005'&&Date.parse(l.checked_at)>=nowMs-18*3600000)){
        const name=branches[l.branch_id]||l.branch_id;data[name]=[...new Set([...(data[name]||[]),...JSON.parse(l.orders_json||'[]')])];
      }result={success:true,data};
    }else{
      const driver=logs.find(l=>l.branch_id==='DRIVER'&&l.mode==='return'),central=logs.find(l=>l.branch_id==='BR005'&&l.mode==='close');
      const map=new Map();
      for(const c of JSON.parse(central?.items_json||'[]'))map.set(c.name,{name:c.name,remaining:parseFloat(c.value)||0,unit:c.unit||''});
      for(const d of JSON.parse(driver?.items_json||'[]')){const val=d.qty||d.value||0,old=map.get(d.name);if(old){old.remaining=String(val).includes('/')||!Number.isFinite(Number(val))?`${old.remaining} + ${val}`:Number(old.remaining)+Number(val);}else map.set(d.name,{name:d.name,remaining:val,unit:d.unit||''});}
      const meta=[central,driver].filter(Boolean).map(l=>`${l.branch_id==='DRIVER'?'คนขับ':'ครัวกลาง'}: ${l.staff_name||''} (${formatDate(l.checked_at,'Asia/Bangkok','dd/MM/yyyy HH:mm')})`);
      result={success:true,data:map.size?[{date:day(now),items_json:JSON.stringify([...map.values()]),meta_info:JSON.stringify(meta)}]:[]};
    }
  }else if(action==='approvePurchase'){
    append('driver_jobs',{date:day(now),items_json:JSON.stringify(body.items),status:'pending',created_at:new Date(now).toISOString()});
    for(const p of [...list('pending_purchases')])remove('pending_purchases',p._id);
    notifications.push({channel:'telegram',destination:'telegram_chat_driver',message:'รายการรับของ '+day(now)+'\n'+body.items.map(i=>`${i.location}: ${i.name} ${i.qty} ${i.unit}`).join('\n')});result={success:true};
  }else if(action==='getPickups'){
    const job=list('driver_jobs').sort((a,b)=>b.created_at.localeCompare(a.created_at))[0],data={};
    for(const item of JSON.parse(job?.items_json||'[]'))(data[item.location]??=[]).push(`${item.name} ${item.qty} ${item.unit}`);
    result={success:true,data};
  }else if(action==='uploadDriverPhoto'){
    append('deliveries',{delivery_id:body.delivery_id,staff_id:body.staff_id,branch:body.branch,storage_path:body.storage_path,created_at:new Date(now).toISOString()});result={success:true,message:'บันทึกหลักฐานส่งของแล้ว'};
  }else if(legacy[action]) result=legacy[action](body);
  else throw Error('Unknown action');
  if(action==='saveStockLog'&&result.success&&result.workOrders?.length)notifications.push({channel:'line',destination:'line_group_central',message:'ใบสั่งงานครัวกลาง '+day(now)+'\n'+result.workOrders.map(w=>`${w.name}: ${w.qty} ${w.unit}`).join('\n')});
  // Failed business validation must not commit earlier mutations or notifications.
  return {result,changes:result.success?changes:[],notifications:result.success?notifications:[]};
}
ids.deliveries='delivery_id';ids.pending_purchases='_id';
ids.shifts='shift_id';
module.exports={execute,ids,day,cutoff,formatDate,safeStaff,safeSettings};
