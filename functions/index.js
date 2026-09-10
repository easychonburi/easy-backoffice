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
const safe = row => ({staff_id: row.staff_id, name: row.name, nickname: row.nickname, role: row.role, status: row.status});
function fail(message, status = 400) { const error = Error(message); error.status = status; throw error; }
function validate(body) {
  if (typeof body.pin !== 'string' || !/^\d{4}$/.test(body.pin)) fail('กรอก PIN ตัวเลข 4 หลัก');
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) fail('กรอกชื่อไม่เกิน 80 ตัวอักษร');
  if (body.nickname != null && (typeof body.nickname !== 'string' || body.nickname.length > 80)) fail('ชื่อเล่นไม่ถูกต้อง');
  if (!['admin', 'staff', 'driver'].includes(body.role) || !['active', 'inactive'].includes(body.status)) fail('บทบาทหรือสถานะไม่ถูกต้อง');
  if (body.staff_id && !/^[a-zA-Z0-9_-]{1,80}$/.test(body.staff_id)) fail('รหัสรายการไม่ถูกต้อง');
}
async function saveStaff(body, actor, first = false) {
  validate(body);
  const ref = body.staff_id ? db.collection('staff').doc(body.staff_id) : db.collection('staff').doc();
  if (!first && actor.staff_id === ref.id) fail('รอบ foundation ยังไม่ให้แก้บัญชีที่กำลังใช้งาน');
  const pinRef = db.collection('pin_index').doc(lookup(body.pin));
  const salt = crypto.randomBytes(16).toString('hex');
  const row = {staff_id: ref.id, name: body.name.trim(), nickname: body.nickname || '', role: body.role, status: body.status,
    pin_lookup: pinRef.id, pin_salt: salt, pin_hash: crypto.scryptSync(body.pin, salt, 32).toString('hex'), version: crypto.randomUUID()};
  await db.runTransaction(async tx => {
    const [old, existing, initial] = await Promise.all([tx.get(ref), tx.get(pinRef), first ? tx.get(db.collection('staff').limit(1)) : Promise.resolve(null)]);
    if (first && !initial.empty) fail('มีพนักงานแล้ว ไม่สามารถ bootstrap ซ้ำ');
    if (body.staff_id && !old.exists) fail('ไม่พบพนักงาน', 404);
    if (existing.exists && existing.data().staff_id !== ref.id) fail('PIN นี้ถูกใช้แล้ว');
    if (old.exists && old.data().pin_lookup !== pinRef.id) tx.delete(db.collection('pin_index').doc(old.data().pin_lookup));
    tx.set(pinRef, {staff_id: ref.id}); tx.set(ref, row);
  });
  return safe(row);
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
