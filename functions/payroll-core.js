// Shared calculation used by admin Payroll and employee income.
(function(root){
// Accept sheet HH:mm:ss and ISO time values without parseFloat('21:00') mistakes.
function parseTime(value){
  if(typeof value==='number')return value>=0&&value<1?Math.round(value*1440)%1440:null;
  const match=String(value??'').trim().match(/^(?:\d{4}-\d{2}-\d{2}T)?(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/);
  if(!match||Number(match[1])>23||Number(match[2])>59)return null;
  return Number(match[1])*60+Number(match[2]);
}
function formatTime(n){return String(Math.floor(n/60)%24).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function getEffectiveShift(staff,date,settings={}){
  let start,end;
  if(new Date(String(date).slice(0,10)+'T12:00:00').getDay()===0){start='10:30';end='20:00';}
  else if(staff.custom_shift_start){start=staff.custom_shift_start;end=staff.custom_shift_end;}
  else if(staff.staff_type!=='fulltime')return {start:null,end:null,flexible:true};
  else {const night=staff.shift==='night';start=settings[night?'shift_night_start':'shift_morning_start']||(night?'17:00':'09:00');end=settings[night?'shift_night_end':'shift_morning_end']||(night?'01:00':'17:00');}
  const s=parseTime(start),e=parseTime(end);
  return {start:s===null?null:formatTime(s),end:e===null?null:formatTime(e),flexible:s===null||e===null};
}
function attendance(staff,row,settings={}){
  const shift=getEffectiveShift(staff,row.date,settings),s=parseTime(shift.start),e=parseTime(shift.end);
  let i=parseTime(row.clock_in),o=parseTime(row.clock_out);
  const empty={shift,late_min:0,ot_mins:0,ot_hours:0,hours_worked:0,base_hours:0,effective_clock_in:null,effective_clock_out:null};
  if(i===null)return empty;
  // A clock-in after midnight belongs to the end of an overnight shift.
  if(!shift.flexible&&e<s&&i<s-360)i+=1440;
  const late=staff.staff_type==='fulltime'&&s!==null?Math.max(0,i-s):0;
  if(o===null)return {...empty,late_min:late};
  if(o<i)o+=1440;
  const end=shift.flexible?null:e+(e<s?1440:0);
  const raw=end===null?0:Math.max(0,o-Math.max(end,i));
  const grace=Number(settings.ot_grace_min??15);
  const ot=raw>(Number.isFinite(grace)&&grace>=0?grace:15)?raw:0;
  const a=shift.flexible?i:Math.max(i,s),b=shift.flexible?o:Math.min(o,end);
  return {shift,late_min:late,ot_mins:raw,ot_hours:Number((ot/60).toFixed(2)),hours_worked:Number(((o-i)/60).toFixed(2)),base_hours:Number((Math.max(0,b-a)/60).toFixed(2)),effective_clock_in:a!==i?formatTime(a):null,effective_clock_out:b!==o?formatTime(b):null};
}
function toDateStr(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function addDays(value,n){const d=new Date(value+'T00:00:00');d.setDate(d.getDate()+n);return toDateStr(d);}
function getCurrentPeriods(onDate) {
  const now = new Date((onDate || new Date().toLocaleDateString('en-CA', {timeZone: 'Asia/Bangkok'})) + 'T12:00:00');
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const dow = now.getDay();

  let ftStart, ftEnd, ftPayDate;
  // พนักงานประจำ (ถ้าวันนี้เป็นวันที่ 16 พอดี ให้ยังคงแสดงยอดของวันที่ 1-15 อยู่)
  if (d === 16) {
    ftStart = toDateStr(new Date(y, m, 1));
    ftEnd = toDateStr(new Date(y, m, 15));
    ftPayDate = toDateStr(new Date(y, m, 16));
  } else if (d === 1) { // ถ้าวันนี้เป็นวันที่ 1 พอดี ให้ยังคงแสดงยอดของวันที่ 16-สิ้นเดือนก่อนอยู่
    let lastM = m - 1; let lastY = y;
    if (lastM < 0) { lastM = 11; lastY--; }
    let lastDay = new Date(lastY, lastM + 1, 0).getDate();
    ftStart = toDateStr(new Date(lastY, lastM, 16));
    ftEnd = toDateStr(new Date(lastY, lastM, lastDay));
    ftPayDate = toDateStr(new Date(y, m, 1));
  } else if (d > 1 && d < 16) {
    ftStart = toDateStr(new Date(y, m, 1));
    ftEnd = toDateStr(new Date(y, m, 15));
    ftPayDate = toDateStr(new Date(y, m, 16));
  } else {
    const lastDay = new Date(y, m+1, 0).getDate();
    ftStart = toDateStr(new Date(y, m, 16));
    ftEnd = toDateStr(new Date(y, m, lastDay));
    ftPayDate = toDateStr(new Date(y, m+1, 1));
  }

  // พาร์ทไทม์ (ถ้าวันนี้เป็นวันจันทร์ ให้ยังคงแสดงยอดของจันทร์-อาทิตย์ที่แล้วอยู่)
  let ptMon = new Date(now);
  if (dow === 1) {
    ptMon.setDate(now.getDate() - 7);
  } else {
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    ptMon.setDate(now.getDate() + mondayOffset);
  }
  const ptSun = new Date(ptMon);
  ptSun.setDate(ptMon.getDate() + 6);
  const ptPay = new Date(ptMon);
  ptPay.setDate(ptMon.getDate() + 7);

  return {
    ftStart, ftEnd, ftPayDate,
    ftIsPayDay: toDateStr(now) === ftPayDate || toDateStr(now) === addDays(ftPayDate, 1),
    ptStart: toDateStr(ptMon), ptEnd: toDateStr(ptSun), ptPayDate: toDateStr(ptPay),
    ptIsPayDay: dow === 1
  };
}


function calculate(staff,timesheets,allAdvances,settings,start,end){
function getAdvancesForStaffPeriod(staffId, periodStart, periodEnd) {
  return allAdvances.filter(a =>
    String(a.staff_id) === String(staffId) &&
    a.status === 'pending' &&
    a.period_start === periodStart &&
    a.period_end === periodEnd
  );
}

function totalAdvanceAmount(staffId, periodStart, periodEnd) {
  return getAdvancesForStaffPeriod(staffId, periodStart, periodEnd)
    .reduce((sum, a) => sum + parseFloat(a.amount || 0), 0);
}

function calcPayroll(staff, timesheets, periodStart, periodEnd) {
  const ts = timesheets.filter(t => {
    const td = typeof t.date === 'string' ? t.date.substring(0,10) : toDateStr(new Date(t.date));
    return t.staff_id === staff.staff_id && td >= periodStart && td <= periodEnd;
  });

  const rate = parseFloat(staff.rate) || 0;
  // ดึงเรท OT จากหน้า staff มาใช้เป็นหลัก ถ้าไม่มีค่อยใช้ค่ากลาง
  const otRatePerHour = parseFloat(staff.ot_rate) || parseFloat(settings.ot_rate_per_hour) || 50;
  const lateGrace = parseInt(settings.late_grace_min) || 15;

  let basePay = 0, otPay = 0, lateDeduct = 0;
  let daysWorked = 0, hoursWorked = 0;
  let details = [], pendingOTs = [];

  ts.forEach(t => {
    if (!t.clock_in) return;
    const lateMin = parseInt(t.late_min) || 0;
    const work = attendance(staff,t,settings);
    const otHours = work.ot_hours;
    const otApproved = t.ot_status === 'approved';
    const otPending = t.ot_status === 'pending';

    let dayBase = 0, dayDeduct = 0, dayOT = 0;
    let effectiveClockIn = null, effectiveClockOut = null;

    if (staff.pay_type === 'daily') {
      dayBase = rate; daysWorked++;
      // หักสายเฉพาะ fulltime (part-time daily เช่น ต้น ไม่หัก)
      if (staff.staff_type === 'fulltime' && lateMin > lateGrace) {
        dayDeduct = parseFloat(((rate / 480) * lateMin).toFixed(2));
        lateDeduct += dayDeduct;
      }
    } else {
      // Part-time hourly: ตัดเวลาตาม shift จริงของแต่ละคน/วัน
      let hrs = parseFloat(t.hours_worked) || 0;
      if (t.clock_in && t.clock_out) {
        hrs = work.base_hours;
        effectiveClockIn = work.effective_clock_in;
        effectiveClockOut = work.effective_clock_out;
      }
      dayBase = parseFloat((rate * hrs).toFixed(2));
      hoursWorked += parseFloat(hrs.toFixed(2));
    }

    if (otHours > 0 && otApproved) {
      dayOT = parseFloat((otHours * otRatePerHour).toFixed(2));
      otPay += dayOT;
    }

    if (otPending && otHours > 0) {
      pendingOTs.push({ record_id: t.record_id, date: t.date, ot_hours: otHours, ot_reason: t.ot_reason || '—' });
    }

    basePay += dayBase;
    details.push({
      date: t.date, clock_in: t.clock_in, clock_out: t.clock_out,
      late_min: lateMin, late_deduct: dayDeduct,
      ot_hours: otHours, ot_pay: dayOT, ot_status: t.ot_status,
      ot_reason: t.ot_reason, record_id: t.record_id,
      day_total: parseFloat((dayBase - dayDeduct + dayOT).toFixed(2)),
      effective_clock_in: effectiveClockIn,
      effective_clock_out: effectiveClockOut
    });
  });

  // เบิกล่วงหน้า
  const advanceTotal = totalAdvanceAmount(staff.staff_id, periodStart, periodEnd);
  const advanceItems = getAdvancesForStaffPeriod(staff.staff_id, periodStart, periodEnd);

  const subtotal = parseFloat((basePay - lateDeduct + otPay).toFixed(2));
  const total = parseFloat((subtotal - advanceTotal).toFixed(2));

  return {
    staff, days_worked: daysWorked,
    hours_worked: parseFloat(hoursWorked.toFixed(2)),
    base_pay: parseFloat(basePay.toFixed(2)),
    ot_pay: parseFloat(otPay.toFixed(2)),
    late_deduct: parseFloat(lateDeduct.toFixed(2)),
    advance_total: parseFloat(advanceTotal.toFixed(2)),
    advance_items: advanceItems,
    subtotal, total,
    details, pendingOTs, ts_count: ts.length
  };
}


return calcPayroll(staff,timesheets,start,end);
}
const api={getCurrentPeriods,calculate,parseTime,getEffectiveShift,attendance};if(typeof module!=='undefined')module.exports=api;else root.EasyPayroll=api;
})(typeof window==='undefined'?globalThis:window);
