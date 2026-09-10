'use strict';
const {getFirestore}=require('firebase-admin/firestore');
const ref=()=>getFirestore().collection('settings').doc('notifications');
const chats=['telegram_chat_id','telegram_chat_clock','telegram_chat_payroll','telegram_chat_stock_open','telegram_chat_stock_close','telegram_chat_driver','line_group_central'];
const tokens=['telegram_token','telegram_bot_token','line_bot_token'];
const prefix='[ทดสอบ EASY staging — ไม่ใช่งานจริง]\n';
const fail=message=>{throw Object.assign(Error(message),{status:400});};
async function config(){return (await ref().get()).data()||{};}
exports.read=async()=>{const c=await config();return {...Object.fromEntries(chats.map(k=>[k,c[k]||''])),...Object.fromEntries(tokens.map(k=>[k+'_set',Boolean(c[k])]))};};
exports.save=async body=>{
  const patch={};
  for(const k of chats)if(k in body){const v=String(body[k]).trim();if(v.length>150)fail('Chat/Group ID ยาวเกินไป');patch[k]=v;}
  for(const k of tokens)if(body[k]){const v=String(body[k]).trim();if(v.length>2048||/\s/.test(v))fail('Token ไม่ถูกต้อง');patch[k]=v;}
  // Empty password fields preserve stored secrets; clearing is explicit.
  for(const k of tokens)if(body['clear_'+k]===true||body['clear_'+k]==='on')patch[k]='';
  await ref().set(patch,{merge:true});return exports.read();
};
async function telegramRequest(c,method,body,multipart=false){
  const token=c.telegram_bot_token||c.telegram_token;
  if(!token)fail('ยังไม่ได้ตั้ง Telegram Bot Token');
  let response;
  try{response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',...(multipart?{}:{headers:{'Content-Type':'application/json'}}),body:multipart?body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch{fail('เชื่อมต่อ Telegram ไม่สำเร็จ');}
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)fail(`Telegram ส่งไม่สำเร็จ (HTTP ${response.status}) ตรวจ token และสิทธิ์ในห้อง`);
}
exports.telegram=async(message,chatKey)=>{
  const c=await config(),chat_id=c[chatKey]||c.telegram_chat_id;if(!chat_id)fail('ยังไม่ได้ตั้ง '+chatKey);
  // Plain text avoids markup failures on shop item names; split long stock lists.
  const text=prefix+message;
  for(let i=0;i<text.length;i+=3500)await telegramRequest(c,'sendMessage',{chat_id,text:text.slice(i,i+3500)});
};
exports.line=async message=>{
  const c=await config();if(!c.line_bot_token||!c.line_group_central)fail('ยังไม่ได้ตั้ง LINE Bot Token/Group ID');
  const text=prefix+message,messages=[];for(let i=0;i<text.length;i+=4500)messages.push({type:'text',text:text.slice(i,i+4500)});
  for(let i=0;i<messages.length;i+=5){let r;try{r=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.line_bot_token},body:JSON.stringify({to:c.line_group_central,messages:messages.slice(i,i+5)}),signal:AbortSignal.timeout(15000)});}catch{fail('เชื่อมต่อ LINE ไม่สำเร็จ');}if(!r.ok)fail(`LINE ส่งไม่สำเร็จ (HTTP ${r.status}) ตรวจ token และสิทธิ์ในกลุ่ม`);}
};
exports.photo=async(body,user)=>{
  const raw=body.imageBase64;if(typeof raw!=='string'||raw.length>7000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))fail('รูปภาพไม่ถูกต้องหรือใหญ่เกินไป');
  const bytes=Buffer.from(raw,'base64');if(bytes[0]!==255||bytes[1]!==216)fail('กรุณาส่งภาพ JPEG');
  const branch=String(body.branch||'').trim();if(!branch||branch.length>150)fail('กรุณาระบุสาขาปลายทาง');
  const c=await config(),chat=c.telegram_chat_driver||c.telegram_chat_id;if(!chat)fail('ยังไม่ได้ตั้ง telegram_chat_driver');
  const form=new FormData();form.set('chat_id',chat);form.set('caption',prefix+`🚚 ขนส่งถึงสาขาแล้ว!\n📍 ปลายทาง: ${branch}\n👤 คนขับ: ${user.nickname||user.name}`);form.set('photo',new Blob([bytes],{type:'image/jpeg'}),'delivery.jpg');
  // Memory -> Telegram only. No file, Firestore or Storage write.
  await telegramRequest(c,'sendPhoto',form,true);return {success:true};
};
// A notification failure must never turn a successful business write into a retry.
exports.after=async send=>{try{await send();return {};}catch(e){return {notification_warning:'บันทึกข้อมูลแล้ว แต่แจ้งเตือนไม่สำเร็จ: '+(e.status?e.message:'กรุณาตรวจการตั้งค่า')};}};
