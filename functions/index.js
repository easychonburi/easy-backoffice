'use strict';
const crypto = require('node:crypto');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
initializeApp();
const db = getFirestore();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function configuration() {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';
  if (!project.endsWith('-staging') && !(project === 'demo-easy-simple' && process.env.FIRESTORE_EMULATOR_HOST)) throw Error('Staging project required');
  if ((process.env.PIN_SECRET || '').length < 32) throw Error('PIN_SECRET required (32+ characters)');
}
const lookup = pin => crypto.createHmac('sha256', process.env.PIN_SECRET).update(pin).digest('hex');
const safe = row => ({staff_id: row.staff_id, name: row.name, nickname: row.nickname, role: row.role, status: row.status,
  branch_id: row.branch_id || '', staff_type: row.staff_type || 'fulltime', pay_type: row.pay_type || 'daily', rate: row.rate ?? 0,
  ot_rate: row.ot_rate ?? null, shift: row.shift || 'morning', custom_shift_start: row.custom_shift_start || '', custom_shift_end: row.custom_shift_end || ''});
// EASY main uses two global shifts, optional individual times, and a global OT fallback.
const workDefaults = {shift_morning_start: '09:00', shift_morning_end: '17:00', shift_night_start: '17:00', shift_night_end: '01:00', ot_rate_per_hour: 50, late_grace_min: 15};
function number(value, label, min = 0, max = 100000) {
  if (value === '' || value == null || !['string','number'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) fail(label + 'ไม่ถูกต้อง');
  return Number(value);
}
function time(value) { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value); }
function fail(message, status = 400) { const error = Error(message); error.status = status; throw error; }
function validate(body) {
  if ((!body.staff_id || body.pin) && (typeof body.pin !== 'string' || !/^\d{4}$/.test(body.pin))) fail('กรอก PIN ตัวเลข 4 หลัก');
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) fail('กรอกชื่อไม่เกิน 80 ตัวอักษร');
  if (body.nickname != null && (typeof body.nickname !== 'string' || body.nickname.length > 80)) fail('ชื่อเล่นไม่ถูกต้อง');
  if (!['admin', 'staff', 'driver'].includes(body.role) || !['active', 'inactive'].includes(body.status)) fail('บทบาทหรือสถานะไม่ถูกต้อง');
  if (body.staff_id && !validId(body.staff_id)) fail('รหัสรายการไม่ถูกต้อง');
}
async function saveStaff(body, actor, first = false) {
  validate(body);
  const ref = body.staff_id ? db.collection('staff').doc(body.staff_id) : db.collection('staff').doc();
  if (!first && actor.staff_id === ref.id && (body.role !== 'admin' || body.status !== 'active')) fail('ไม่สามารถปิดบัญชีหรือลดสิทธิ์ผู้ดูแลที่กำลังใช้งาน');
  const branchId = body.branch_id || '';
  if (branchId && !validId(branchId)) fail('สาขาไม่ถูกต้อง');
  const staffType = body.staff_type || 'fulltime', payType = body.pay_type || 'daily', shift = body.shift || 'morning';
  if (!['fulltime','parttime'].includes(staffType) || !['daily','hourly'].includes(payType) || !['morning','night'].includes(shift)) fail('ประเภทพนักงาน ค่าแรง หรือกะไม่ถูกต้อง');
  const start = body.custom_shift_start || '', end = body.custom_shift_end || '';
  if ((start && !time(start)) || (end && (!time(end) || !start)) || (start && start === end)) fail('เวลาเฉพาะรายคนไม่ถูกต้อง');
  const pinRef = body.pin ? db.collection('pin_index').doc(lookup(body.pin)) : null;
  const salt = crypto.randomBytes(16).toString('hex');
  let row = {staff_id: ref.id, name: body.name.trim(), nickname: body.nickname || '', role: body.role, status: body.status,
    branch_id: branchId, staff_type: staffType, pay_type: payType, shift, custom_shift_start: start, custom_shift_end: end,
    rate: number(body.rate ?? 0, 'ค่าแรง'), ot_rate: body.ot_rate == null || body.ot_rate === '' ? null : number(body.ot_rate, 'อัตรา OT', 0.01)};
  await db.runTransaction(async tx => {
    const [old, existing, initial, branch] = await Promise.all([tx.get(ref), pinRef ? tx.get(pinRef) : null, first ? tx.get(db.collection('staff').limit(1)) : null, branchId ? tx.get(db.collection('branches').doc(branchId)) : null]);
    if (first && !initial.empty) fail('มีพนักงานแล้ว ไม่สามารถ bootstrap ซ้ำ');
    if (body.staff_id && !old.exists) fail('ไม่พบพนักงาน', 404);
    if (branchId && (!branch.exists || (branch.data().status !== 'active' && old.data()?.branch_id !== branchId))) fail('กรุณาเลือกสาขาที่เปิดใช้งาน');
    if (!first && body.role !== 'admin' && !branchId) fail('กรุณากำหนดสาขา');
    if (existing?.exists && existing.data().staff_id !== ref.id) fail('PIN นี้ถูกใช้แล้ว');
    const previous = old.data() || {};
    row = {...previous, ...row, version: body.pin || previous.role !== row.role || previous.status !== row.status ? crypto.randomUUID() : previous.version};
    if (pinRef) {
      if (old.exists && previous.pin_lookup !== pinRef.id) tx.delete(db.collection('pin_index').doc(previous.pin_lookup));
      Object.assign(row, {pin_lookup: pinRef.id, pin_salt: salt, pin_hash: crypto.scryptSync(body.pin, salt, 32).toString('hex')});
      tx.set(pinRef, {staff_id: ref.id});
    }
    tx.set(ref, row);
  });
  return safe(row);
}
async function saveBranch(body) {
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80 || !['active','inactive'].includes(body.status)) fail('ชื่อหรือสถานะสาขาไม่ถูกต้อง');
  if (body.branch_id && !validId(body.branch_id)) fail('สาขาไม่ถูกต้อง');
  const ref = body.branch_id ? db.collection('branches').doc(body.branch_id) : db.collection('branches').doc();
  const empty = value => value === '' || value == null;
  if (empty(body.lat) !== empty(body.lng)) fail('กรอกละติจูดและลองจิจูดให้ครบ หรือเว้นว่างทั้งคู่');
  const row = {branch_id: ref.id, name: body.name.trim(), status: body.status,
    lat: empty(body.lat) ? null : number(body.lat, 'ละติจูด', -90, 90), lng: empty(body.lng) ? null : number(body.lng, 'ลองจิจูด', -180, 180), allowed_radius_m: number(body.allowed_radius_m, 'รัศมี', 1, 10000)};
  await db.runTransaction(async tx => { if (body.branch_id && !(await tx.get(ref)).exists) fail('ไม่พบสาขา', 404); tx.set(ref, row); });
  return row;
}
async function saveWorkSettings(body) {
  const row = {};
  for (const key of ['shift_morning_start','shift_morning_end','shift_night_start','shift_night_end']) { if (!time(body[key])) fail('กรอกเวลากะให้ครบ'); row[key] = body[key]; }
  if (row.shift_morning_start === row.shift_morning_end || row.shift_night_start === row.shift_night_end) fail('เวลาเริ่มและเลิกงานต้องต่างกัน');
  row.ot_rate_per_hour = number(body.ot_rate_per_hour, 'อัตรา OT', 0.01);
  row.late_grace_min = number(body.late_grace_min, 'นาทีผ่อนผัน', 0, 120);
  if (!Number.isInteger(row.late_grace_min)) fail('นาทีผ่อนผันต้องเป็นจำนวนเต็ม');
  await db.collection('settings').doc('work').set(row);
  return row;
}
async function login(pin) {
  // Shared shop-wide limit also bounds distributed PIN guessing; includes successful attempts.
  const rate = db.collection('login_limits').doc('shop');
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(rate), old = snapshot.data() || {}, now = Date.now();
    const current = old.until > now ? old : {count: 0, until: now + 60000};
    if (current.count >= 10) fail('ลองเข้าสู่ระบบมากเกินไป รอ 1 นาที', 429);
    tx.set(rate, {...current, count: current.count + 1});
  });
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) fail('PIN ไม่ถูกต้อง', 401);
  const index = await db.collection('pin_index').doc(lookup(pin)).get();
  const staff = index.exists ? (await db.collection('staff').doc(index.data().staff_id).get()).data() : null;
  if (!staff || staff.status !== 'active' || !crypto.timingSafeEqual(crypto.scryptSync(pin, staff.pin_salt, 32), Buffer.from(staff.pin_hash, 'hex'))) fail('PIN ไม่ถูกต้อง', 401);
  const token = crypto.randomBytes(32).toString('base64url');
  await db.collection('sessions').doc(digest(token)).set({staff_id: staff.staff_id, version: staff.version, expires: Date.now() + (staff.role === 'driver' ? 8 : 3) * 3600000});
  return {staff: safe(staff), token};
}
async function dispatch(body, token) {
  if (body.action === 'login') return login(body.pin);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail('กรุณาเข้าสู่ระบบใหม่', 401);
  const ref = db.collection('sessions').doc(digest(token)), session = (await ref.get()).data();
  if (!session || session.expires <= Date.now()) fail('เซสชันหมดอายุ', 401);
  const staff = (await db.collection('staff').doc(session.staff_id).get()).data();
  if (!staff || staff.status !== 'active' || staff.version !== session.version) fail('กรุณาเข้าสู่ระบบใหม่', 401);
  if (body.action === 'logout') { await ref.delete(); return true; }
  if (body.action === 'me') return safe(staff);
  if (staff.role !== 'admin') fail('เฉพาะผู้ดูแล', 403);
  if (body.action === 'listStaff') return (await db.collection('staff').get()).docs.map(doc => safe(doc.data()));
  if (body.action === 'saveStaff') return saveStaff(body, staff);
  if (body.action === 'listBranches') return (await db.collection('branches').get()).docs.map(doc => doc.data());
  if (body.action === 'saveBranch') return saveBranch(body);
  if (body.action === 'getWorkSettings') return {...workDefaults, ...(await db.collection('settings').doc('work').get()).data()};
  if (body.action === 'saveWorkSettings') return saveWorkSettings(body);
  fail('ยังไม่เปิดใช้รายการนี้ใน foundation', 404);
}
exports.api = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({success: false, error: 'POST required'});
  try {
    configuration();
    if (!req.is('application/json') || !req.body || Array.isArray(req.body)) fail('JSON required');
    const data = await dispatch(req.body, String(req.headers.authorization || '').replace(/^Bearer /, ''));
    res.json({success: true, data});
  } catch (error) {
    res.status(error.status || 503).json({success: false, error: error.status ? error.message : 'ระบบทดสอบยังไม่พร้อมใช้งาน'});
  }
};
exports.bootstrap = async pin => { configuration(); return saveStaff({name: 'ผู้ดูแลทดสอบ', nickname: 'Admin ทดสอบ', pin, role: 'admin', status: 'active'}, null, true); };
