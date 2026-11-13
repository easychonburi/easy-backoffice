// Business rules ported from the supplied Apps Script. Storage and notifications are injected.
module.exports = function createLegacy({sheetToJson, appendRow, updateRowById, generateId, Utilities, Date, sendTelegram, sendLineMessage}) {
function getSettings() {
  const rows = sheetToJson('settings');
  const result = {};
  rows.forEach(r => { result[r.key] = r.value; });
  return { success: true, data: result };
}

function getStaff() {
  const data = sheetToJson('staff').filter(s => s.status === 'active');
  return { success: true, data };
}

function getBranches() { return { success: true, data: sheetToJson('branches').filter(b => b.status === 'active') }; }

function clockIn(body) {
  try {
    const { staff_id, lat, lng, date, late_reason } = body;
    const today = date || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');

    const existing = sheetToJson('timesheets').find(t => {
      const rowDate = t.date instanceof Date ? Utilities.formatDate(t.date, 'Asia/Bangkok', 'yyyy-MM-dd') : String(t.date).substring(0, 10);
      return String(t.staff_id) === String(staff_id) && rowDate === today && t.clock_in !== '';
    });
    if (existing) return { success: false, message: 'บันทึกเข้างานวันนี้แล้ว' };

    const branches = sheetToJson('branches').filter(b => b.status === 'active');
    let nearBranch = null, minDist = Infinity;
    branches.forEach(b => {
      if (!b.lat || !b.lng) return;
      const dist = haversine(parseFloat(lat), parseFloat(lng), parseFloat(b.lat), parseFloat(b.lng));
      if (dist <= parseFloat(b.allowed_radius_m) && dist < minDist) { minDist = dist; nearBranch = b; }
    });
    if (!nearBranch) return { success: false, message: 'คุณอยู่นอกพื้นที่สาขา ไม่สามารถบันทึกได้' };

    const settings = getSettings().data;
    const staff = sheetToJson('staff').find(s => String(s.staff_id) === String(staff_id));
    const shiftStart = staff.custom_shift_start || (staff.shift === 'night' ? settings.shift_night_start : settings.shift_morning_start);
    const clockInTime = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'HH:mm');
    const lateMin = calcLateMin(shiftStart, clockInTime);

    const record_id = generateId('TS');
    const staffName = staff.nickname || staff.name;
    const branchName = nearBranch.name;

    appendRow('timesheets', {
      record_id, staff_id, branch_id: nearBranch.branch_id, 
      staff_name: staffName, branch_name: branchName,
      date: today, clock_in: clockInTime, clock_out: '', hours_worked: '',
      late_min: lateMin > 0 ? lateMin : 0, late_reason: late_reason || '',
      ot_hours: '', ot_requested: '', ot_reason: '', ot_status: '',
      early_out_min: '', early_out_flag: '', early_out_note: '',
      note: '', status: 'active',
      clock_in_lat: lat, clock_in_lng: lng,
      clock_out_lat: '', clock_out_lng: '',
      location_flagged: false, created_at: new Date().toISOString()
    });

    sendTelegram(`✅ ${staffName} เข้างานแล้ว ${clockInTime} (${branchName})${lateMin > 15 ? '\n⚠️ สาย ' + lateMin + ' นาที' : ''}`, 'telegram_chat_clock');
    return { success: true, record_id, branch_name: branchName, clock_in: clockInTime, late_min: lateMin };
  } catch(e) { return { success: false, message: e.toString() }; }
}

