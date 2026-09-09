const {scryptSync,randomBytes,timingSafeEqual}=require('node:crypto');
const {hash}=require('./store.cjs');
const {safeStaff}=require('./domain.cjs');
function hashPin(pin){const salt=randomBytes(16).toString('hex');return {salt,hash:scryptSync(String(pin),salt,64).toString('hex')};}
async function login(db,auth,staffId,pin,ip,now=new Date()){
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(staffId||'')||!/^\d{4}$/.test(pin||''))throw Error('รหัสพนักงานหรือ PIN ไม่ถูกต้อง');
  // Reserve attempts transactionally before checking a PIN, including concurrent attempts.
  const allowed=await db.runTransaction(async tx=>{
    const refs=['staff:'+staffId,'ip:'+ip].map(k=>db.collection('login_limits').doc(hash(k)));
    const snapshots=await Promise.all(refs.map(r=>tx.get(r)));
    const values=snapshots.map(s=>s.exists&&s.data().until>+now?s.data():{attempts:0,until:+now+15*60000});
    if(values.some((v,i)=>v.attempts>=(i===0?5:30)))return false;
    refs.forEach((r,i)=>tx.set(r,{attempts:values[i].attempts+1,until:values[i].until}));return true;
  });
  if(!allowed)throw Error('ลองเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาที');
  const [account,secret]=await Promise.all([db.collection('staff').doc(staffId).get(),db.collection('credentials').doc(staffId).get()]);
  const saved=secret.exists?secret.data():{salt:'00000000000000000000000000000000',hash:'00'.repeat(64)};
  const actual=scryptSync(pin,saved.salt,64),expected=Buffer.from(saved.hash,'hex');
  if(!account.exists||account.data().status!=='active'||expected.length!==64||!timingSafeEqual(actual,expected))throw Error('รหัสพนักงานหรือ PIN ไม่ถูกต้อง');
  const customToken=await auth.createCustomToken(staffId,{auth_version:Number(account.data().auth_version||0)});
  return {success:true,data:safeStaff(account.data()),customToken};
}
module.exports={hashPin,login};
module.exports.setPin=async function(db,uid,staffId,pin,requestId){
 if(!/^[A-Za-z0-9_-]{1,150}$/.test(staffId||'')||!/^\d{4}$/.test(pin||'')||! /^[a-f0-9-]{36}$/i.test(requestId||''))throw Error('Invalid PIN request');
 const secret=hashPin(pin),ref=db.collection('requests').doc(hash(uid+':'+requestId));
 return db.runTransaction(async tx=>{
  const actor=await tx.get(db.doc('staff/'+uid)),target=await tx.get(db.doc('staff/'+staffId)),prior=await tx.get(ref);
  if(!actor.exists||actor.data().role!=='admin'||actor.data().status!=='active')throw Error('FORBIDDEN');
  if(prior.exists){if(prior.data().action!=='setStaffPin'||prior.data().staff_id!==staffId)throw Error('Request ID reused');return {success:true};}
  if(!target.exists)throw Error('ไม่พบพนักงาน');
  tx.set(db.doc('credentials/'+staffId),secret);
  tx.update(target.ref,{auth_version:Number(target.data().auth_version||0)+1});
  tx.set(ref,{action:'setStaffPin',staff_id:staffId,result:{success:true}});
  tx.set(db.collection('audit_log').doc(hash(uid+':'+requestId)),{uid,action:'setStaffPin',staff_id:staffId,created_at:new Date().toISOString()});
  return {success:true};
 });
};
