const $ = id => document.getElementById(id);
let me, staffRows = [], branches = [], work = {}, opener;
const roles = {admin:'เจ้าของร้าน / Admin',staff:'พนักงาน',driver:'คนขับ'};
function toast(text) { $('toast').textContent=text; $('toast').classList.add('show'); setTimeout(()=>$('toast').classList.remove('show'),2500); }
function modal(id) { opener=document.activeElement; $(id).hidden=false; $(id).classList.add('visible'); document.body.style.overflow='hidden'; $(id).querySelector('input:not([type=hidden])').focus(); }
function closeModal(id) { $(id).classList.remove('visible'); $(id).hidden=true; document.body.style.overflow=''; opener?.focus(); }
function fill(form, row) { form.reset(); for(const field of form.elements) if(field.name) field.value=row[field.name]??''; }
function line(list, name, detail, status, edit) {
  const item=document.createElement('div'); item.className='attendance-item';
  const avatar=document.createElement('div'); avatar.className='att-avatar'; avatar.textContent=name.slice(0,1);
  const info=document.createElement('div'); info.className='att-info';
  const title=document.createElement('div'); title.className='att-name'; title.textContent=name;
  const sub=document.createElement('div'); sub.className='att-branch'; sub.textContent=detail;
  const state=document.createElement('div'); state.className='status-label '+status; state.textContent=status==='active'?'ใช้งาน':'ปิดใช้งาน';
  const button=document.createElement('button'); button.className='add-advance-btn'; button.textContent='แก้ไข'; button.onclick=edit;
  info.append(title,sub,state); item.append(avatar,info,button); list.append(item);
}
function render() {
  $('staff-list').replaceChildren(); $('branch-list').replaceChildren();
  for(const row of staffRows) {
    const branch=branches.find(b=>b.branch_id===row.branch_id);
    line($('staff-list'),row.nickname||row.name,`${roles[row.role]} · ${branch?.name||'ยังไม่กำหนดสาขา'} · ฿${row.rate}/${row.pay_type==='hourly'?'ชม.':'วัน'} · OT ฿${row.ot_rate??work.ot_rate_per_hour}/ชม.`,row.status,()=>editStaff(row));
  }
  for(const row of branches) line($('branch-list'),row.name,row.lat==null?'ยังไม่กำหนดพิกัด':`${row.lat}, ${row.lng} · รัศมี ${row.allowed_radius_m} ม.`,row.status,()=>editBranch(row));
  if(!staffRows.length) $('staff-list').textContent='ยังไม่มีพนักงาน';
  if(!branches.length) { const empty=document.createElement('div');empty.className='advances-empty';empty.textContent='ยังไม่มีสาขา กด + เพิ่มสาขา';$('branch-list').append(empty); }
  $('work-summary').replaceChildren();
  for(const text of [`กะเช้า ${work.shift_morning_start}–${work.shift_morning_end}`,`กะดึก ${work.shift_night_start}–${work.shift_night_end}`,`วันอาทิตย์ 10:30–20:00`, `OT กลาง ฿${work.ot_rate_per_hour}/ชั่วโมง · ผ่อนผันสาย ${work.late_grace_min} นาที`]) {const p=document.createElement('p');p.className='note';p.textContent=text;$('work-summary').append(p);}
}
async function load() { [staffRows,branches,work]=await Promise.all([easyApi('listStaff'),easyApi('listBranches'),easyApi('getWorkSettings')]);render(); }
function rateLabel() { $('rate-label').textContent=$('pay-type').value==='hourly'?'ค่าแรง (บาท/ชั่วโมง)':'ค่าแรง (บาท/วัน)'; }
function editStaff(row={role:'staff',status:'active',staff_type:'fulltime',pay_type:'daily',shift:'morning',rate:0}) {
  $('staff-branch').replaceChildren(new Option('เลือกสาขา',''));
  for(const branch of branches.filter(b=>b.status==='active'||b.branch_id===row.branch_id)) $('staff-branch').add(new Option(branch.name+(branch.status==='inactive'?' (ปิดใช้งาน)':''),branch.branch_id));
  fill($('staff-form'),row); $('staff-pin').required=!row.staff_id;
  $('pin-help').textContent=row.staff_id?'เว้นว่างเพื่อใช้ PIN เดิม เปลี่ยน PIN แล้วต้องเข้าสู่ระบบใหม่':'กำหนด PIN ตัวเลข 4 หลักที่ไม่ซ้ำ';
  $('staff-title').textContent=row.staff_id?'👥 แก้ไขพนักงาน':'👥 เพิ่มพนักงาน';$('staff-error').textContent='';rateLabel();modal('staff-modal');
}
function editBranch(row={status:'active',allowed_radius_m:200}) {fill($('branch-form'),row);$('branch-title').textContent=row.branch_id?'📍 แก้ไขสาขา':'📍 เพิ่มสาขา';$('branch-error').textContent='';modal('branch-modal');}
for(const button of document.querySelectorAll('[data-section]')) button.onclick=()=>{ for(const section of ['staff','branches','work','central','quantities','notifications']) $(section+'-section').hidden=section!==button.dataset.section; for(const other of document.querySelectorAll('[data-section]')) other.setAttribute('aria-current',String(other===button)); if(['central','quantities','notifications'].includes(button.dataset.section))loadShopSection(button.dataset.section).catch(e=>toast(e.message)); };
for(const button of document.querySelectorAll('[data-close]')) button.onclick=()=>closeModal(button.dataset.close);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const visible=document.querySelector('.modal-overlay.visible');if(visible && !visible.querySelector('[type=submit]').disabled)closeModal(visible.id);}});
$('add-staff').onclick=()=>editStaff();$('add-branch').onclick=()=>editBranch();$('pay-type').onchange=rateLabel;
$('edit-work').onclick=()=>{fill($('work-form'),work);$('work-error').textContent='';modal('work-modal');};
for(const [kind,action] of [['staff','saveStaff'],['branch','saveBranch'],['work','saveWorkSettings']]) $(kind+'-form').onsubmit=async event=>{
  event.preventDefault();const form=event.target,values=Object.fromEntries(new FormData(form)),buttons=form.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);$(kind+'-error').textContent='';
  try { await easyApi(action,values);closeModal(kind+'-modal');
    if(kind==='staff'&&values.staff_id===me.staff_id&&values.pin){sessionStorage.removeItem('easy_firebase_token');location.href='/index.html';return;}
    await load(); if(kind==='staff'&&values.staff_id===me.staff_id) {me=await easyApi('me');$('greeting').textContent=`สวัสดี คุณ${me.nickname||me.name} 👋`;}
    toast('บันทึกเรียบร้อย');
  } catch(error) {$(kind+'-error').textContent=error.message;toast(error.message);}finally{buttons.forEach(b=>b.disabled=false);}
};
$('logout').onclick=async()=>{try{await easyApi('logout');sessionStorage.removeItem('easy_firebase_token');location.href='/index.html';}catch(error){toast(error.message);}};
(async()=>{$('loading').classList.add('show');try{me=await easyApi('me');if(me.role!=='admin'){location.replace(me.role==='driver'?'/driver.html':'/clock.html');return;} $('greeting').textContent=`สวัสดี คุณ${me.nickname||me.name} 👋`;$('header-date').textContent=new Date().toLocaleDateString('th-TH',{weekday:'long',day:'numeric',month:'long',year:'numeric'});await load();$('admin-body').hidden=false;}catch(error){$('page-error').textContent=error.message+' ';const link=document.createElement('a');link.href='/index.html';link.textContent='เข้าสู่ระบบ';$('page-error').append(link);}finally{$('loading').classList.remove('show');}})();

