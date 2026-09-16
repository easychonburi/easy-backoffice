'use strict';
const {getFirestore}=require('firebase-admin/firestore');
const kinds=['id_card','house_registration'];
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const text=(value,max,label)=>{if(typeof value!=='string'||value.trim().length>max)fail(label+'ไม่ถูกต้อง');return value.trim();};
exports.actions=new Set(['getEmployeeProfile','saveEmployeeProfile','getEmployeeDocument','saveEmployeeDocument']);
exports.handle=async(body,user)=>{
  const write=body.action.startsWith('save'),id=body.staff_id||user.staff_id;
  if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(id))fail('รหัสพนักงานไม่ถูกต้อง');
  if(id!==user.staff_id&&(write||user.role!=='admin'))fail('เข้าถึงได้เฉพาะข้อมูลของตัวเอง',403);
  const db=getFirestore(),staffRef=db.collection('staff').doc(id),profileRef=db.collection('employee_profiles').doc(id);
  if(body.action==='getEmployeeProfile'){
    const [s,p]=await Promise.all([staffRef.get(),profileRef.get()]);if(!s.exists)fail('ไม่พบพนักงาน',404);
    const staff=s.data(),profile=p.data()||{};
    return {staff_id:id,name:staff.name||'',nickname:staff.nickname||'',age:profile.age??'',birthday:profile.birthday||'',bank_name:staff.bank_name||'',address:profile.address||'',bank_account:staff.bank_account||'',documents:profile.documents||{}};
  }
  if(body.action==='saveEmployeeProfile'){
    const name=text(body.name,80,'ชื่อ / นามสกุล'),nickname=text(body.nickname,80,'ชื่อเล่น'),address=text(body.address,1000,'ที่อยู่'),bank_account=text(body.bank_account,40,'เลขบัญชี');
    const bank_name=body.bank_name===undefined?undefined:text(body.bank_name,80,'ธนาคาร');
    if(bank_account&&bank_name==='')fail('กรุณากรอกชื่อธนาคาร');
    const birthday=body.birthday===undefined?undefined:text(body.birthday,10,'วันเกิด');
    if(birthday){const parsed=new Date(birthday+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(birthday)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==birthday||birthday>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}))fail('วันเกิดไม่ถูกต้อง');}
    if(!name)fail('กรุณากรอกชื่อ / นามสกุล');
    const age=body.age===''?null:Number(body.age);
    if(age!==null&&(!/^\d{1,3}$/.test(String(body.age))||!Number.isInteger(age)||age<1||age>120))fail('อายุไม่ถูกต้อง');
    if(bank_account&&!/^[0-9 -]{5,40}$/.test(bank_account))fail('กรุณากรอกเลขบัญชีธนาคารให้ถูกต้อง');
    await db.runTransaction(async tx=>{const s=await tx.get(staffRef);if(!s.exists)fail('ไม่พบพนักงาน',404);tx.update(staffRef,{name,nickname,bank_account,...(bank_name!==undefined?{bank_name}:{})});tx.set(profileRef,{age,address,...(birthday!==undefined?{birthday}:{}),updated_at:new Date().toISOString()},{merge:true});});
    return {success:true};
  }
  if(!kinds.includes(body.kind))fail('ประเภทเอกสารไม่ถูกต้อง');
  const ref=db.collection('employee_documents').doc(id+'_'+body.kind);
  if(body.action==='getEmployeeDocument'){
    const doc=await ref.get();if(!doc.exists)fail('ยังไม่มีรูปเอกสาร',404);
    return {image:doc.data().image};
  }
  // Private JPEGs only, bounded below Firestore's document limit. No public URLs.
  if(typeof body.image!=='string'||body.image.length>700000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(body.image))fail('รูปไม่ถูกต้องหรือใหญ่เกินไป กรุณาเลือกรูปใหม่');
  const bytes=Buffer.from(body.image.split(',')[1],'base64');
  if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)fail('ไฟล์รูปไม่ถูกต้อง');
  await db.runTransaction(async tx=>{const s=await tx.get(staffRef);if(!s.exists)fail('ไม่พบพนักงาน',404);tx.set(ref,{staff_id:id,kind:body.kind,image:body.image,updated_at:new Date().toISOString()});tx.set(profileRef,{documents:{[body.kind]:true}},{merge:true});});
  return {success:true};
};
