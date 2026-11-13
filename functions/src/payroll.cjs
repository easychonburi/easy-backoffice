// Payroll rules from payroll.html; also executed server-side before committing payment.
module.exports = function calculate(staff, timesheets, start, end, settings, allAdvances) {
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
function getEffectiveShift(staff, dateStr, settings) {
  // วันอาทิตย์ → ทุกคนทุกสาขาใช้ 10:30–20:00
  const d = new Date(dateStr + 'T00:00:00');
  if (d.getDay() === 0) return { start: '10:30', end: '20:00', flexible: false };

  // ใช้ custom shift ต่อคน (จาก Sheets)
  if (staff.custom_shift_start) {
    return {
      start: staff.custom_shift_start,
      end: staff.custom_shift_end || null,
      flexible: !staff.custom_shift_end
    };
  }

  // 🔴 FIXED: ถ้าเป็น part-time และไม่ได้ใส่เวลา ให้เป็น Flexible ทันที ห้ามดึงค่า Global
  if (staff.staff_type !== 'fulltime') {
    return { start: null, end: null, flexible: true };
  }

  // fallback → global settings (สำหรับ fulltime เท่านั้น)
  const start = staff.shift === 'night' ? (settings.shift_night_start || '17:00') : (settings.shift_morning_start || '09:00');
  const end   = staff.shift === 'night' ? (settings.shift_night_end   || '01:00') : (settings.shift_morning_end   || '17:00');
  return { start, end, flexible: false };
}
function calcHoursBetween(startStr, endStr, shift) {
  if (!startStr || !endStr) return 0;
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  let s = sh * 60 + sm, e = eh * 60 + em;
  if (shift === 'night' && e < s) e += 1440;
  return Math.max(0, parseFloat(((e - s) / 60).toFixed(2)));
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
    const otHours = parseFloat(t.ot_hours) || 0;
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
        const shiftInfo = getEffectiveShift(staff, t.date, settings);
        let eIn = t.clock_in, eOut = t.clock_out;
        if (!shiftInfo.flexible) {
          if (shiftInfo.start && t.clock_in < shiftInfo.start) {
            eIn = shiftInfo.start;
            effectiveClockIn = shiftInfo.start;
          }
          if (shiftInfo.end && t.clock_out > shiftInfo.end) {
            eOut = shiftInfo.end;
            effectiveClockOut = shiftInfo.end;
          }
        }
        hrs = calcHoursBetween(eIn, eOut, staff.shift);
      }
      dayBase = parseFloat((rate * hrs).toFixed(2));
      hoursWorked += parseFloat(hrs.toFixed(2));
    }

    if (otHours > 0 && otApproved) {
      dayOT = parseFloat((otHours * otRatePerHour).toFixed(2));
      otPay += dayOT;
    }

    if (otPending) {
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
};