const notificationFields=[['telegram_token','Telegram Bot Token','password'],['telegram_bot_token','Telegram Bot Token (ชื่อ key สำรองเดิม มีลำดับก่อน telegram_token)','password'],['telegram_chat_id','Telegram ห้องสำรอง','text'],['telegram_chat_clock','Telegram ลงเวลา / มาสาย','text'],['telegram_chat_payroll','Telegram เงินเบิก / เงินเดือน','text'],['telegram_chat_stock_open','Telegram Stock เปิดร้าน','text'],['telegram_chat_stock_close','Telegram Stock ปิดร้าน','text'],['telegram_chat_driver','Telegram Driver','text'],['line_bot_token','LINE Bot Token','password'],['line_group_central','LINE กลุ่มครัวกลาง','text']];
async function loadShopSection(section){
  const box=$(section+'-list');box.textContent='กำลังโหลด...';
  if(section==='central'){
    const rows=(await easyApi('getCentralTargets')).data;box.replaceChildren();
    for(const r of rows){line(box,r.item_name,'เป้าหมาย '+r.target_qty+' '+r.reporting_unit+' · '+(r.trigger_type==='zero'?'ผลิตเมื่อหมด':'ผลิตส่วนที่ขาด'),'active',()=>{fill($('central-form'),r);$('central-info').textContent=r.item_name+' · '+r.conversion_ratio+' '+r.reporting_unit+' ต่อ '+r.production_unit;modal('central-modal');});}
  }else if(section==='quantities'){
    const items=(await easyApi('getDriverOrderQuantities')).data;box.replaceChildren();
    for(const [name,value] of Object.entries(items))line(box,name,value,'active',()=>{const m=value.match(/^(\S+)\s+(.+)$/);fill($('quantity-form'),{item_name:name,qty:m?.[1]||'',unit:m?.[2]||''});$('quantity-info').textContent=name;modal('quantity-modal');});
  }else{
    const config=(await easyApi('getNotificationSettings')).data;box.replaceChildren();const form=document.createElement('form');form.id='notifications-form';
    const note=document.createElement('p');note.className='note';note.textContent='Token เก็บฝั่ง backend เท่านั้น เว้นว่างเพื่อใช้ค่าเดิม ทุกข้อความจาก staging มีป้ายทดสอบ';form.append(note);
    for(const [key,label,type] of notificationFields){const lab=document.createElement('label');lab.className='form-label';lab.htmlFor='notify-'+key;lab.textContent=label;const input=document.createElement('input');input.id=lab.htmlFor;input.name=key;input.type=type;input.className='form-input';input.autocomplete='off';input.value=type==='password'?'':config[key]||'';if(type==='password')input.placeholder=config[key+'_set']?'ตั้งค่าแล้ว · เว้นว่างเพื่อคงเดิม':'ยังไม่ได้ตั้งค่า';form.append(lab,input);if(type==='password'){const clear=document.createElement('input');clear.type='checkbox';clear.name='clear_'+key;const clearLabel=document.createElement('label');clearLabel.className='note';clearLabel.append(clear,document.createTextNode(' ลบ token นี้'));form.append(clearLabel);}}
    const save=document.createElement('button');save.className='modal-btn primary';save.textContent='บันทึก';form.append(save);form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await easyApi('saveNotificationSettings',Object.fromEntries(new FormData(form)));form.reset();await loadShopSection('notifications');toast('บันทึกเรียบร้อย');}catch(e){toast(e.message);}finally{save.disabled=false;}};box.append(form);
  }
}
for(const [kind,action,section] of [['central','updateCentralTarget','central'],['quantity','updateDriverOrderQuantity','quantities']])$(kind+'-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button:not([type=button])');button.disabled=true;try{await easyApi(action,Object.fromEntries(new FormData(e.target)));closeModal(kind+'-modal');await loadShopSection(section);toast('บันทึกเรียบร้อย');}catch(e){toast(e.message);}finally{button.disabled=false;}};
