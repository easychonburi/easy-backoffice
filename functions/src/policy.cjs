const {day}=require('./domain.cjs');
const reads=new Set('getStaff getBranches getSettings getTimesheets getTodayStatus getPayrollRuns getAdvances getStockItems getTodayStockOrders getCentralTargets getDriverOrders getPickups getPendingPurchases getLeaves'.split(' '));
const writes=new Set('addStaff updateStaff updateStaffStatus clockIn clockOut updateTimesheetOT upsertTimesheet savePayrollRun markPaid saveAdvance saveStockLog updateCentralTarget uploadDriverPhoto submitDriverReturn approvePurchase saveLeave deleteLeave'.split(' '));
const basic=new Set('getBranches getSettings getTimesheets getTodayStatus getStockItems clockIn clockOut saveStockLog'.split(' '));
const driver=new Set('getDriverOrders getPickups uploadDriverPhoto submitDriverReturn'.split(' '));
const staffFields=new Set('staff_id name nickname branch_id staff_type shift pay_type rate ot_rate late_threshold_min pay_cycle pay_day status role bank_name bank_account custom_shift_start custom_shift_end day_off'.split(' '));
['getAdminStaff','getAdminBranches','getShifts','getAdminData'].forEach(a=>reads.add(a));
['saveBranch','saveShift','saveSettings'].forEach(a=>writes.add(a));
staffFields.add('shift_id');staffFields.add('expected_version');
function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
function required(b,...keys){for(const k of keys)if(b[k]===undefined||b[k]===null||b[k]==='')throw Error('Missing '+k);}
function authorize(action,input,staff,now=new Date()){
  if(!reads.has(action)&&!writes.has(action))throw Error('Unknown action');
  if(!staff||staff.status!=='active')throw Error('UNAUTHENTICATED');
  if(staff.role!=='admin'&&!basic.has(action)&&!(staff.role==='driver'&&driver.has(action)))throw Error('FORBIDDEN');
  const b=JSON.parse(JSON.stringify(input));delete b.action;delete b.request_id;
  // Existing pages render text into HTML. Reject markup rather than persisting executable input.
  function validateText(value){if(typeof value==='string'&&/[<>]/.test(value))throw Error('Invalid text');if(value&&typeof value==='object')Object.values(value).forEach(validateText);}
  if(writes.has(action)&&action!=='uploadDriverPhoto')validateText(b);
  for(const k of Object.keys(b))if(/token|secret|pin|__proto__|constructor|prototype/i.test(k))throw Error('Invalid field');
  b.staff_id=b.staff_id||b.staffId;delete b.staffId;
  b.date_from=b.date_from||b.dateFrom;delete b.dateFrom;
  b.date_to=b.date_to||b.dateTo;delete b.dateTo;
  for(const k of Object.keys(b))if(b[k]===undefined)delete b[k];
  if(staff.role!=='admin'){
    if(b.staff_id&&b.staff_id!==staff.staff_id)throw Error('FORBIDDEN');
    if(b.branch_id&&b.branch_id!==staff.branch_id)throw Error('FORBIDDEN');
    b.staff_id=staff.staff_id;
    if(['getStockItems','saveStockLog'].includes(action))b.branch_id=staff.branch_id;
  }
  for(const k of ['staff_id','record_id','run_id','advance_id','leave_id','branch_id'])if(b[k]&&!/^[\p{L}\p{N}_-]{1,150}$/u.test(String(b[k])))throw Error('Invalid '+k);
  if(['clockIn','clockOut'].includes(action)){
    b.staff_id=staff.staff_id;b.date=day(now);required(b,'lat','lng');
    b.lat=Number(b.lat);b.lng=Number(b.lng);
    if(!Number.isFinite(b.lat)||!Number.isFinite(b.lng)||Math.abs(b.lat)>90||Math.abs(b.lng)>180)throw Error('Invalid coordinates');
  }
  if(['saveStockLog','getStockItems'].includes(action)&&!['open','close'].includes(b.mode))throw Error('Invalid stock mode');
  if(action==='saveStockLog')required(b,'staff_id','branch_id');
  if(['saveStockLog','submitDriverReturn','approvePurchase'].includes(action)){
    for(const field of (action==='saveStockLog'?['stocks','orders']:['items'])){
      if(!Array.isArray(b[field])||b[field].length>150)throw Error('Invalid '+field);
      if(JSON.stringify(b[field]).length>60000)throw Error('Payload too large');
    }
  }
  if(['saveAdvance','savePayrollRun'].includes(action)){required(b,'staff_id','period_start','period_end');if(!validDate(b.period_start)||!validDate(b.period_end)||b.period_start>b.period_end)throw Error('Invalid period');}
  if(action==='saveAdvance'){b.amount=Number(b.amount);if(!Number.isFinite(b.amount)||b.amount<=0)throw Error('Invalid amount');}
  if(action==='savePayrollRun'){
    required(b,'total_pay','pay_date');if(!validDate(b.pay_date)||!Number.isFinite(Number(b.total_pay))||!Number.isFinite(Number(b.manual_adjust||0)))throw Error('Invalid payroll');
    if(Number(b.manual_adjust)&&!String(b.adjust_note||'').trim())throw Error('Adjustment reason required');
  }
  if(action==='upsertTimesheet'||action==='saveLeave'){
    required(b,'staff_id','date');if(!validDate(b.date))throw Error('Invalid date');
    if(action==='upsertTimesheet')for(const k of ['clock_in','clock_out'])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(b[k]))throw Error('Invalid time');
  }
  if(action==='saveLeave'&&!['ลากิจ','ลาป่วย','ลาพักร้อน','ลาอื่นๆ','อื่นๆ'].includes(b.leave_type))throw Error('Invalid leave type');
  if(action==='updateTimesheetOT'&&!['approved','rejected'].includes(b.ot_status))throw Error('Invalid OT status');
  if(action==='updateCentralTarget'){required(b,'item_name');b.target_qty=Number(b.target_qty);if(!Number.isFinite(b.target_qty)||b.target_qty<0)throw Error('Invalid target');}
  if(['addStaff','updateStaff','updateStaffStatus'].includes(action)){
    for(const k of Object.keys(b))if(!staffFields.has(k))throw Error('Invalid staff field');
    if(b.role&&!['admin','staff','driver'].includes(b.role))throw Error('Invalid role');
    if(b.status&&!['active','inactive'].includes(b.status))throw Error('Invalid status');
    if(action==='updateStaffStatus')required(b,'staff_id','status');
    if(action==='addStaff')required(b,'name','branch_id','role','pay_type','staff_type','shift');
    for(const k of ['rate','ot_rate'])if(b[k]!==undefined){b[k]=Number(b[k]);if(!Number.isFinite(b[k])||b[k]<0)throw Error('Invalid '+k);}
    if(b.pay_type&&!['daily','hourly'].includes(b.pay_type))throw Error('Invalid pay type');
    if(b.staff_type&&!['fulltime','parttime'].includes(b.staff_type))throw Error('Invalid staff type');
    if(b.shift&&!['morning','night'].includes(b.shift))throw Error('Invalid shift');
    for(const k of ['custom_shift_start','custom_shift_end'])if(b[k]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(b[k]))throw Error('Invalid time');
  }
  if(action==='saveShift'){
    required(b,'name','start','end','status');
    for(const k of ['start','end'])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(b[k]))throw Error('Invalid time');
    if(b.start===b.end||!['active','inactive'].includes(b.status))throw Error('Invalid shift');
    for(const k of Object.keys(b))if(!['shift_id','name','start','end','status','expected_version'].includes(k))throw Error('Invalid shift field');
  }
  if(action==='saveBranch'){
    required(b,'name','lat','lng','allowed_radius_m','status');
    for(const k of ['lat','lng','allowed_radius_m']){b[k]=Number(b[k]);if(!Number.isFinite(b[k]))throw Error('Invalid '+k);}
    if(Math.abs(b.lat)>90||Math.abs(b.lng)>180||b.allowed_radius_m<=0||b.allowed_radius_m>5000)throw Error('Invalid GPS area');
    if(!['active','inactive'].includes(b.status))throw Error('Invalid status');
    for(const k of Object.keys(b))if(!['branch_id','name','short_name','address','lat','lng','allowed_radius_m','status','expected_version'].includes(k))throw Error('Invalid branch field');
  }
  if(action==='saveSettings'){
    if(!b.values||typeof b.values!=='object'||Array.isArray(b.values))throw Error('Invalid settings');
    for(const [k,v] of Object.entries(b.values)){
      if(!['shift_morning_start','shift_morning_end','shift_night_start','shift_night_end','late_grace_min','ot_grace_min','ot_rate_per_hour'].includes(k))throw Error('Invalid setting');
      if(k.startsWith('shift_')){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw Error('Invalid time');}
      else if(!Number.isFinite(Number(v))||Number(v)<0||Number(v)>1440)throw Error('Invalid setting value');
    }
  }
  for(const k of ['date_from','date_to'])if(b[k]&&!validDate(b[k]))throw Error('Invalid '+k);
  if(b.date_from&&b.date_to&&b.date_from>b.date_to)throw Error('Invalid range');
  return b;
}
module.exports={authorize,reads,writes,validDate};