function clockOut(body) {
  try {
    const { staff_id, lat, lng, date, ot_requested, ot_reason } = body;
    const now = new Date();
    const todayStr = date || Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
    const yesterdayStr = Utilities.formatDate(new Date(now.getTime() - 86400000), 'Asia/Bangkok', 'yyyy-MM-dd');

    // แก้ไข: ค้นหารายการเข้างานที่ยังค้างอยู่ของวันนี้ หรือ เมื่อวาน (สำหรับกะดึก)
    const record = sheetToJson('timesheets').find(t => {
      const rowDate = t.date instanceof Date ? Utilities.formatDate(t.date, 'Asia/Bangkok', 'yyyy-MM-dd') : String(t.date).substring(0, 10);
      return String(t.staff_id) === String(staff_id) && t.clock_out === '' && (rowDate === todayStr || rowDate === yesterdayStr);
    });

    if (!record) return { success: false, message: 'ไม่พบข้อมูลการเข้างานที่ค้างอยู่' };

    const clockOutTime = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'HH:mm');
    const hoursWorked = calcHoursWorked(record.clock_in, clockOutTime);
    const settings = getSettings().data;
    const staff = sheetToJson('staff').find(s => String(s.staff_id) === String(staff_id));
    const shiftEnd = staff.custom_shift_end || (staff.shift === 'night' ? settings.shift_night_end : settings.shift_morning_end);
    const otMins = calcOtMins(shiftEnd, clockOutTime);
    const graceMin = parseInt(settings.ot_grace_min) || 15;
    const hasOt = otMins > graceMin;

    updateRowById('timesheets', 'record_id', record.record_id, {
      clock_out: clockOutTime, clock_out_lat: lat, clock_out_lng: lng,
      hours_worked: hoursWorked, ot_hours: hasOt ? (otMins / 60).toFixed(2) : 0,
      ot_requested: ot_requested || 'no', ot_reason: ot_reason || '',
      ot_status: ot_requested === 'yes' ? 'pending' : 'no', status: 'complete'
    });

    sendTelegram(`🚪 ${staff.nickname || staff.name} ออกงานแล้ว ${clockOutTime}${hasOt && ot_requested === 'yes' ? '\n⏰ ขอ OT ' + otMins + ' นาที' : ''}`, 'telegram_chat_clock');
    return { success: true, clock_out: clockOutTime, hours_worked: hoursWorked, ot_mins: otMins, has_ot: hasOt, shift_end: shiftEnd };
  } catch(e) { return { success: false, message: e.toString() }; }
}

function getTodayStatus() {
  const now = new Date();
  const todayStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  const yesterdayStr = Utilities.formatDate(new Date(now.getTime() - 86400000), 'Asia/Bangkok', 'yyyy-MM-dd');
  const staffList = sheetToJson('staff');

  return { success: true, data: sheetToJson('timesheets').filter(t => {
    const rowDate = t.date instanceof Date ? Utilities.formatDate(t.date, 'Asia/Bangkok', 'yyyy-MM-dd') : String(t.date).substring(0, 10);
    
    // 1. ถ้าเป็นรายการของวันนี้ ให้ดึงมาแสดงปกติ
    if (rowDate === todayStr) return true;

    // 2. ถ้าเป็นรายการค้างของเมื่อวาน จะดึงมาแสดงเฉพาะพนักงานกะดึก (night) เท่านั้น
    if (rowDate === yesterdayStr && t.clock_out === '') {
      const staff = staffList.find(s => String(s.staff_id) === String(t.staff_id));
      return staff && staff.shift === 'night';
    }
    
    return false;
  })};
}

function getTimesheets(body) {
  let data = sheetToJson('timesheets');
  const staffId = body.staff_id || body.staffId;
  const dateFrom = body.date_from || body.dateFrom;
  const dateTo = body.date_to || body.dateTo;
  if (staffId) data = data.filter(t => String(t.staff_id) === String(staffId));
  if (dateFrom) data = data.filter(t => {
    const rowDate = t.date instanceof Date ? Utilities.formatDate(t.date, 'Asia/Bangkok', 'yyyy-MM-dd') : String(t.date).substring(0, 10);
    return rowDate >= dateFrom;
  });
  if (dateTo) data = data.filter(t => {
    const rowDate = t.date instanceof Date ? Utilities.formatDate(t.date, 'Asia/Bangkok', 'yyyy-MM-dd') : String(t.date).substring(0, 10);
    return rowDate <= dateTo;
  });
  return { success: true, data };
}

function updateTimesheetOT(body) { return { success: updateRowById('timesheets', 'record_id', body.record_id, { ot_status: body.ot_status }) }; }

function upsertTimesheet(body) {
  try {
    const staffId = String(body.staff_id || '').trim();
    const date = String(body.date || '').trim();
    const clockIn = String(body.clock_in || '').trim();
    const clockOut = String(body.clock_out || '').trim();
    const adminNote = String(body.admin_note || '').trim();

    if (!staffId || !date || !clockIn || !clockOut || !adminNote) {
      return { success: false, message: 'กรุณากรอกข้อมูลเวลาและเหตุผลให้ครบ' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(clockIn) || !/^\d{2}:\d{2}$/.test(clockOut)) {
      return { success: false, message: 'รูปแบบวันที่หรือเวลาไม่ถูกต้อง' };
    }
    if (clockIn === clockOut) return { success: false, message: 'เวลาเข้าและออกต้องไม่เท่ากัน' };

    const staff = sheetToJson('staff').find(s => String(s.staff_id) === staffId);
    if (!staff) return { success: false, message: 'ไม่พบข้อมูลพนักงาน' };

    const allTimesheets = sheetToJson('timesheets');
    let record = body.record_id
      ? allTimesheets.find(t => String(t.record_id) === String(body.record_id))
      : null;
    if (!record) {
      record = allTimesheets.find(t => {
        const rowDate = String(t.date).substring(0, 10);
        return String(t.staff_id) === staffId && rowDate === date;
      });
    }

    const settings = getSettings().data;
    const isNight = staff.shift === 'night';
    const shiftStart = staff.custom_shift_start || (isNight ? settings.shift_night_start : settings.shift_morning_start);
    const shiftEnd = staff.custom_shift_end || (isNight ? settings.shift_night_end : settings.shift_morning_end);
    const lateMin = shiftStart && staff.staff_type === 'fulltime' ? calcLateMin(shiftStart, clockIn) : 0;
    const otMins = shiftEnd ? calcOtMins(shiftEnd, clockOut) : 0;
    const graceMin = parseInt(settings.ot_grace_min) || 15;
    const hasOt = otMins > graceMin;
    const updates = {
      clock_in: clockIn,
      clock_out: clockOut,
      hours_worked: calcHoursWorked(clockIn, clockOut),
      late_min: lateMin,
      late_reason: lateMin > 0 ? 'แก้ไขโดยแอดมิน: ' + adminNote : '',
      // เวลาที่แอดมินแก้เป็นข้อมูลยืนยันแล้ว จึงไม่ค้างรออนุมัติ OT
      ot_hours: hasOt ? (otMins / 60).toFixed(2) : 0,
      ot_requested: 'no',
      ot_reason: '',
      ot_status: 'no',
      note: 'แก้ไขเวลาโดยแอดมิน: ' + adminNote,
      status: 'complete',
      clock_in_lat: '',
      clock_in_lng: '',
      clock_out_lat: '',
      clock_out_lng: '',
      location_flagged: false
    };

    if (record) {
      const updated = updateRowById('timesheets', 'record_id', record.record_id, updates);
      if (!updated) return { success: false, message: 'ไม่สามารถอัปเดตข้อมูลเดิมได้' };
      return { success: true, record_id: record.record_id, updated: true };
    }

    const branches = sheetToJson('branches');
    const branch = branches.find(b => String(b.branch_id) === String(staff.branch_id));
    const recordId = generateId('TS');
    appendRow('timesheets', {
      record_id: recordId,
      staff_id: staffId,
      branch_id: staff.branch_id || '',
      staff_name: staff.nickname || staff.name || '',
      branch_name: branch ? branch.name : '',
      date,
      ...updates,
      early_out_min: '', early_out_flag: '', early_out_note: '',
      created_at: new Date().toISOString()
    });
    return { success: true, record_id: recordId, created: true };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

function getPayrollRuns(body) {
  let data = sheetToJson('payroll_runs');
  if (body && body.staff_id) data = data.filter(p => p.staff_id === body.staff_id);
  if (body && body.status) data = data.filter(p => p.status === body.status);
  return { success: true, data };
}

function markPaid(body) { return { success: updateRowById('payroll_runs', 'run_id', body.run_id, { status: 'paid', paid_at: new Date().toISOString() }) }; }

function sendPayrollNotify(body) {
  const msg = `💰 จ่ายเงินเดือนแล้ว\n👤 ${body.staff_name}\n💵 ${parseFloat(body.total_pay).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท\n📅 รอบ: ${body.period_start} – ${body.period_end}`;
  sendTelegram(msg, 'telegram_chat_payroll');
  return { success: true };
}

function getAdvances(body) {
  let data = sheetToJson('advances');
  const staffId = body.staff_id || body.staffId;
  const status = body.status;
  if (staffId) data = data.filter(a => String(a.staff_id) === String(staffId));
  if (status) data = data.filter(a => a.status === status);
  return { success: true, data };
}

function saveAdvance(body) {
  const advance_id = generateId('ADV');
  appendRow('advances', {
    advance_id, staff_id: body.staff_id, amount: body.amount,
    date: body.date || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'),
    note: body.note || '', period_start: body.period_start, period_end: body.period_end,
    status: 'pending', created_at: new Date().toISOString()
  });
  const staff = sheetToJson('staff').find(s => String(s.staff_id) === String(body.staff_id));
  if (staff) {
    sendTelegram(`💸 บันทึกเบิกล่วงหน้า\n👤 ${staff.nickname || staff.name}\n💵 ฿${parseFloat(body.amount).toLocaleString('th-TH')} บาท\n📝 ${body.note || '—'}\n📅 หักรอบ: ${body.period_start} – ${body.period_end}`, 'telegram_chat_payroll');
  }
  return { success: true, advance_id };
}

function calcLateMin(shiftStart, clockIn) {
  const [sh, sm] = shiftStart.split(':').map(Number);
  const [ch, cm] = clockIn.split(':').map(Number);
  return Math.max(0, (ch * 60 + cm) - (sh * 60 + sm));
}

function calcOtMins(shiftEnd, clockOut) {
  const [eh, em] = shiftEnd.split(':').map(Number);
  let [ch, cm] = clockOut.split(':').map(Number);
  if (ch < eh - 6) ch += 24;
  return Math.max(0, (ch * 60 + cm) - (eh * 60 + em));
}

function calcHoursWorked(clockIn, clockOut) {
  const [ih, im] = clockIn.split(':').map(Number);
  let [oh, om] = clockOut.split(':').map(Number);
  if (oh < ih) oh += 24;
  return parseFloat(((oh * 60 + om - (ih * 60 + im)) / 60).toFixed(2));
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getStockItems(body) {
  try {
    const mode = body.mode || body; 
    const branch_id = body.branch_id || '';
    if (!mode) return { success: false, message: 'Missing mode' };
    const items = getItemsListByMode(mode, branch_id);
    return { success: true, data: items };
  } catch (error) { return { success: false, message: error.toString() }; }
}

function saveStockLog(body) {
  try {
    const logId = generateId('ST');
    const staffList = sheetToJson('staff');
    const branchList = sheetToJson('branches');
    
    const staff = staffList.find(s => String(s.staff_id) === String(body.staff_id));
    const nickname = staff ? (staff.nickname || staff.name) : body.staff_id;
    const branch = branchList.find(b => String(b.branch_id) === String(body.branch_id));
    const branchName = branch ? branch.name : body.branch_id;

    appendRow('stock_logs', {
      log_id: logId, branch_id: body.branch_id, branch_name: branchName,
      mode: body.mode, items_json: JSON.stringify(body.stocks || []),
      orders_json: JSON.stringify(body.orders || []),
      staff_id: body.staff_id || 'UNKNOWN', staff_name: nickname,
      checked_at: new Date().toISOString()
    });

    // 🎯 ระบบคำนวณงานครัวกลาง (Work Orders)
    let workOrders = [];
    if (String(body.branch_id) === 'BR005' && body.mode === 'open') {
      const targets = sheetToJson('central_targets');
      body.stocks.forEach(s => {
        const t = targets.find(item => item.item_name === s.name);
        if (t) {
          const currentVal = parseFloat(s.value) || 0;
          const targetVal = parseFloat(t.target_qty) || 0;
          const ratio = parseFloat(t.conversion_ratio) || 1;
          let batches = 0;

          if (t.trigger_type === 'zero' && currentVal === 0) {
            batches = Math.ceil(targetVal / ratio);
          } else if (t.trigger_type === 'diff') {
            const diff = targetVal - currentVal;
            if (diff > 0) batches = Math.ceil(diff / ratio);
          }
          if (batches > 0) workOrders.push({ name: s.name, qty: batches, unit: t.production_unit });
        }
      });
    }

    const isOpening = body.mode === 'open';
    const chatKey = isOpening ? 'telegram_chat_stock_open' : 'telegram_chat_stock_close';
    let msg = `📦 สรุปเช็คสต็อก (${isOpening ? 'เปิดร้าน' : 'ปิดร้าน'})\n📍 สาขา: ${branchName}\n👤 พนักงาน: ${nickname}\n\n`;

    if (body.stocks && body.stocks.length > 0) {
      msg += `🟡 สต๊อกคงเหลือ\n`;
      body.stocks.forEach(item => { msg += `${item.name} ${item.value} ${item.unit || ''}\n`; });
      msg += `\n`;
    }

    if (!isOpening && body.orders && body.orders.length > 0) {
      msg += `🚨 *รายการที่ต้องสั่งเพิ่ม:*\n`;
      body.orders.forEach(o => { msg += `- ${o}\n`; });
    }

    sendTelegram(msg, chatKey);
    // 🟢 ส่งใบสั่งงานเข้า LINE กลุ่มครัวกลางอัตโนมัติ
    if (workOrders && workOrders.length > 0) {
      const settings = getSettings().data;
      const lineToken = settings.line_bot_token;
      const lineGroupId = settings.line_group_central;

      if (lineToken && lineGroupId) {
        const d = new Date();
        const dateStr = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()+543}`;
        let lineMsg = `📝 ใบสั่งงานครัวกลาง (${dateStr})\n\n`;
        
        workOrders.forEach(w => {
          lineMsg += `👉 ${w.name}: +${w.qty} ${w.unit}\n`;
        });
        
        sendLineMessage(lineMsg, lineGroupId, lineToken);
      }
    }
    return { success: true, log_id: logId, workOrders: workOrders };
  } catch (error) { return { success: false, message: error.toString() }; }
}

function getItemsListByMode(mode, branch_id) {
    const openModeItemsBase = [
      { name: 'เส้นหมี่', unit: 'ห่อ', type:'fraction', category: 'fresh' },
      { name: 'อกไก่', unit: 'กิโล', type:'free', category: 'fresh' },
      { name: 'หมูกระจก', unit: 'ถุง', type:'fraction', category: 'fresh' },
      { name: 'ผักกาดหอม', unit: 'กิโล', type:'free', category: 'fresh' },
      { name: 'กล่อง 26 oz', unit: 'แถว', type:'fraction', category: 'packaging' },
      { name: 'กล่อง 32 oz', unit: 'แถว', type:'fraction', category: 'packaging' },
      { name: 'โค้ก', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'สไปร์ท', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'น้ำแดง', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'น้ำส้ม', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'เก๊กฮวย', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'อัญชัน', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'ชาไทย', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'ชาเขียวมะลิ', unit: 'ขวด', type:'free', category: 'packaging' }
    ];

    const closeModeItemsBase = [
      { name:'เส้นหมี่', unit:'ห่อ', category:'fresh', icon:'🥬', type:'fraction' },
      { name:'อกไก่', unit:'กิโล', category:'fresh', icon:'🥬', type:'free' },
      { name:'หมูกระจก', unit:'ถุง', category:'fresh', icon:'🥬', type:'fraction' },
      { name:'ผักกาดหอม', unit:'กิโล', category:'fresh', icon:'🥬', type:'free' },
      { name:'ใบพาสเล่ย์', unit:'ถุง', category:'fresh', icon:'🥬', type:'fraction' },
      { name:'ลูกชิ้นปลา', unit:'', category:'fresh', icon:'🥬', orderOnly:true },
      { name:'ไข่กุ้ง', unit:'', category:'fresh', icon:'🥬', orderOnly:true },
      { name:'น้ำมันกระเทียมเจียว', unit:'แกลลอน', category:'seasoning', icon:'🧂', type:'fraction' },
      { name:'กระเทียมเจียว', unit:'กรัม', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ซอสดั้งเดิม', unit:'แกลลอน', category:'seasoning', icon:'🧂', type:'fraction' },
      { name:'น้ำมะนาว', unit:'ขวด', category:'seasoning', icon:'🧂', orderOnly:true },
      { name:'พริกป่น', unit:'ถุง', category:'seasoning', icon:'🧂', orderOnly:true },
      { name:'น้ำตาล', unit:'ถุง', category:'seasoning', icon:'🧂', orderOnly:true },
      { name:'น้ำปลา', unit:'ขวด', category:'seasoning', icon:'🧂', orderOnly:true },
      { name:'รสดี', unit:'ถุง', category:'seasoning', icon:'🧂', orderOnly:true },
      { name:'ถุงซีล 7×10', unit:'ห่อ', category:'packaging', icon:'📦', type:'fraction' },
      { name:'ถุงซีล 9×11.5', unit:'ห่อ', category:'packaging', icon:'📦', type:'fraction' },
      { name:'กล่อง 26 oz', unit:'แถว', category:'packaging', icon:'📦', type:'fraction' },
      { name:'กล่อง 32 oz', unit:'แถว', category:'packaging', icon:'📦', type:'fraction' },
      { name:'ถุงหิ้วพลาสติก 6×14', unit:'ห่อ', category:'packaging', icon:'📦', type:'fraction' },
      { name:'ถุงหิ้วพลาสติก 8×16', unit:'ห่อ', category:'packaging', icon:'📦', type:'fraction' },
      { name:'สติ๊กเกอร์ ดั้งเดิม', unit:'แผ่น', category:'packaging', icon:'📦', type:'fraction' },
      { name:'สติ๊กเกอร์ แซ่บ', unit:'แผ่น', category:'packaging', icon:'📦', type:'fraction' },
      { name:'น้ำเปล่า', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'น้ำโค้ก', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'น้ำส้ม', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'น้ำแดง', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'น้ำสไปร์ท', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'น้ำเก๊กฮวย', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'น้ำอัญชัน', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'ชาไทย', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'กระดาษใบเสร็จ', unit:'ม้วน', category:'packaging', icon:'📦', orderOnly:true },
      { name:'ตะเกียบ', unit:'', category:'packaging', icon:'📦', orderOnly:true },
      { name:'ถุงขยะ', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'ทิชชู่เปียก', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'ทิชชู่แห้ง', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'น้ำยาถูพื้น', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'น้ำยาซักผ้า', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'น้ำยาล้างจาน', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'ฟองน้ำล้างจาน', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'ถุงมือ', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'หมวกคลุมผม', unit:'', category:'cleaning', icon:'🧹', orderOnly:true }
    ];

    // 🛠️ แก้ไข: เรียงลำดับใหม่, เปลี่ยน type เป็น 'free' (จำนวนเต็ม), และตั้ง category เป็น 'other' ให้โชว์รวมกัน
    const nongTamleungOpen = [
      { name:'อกไก่', unit:'ถุงเล็ก', type:'free', category: 'other' },
      { name:'หมูกระจก', unit:'ถุง', type:'free', category: 'other' },
      { name:'ซอส', unit:'แกลลอน', type:'free', category: 'other' },
      { name:'น้ำมันกระเทียมเจียว', unit:'แกลลอน', type:'free', category: 'other' },
      { name:'เก๊กฮวย', unit:'ขวด', type:'free', category: 'other' },
      { name:'อัญชัน', unit:'ขวด', type:'free', category: 'other' },
      { name:'ชาไทย', unit:'ขวด', type:'free', category: 'other' }
    ];
    
    const nongTamleungClose = [
      { name:'น้ำมัน', unit:'แกลลอน', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ซีอิ๋วขาว', unit:'แกลลอน', category:'seasoning', icon:'🧂', type:'free' },
      { name:'น้ำส้มสายชู', unit:'แกลลอน', category:'seasoning', icon:'🧂', type:'free' },
      { name:'น้ำตาล', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'น้ำปลา', unit:'ขวด', category:'seasoning', icon:'🧂', type:'free' },
      { name:'รสดีเหลือง', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'รสดีเขียว', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'รสดีส้ม', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ผงชูรส', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'พริกป่น', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'น้ำมันหอย', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'หมูกระจก(ยังไม่ผัด)', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ผงเก๊กฮวย', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ผงอัญชัน', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ผงชาไทยตรามือ', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ผงชาไทยยอดชา', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'นมข้นจืด', unit:'กระป๋อง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'เกลือ', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'น้ำมะนาว', unit:'ขวด', category:'seasoning', icon:'🧂', type:'free' },
      { name:'นมข้นหวาน', unit:'กระป๋อง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'สติ๊กเกอร์อัญชัน', unit:'แผ่น', category:'packaging', icon:'📦', type:'fraction' },
      { name:'สติ๊กเกอร์เก๊กฮวย', unit:'แผ่น', category:'packaging', icon:'📦', type:'fraction' },
      { name:'สติ๊กเกอร์ชาไทย', unit:'แผ่น', category:'packaging', icon:'📦', type:'fraction' },
      { name:'ขวดน้ำ', unit:'', category:'packaging', icon:'📦', orderOnly:true }
    ];

    const branchNameStr = String(branch_id).toUpperCase();
    if (branchNameStr === 'BR005' || branchNameStr.includes('หนองตำลึง')) {
      return mode === 'open' ? nongTamleungOpen : nongTamleungClose;
    }
    
    return mode === 'open' ? openModeItemsBase : closeModeItemsBase;
}

function submitDriverReturn(body) {
  try {
    const { items } = body;
    const logId = generateId('ST_DRV');
    
    // บันทึกของที่คนขับเหลือ ไว้ใน stock_logs โดยใช้รหัสสาขาเป็น DRIVER
    appendRow('stock_logs', {
      log_id: logId,
      branch_id: 'DRIVER',
      branch_name: 'รถคนขับ',
      mode: 'return',
      items_json: JSON.stringify(items),
      orders_json: '[]',
      staff_id: 'DRIVER',
      staff_name: 'คนขับรถ',
      checked_at: new Date().toISOString()
    });

    sendTelegram(`📥 คนขับคืนสต็อกเรียบร้อย!`, 'telegram_chat_driver'); 
    return { success: true };
  } catch(e) { return { success: false, message: e.toString() }; }
}

return {getSettings,getStaff,getBranches,clockIn,clockOut,getTodayStatus,getTimesheets,updateTimesheetOT,upsertTimesheet,getPayrollRuns,markPaid,sendPayrollNotify,getAdvances,saveAdvance,calcLateMin,calcOtMins,calcHoursWorked,haversine,getStockItems,saveStockLog,getItemsListByMode,submitDriverReturn};
};
