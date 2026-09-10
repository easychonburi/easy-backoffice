const $=id=>document.getElementById(id);
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let staff=[],branches=[],shifts=[],settings={},rows=[],cursor=null,editor=null,loadedQuery=null;
const roleLabels={admin:'ผู้ดูแลระบบ',staff:'พนักงาน',driver:'คนขับ'};
const statusLabel=s=>`<span class="badge ${s==='active'?'':'inactive'}">${s==='active'?'ใช้งาน':'ปิดใช้งาน'}</span>`;
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
async function api(action,body=null){const r=await fetch(body?'/api':'/api?'+new URLSearchParams({action}),body?{method:'POST',body:JSON.stringify({action,...body})}:{});const data=await r.json();if(!data.success)throw Error(data.message||'ทำรายการไม่สำเร็จ');return data;}
async function busy(button,work){if(button.disabled)return;const label=button.textContent;button.disabled=true;button.textContent='กำลังบันทึก…';try{await work();}finally{button.disabled=false;button.textContent=label;}}
function input(name,label,value='',type='text',attrs=''){return `<label>${label}<input name="${name}" type="${type}" value="${escapeHTML(value)}" ${attrs}></label>`;}
function select(name,label,options,value){return `<label>${label}<select name="${name}">${options.map(([v,t])=>`<option value="${escapeHTML(v)}" ${String(value)===String(v)?'selected':''}>${escapeHTML(t)}</option>`).join('')}</select></label>`;}
const stateOptions=[['active','ใช้งาน'],['inactive','ปิดใช้งาน']];
async function refresh(){
 notice('กำลังโหลดข้อมูล…');
 const out=await Promise.all([api('getAdminStaff'),api('getAdminBranches'),api('getShifts'),api('getSettings')]);
 [staff,branches,shifts,settings]=out.map(r=>r.data);renderStaff();renderSettings();notice('');
}
function renderStaff(){
 const term=$('staff-search').value.toLowerCase(),status=$('staff-status').value;
 const visible=staff.filter(s=>(status==='all'||s.status===status)&&[s.name,s.nickname,s.staff_id].join(' ').toLowerCase().includes(term));
 $('staff-list').innerHTML=visible.length?`<table><thead><tr><th>พนักงาน</th><th>สาขา / กะ</th><th>ค่าแรง</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${visible.map(s=>`<tr><td>${escapeHTML(s.nickname||s.name)}<small>${escapeHTML(s.name)} · ${escapeHTML(s.staff_id)} · ${escapeHTML(roleLabels[s.role]||s.role)}</small></td><td>${escapeHTML(branches.find(b=>b.branch_id===s.branch_id)?.name||s.branch_id)}<small>${escapeHTML(shifts.find(g=>g.shift_id===s.shift_id)?.name||(s.custom_shift_start?s.custom_shift_start+'–'+s.custom_shift_end:s.shift==='night'?'กะดึกกลาง':'กะเช้ากลาง'))}</small></td><td>฿${Number(s.rate||0).toLocaleString('th-TH')} / ${s.pay_type==='hourly'?'ชั่วโมง':'วัน'}<small>OT ฿${Number(s.ot_rate||0)} / ชั่วโมง</small></td><td>${statusLabel(s.status)}</td><td><button class="secondary" data-edit-staff="${escapeHTML(s.staff_id)}">แก้ไข</button> <button class="secondary" data-pin="${escapeHTML(s.staff_id)}">ตั้ง PIN</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">ไม่พบพนักงานตามเงื่อนไข</div>';
}
const settingFields=[['shift_morning_start','เริ่มกะเช้ากลาง','time'],['shift_morning_end','จบกะเช้ากลาง','time'],['shift_night_start','เริ่มกะดึกกลาง','time'],['shift_night_end','จบกะดึกกลาง','time'],['late_grace_min','เกณฑ์มาสาย (นาที)','number'],['ot_grace_min','เกณฑ์ OT (นาที)','number'],['ot_rate_per_hour','ค่า OT กลาง (บาท/ชั่วโมง)','number']];
function renderSettings(){
 $('setting-fields').innerHTML=settingFields.map(([k,label,type])=>input(k,label,settings[k]??'',type,'required min="0" max="1440"')).join('');
 $('shift-list').innerHTML=shifts.length?shifts.map(s=>`<div class="card"><h3>${escapeHTML(s.name)}</h3><p>${escapeHTML(s.start)}–${escapeHTML(s.end)} ${s.end<s.start?'· ข้ามวัน':''}</p>${statusLabel(s.status)} <button class="secondary" data-edit-shift="${escapeHTML(s.shift_id)}">แก้ไข</button></div>`).join(''):'<p>ยังไม่มีกะเฉพาะ พนักงานใช้เวลารายคนหรือกะกลางตามเดิม</p>';
 $('branch-list').innerHTML=branches.map(b=>`<div class="card"><h3>${escapeHTML(b.name)}</h3><p>รัศมี ${escapeHTML(b.allowed_radius_m)} เมตร · ${Number.isFinite(Number(b.lat))&&b.lat!==''?'มีพิกัดแล้ว':'ยังไม่มีพิกัด'}</p>${statusLabel(b.status)} <button class="secondary" data-edit-branch="${escapeHTML(b.branch_id)}">แก้ไข</button></div>`).join('');
}
function openEditor(kind,item={}){
 editor={kind,item};$('editor-error').textContent='';let fields='';
 if(kind==='staff'){
  $('editor-title').textContent=item.staff_id?'แก้ไขพนักงาน':'เพิ่มพนักงาน';
  fields=input('name','ชื่อ',item.name,'text','required maxlength="120"')+input('nickname','ชื่อเล่น',item.nickname,'text','maxlength="80"')+
   select('role','สิทธิ์',Object.entries(roleLabels),item.role||'staff')+select('branch_id','สาขา',branches.filter(b=>b.status==='active'||b.branch_id===item.branch_id).map(b=>[b.branch_id,b.name]),item.branch_id)+
   select('shift_id','กะเฉพาะ',[['','ใช้เวลารายคน / กะกลาง'],...shifts.filter(g=>g.status==='active'||g.shift_id===item.shift_id).map(g=>[g.shift_id,g.name+' '+g.start+'–'+g.end])],item.shift_id||'')+
   select('shift','กะกลาง', [['morning','กะเช้า'],['night','กะดึก']],item.shift||'morning')+
   select('staff_type','ประเภท',[['fulltime','ประจำ'],['parttime','Part-time']],item.staff_type||'fulltime')+
   select('pay_type','คิดค่าแรง',[['daily','รายวัน'],['hourly','รายชั่วโมง']],item.pay_type||'daily')+
   input('rate','ค่าแรง (บาท)',item.rate??0,'number','required min="0" step="0.01"')+input('ot_rate','OT ต่อชั่วโมง (บาท)',item.ot_rate??50,'number','required min="0" step="0.01"')+
   input('custom_shift_start','เวลาเริ่มเฉพาะคน (ถ้ามี)',item.custom_shift_start,'time')+input('custom_shift_end','เวลาเลิกเฉพาะคน (ถ้ามี)',item.custom_shift_end,'time')+
   input('bank_name','ธนาคาร',item.bank_name)+input('bank_account','เลขบัญชี',item.bank_account,'text','inputmode="numeric"')+
   select('status','สถานะ',stateOptions,item.status||'active')+'<p class="wide hint">หลังกดเพิ่มพนักงาน ใช้ปุ่ม “ตั้ง PIN” เพื่อเปิดให้เข้าสู่ระบบ รหัสเก่าจะไม่แสดงบนหน้าเว็บ</p>';
 }else if(kind==='shift'){
  $('editor-title').textContent=item.shift_id?'แก้ไขกะงาน':'เพิ่มกะงาน';fields=input('name','ชื่อกะ',item.name,'text','required maxlength="100"')+select('status','สถานะ',stateOptions,item.status||'active')+input('start','เวลาเริ่มงาน',item.start||'09:00','time','required')+input('end','เวลาเลิกงาน',item.end||'17:00','time','required')+'<p class="wide hint">กะที่เลิกก่อนเวลาเริ่มถือเป็นกะข้ามวัน กฎหักสายและ OT ใช้ค่าของร้านและพนักงานตามเดิม</p>';
 }else if(kind==='branch'){
  $('editor-title').textContent=item.branch_id?'แก้ไขสาขา':'เพิ่มสาขา';fields=input('name','ชื่อสาขา',item.name,'text','required maxlength="100"')+input('short_name','ชื่อย่อ',item.short_name)+input('address','ที่อยู่',item.address)+select('status','สถานะ',stateOptions,item.status||'active')+input('lat','ละติจูด',item.lat??'','number','required min="-90" max="90" step="any"')+input('lng','ลองจิจูด',item.lng??'','number','required min="-180" max="180" step="any"')+input('allowed_radius_m','รัศมีที่ลงเวลาได้ (เมตร)',item.allowed_radius_m??100,'number','required min="1" max="5000"')+'<button id="use-gps" type="button" class="secondary">ใช้ตำแหน่งปัจจุบัน</button><p class="wide hint">ใช้ตำแหน่งปัจจุบันเมื่ออยู่ที่สาขา แล้วตรวจพิกัดก่อนบันทึก</p>';
 }else{
  $('editor-title').textContent='ตั้ง PIN — '+(item.nickname||item.name);fields=input('pin','PIN ใหม่ 4 หลัก','','password','required pattern="[0-9]{4}" inputmode="numeric" maxlength="4" autocomplete="new-password"')+input('confirm_pin','กรอก PIN อีกครั้ง','','password','required pattern="[0-9]{4}" inputmode="numeric" maxlength="4" autocomplete="new-password"')+'<p class="wide hint">หลังเปลี่ยน PIN พนักงานต้องเข้าสู่ระบบใหม่</p>';
 }
 $('editor-fields').innerHTML=fields;$('editor').showModal();
 if(kind==='branch')$('use-gps').onclick=async()=>{await busy($('use-gps'),async()=>{try{const p=await window.easyPosition();$('editor-form').elements.lat.value=p.lat;$('editor-form').elements.lng.value=p.lng;}catch{$('editor-error').textContent='อ่านตำแหน่งไม่ได้ กรุณาเปิดสิทธิ์ตำแหน่งหรือกรอกพิกัดเอง';}});};
}
$('editor-form').onsubmit=async event=>{
 event.preventDefault();const button=event.submitter;await busy(button,async()=>{
  try{const data=Object.fromEntries(new FormData(event.target)),{kind,item}=editor;let result;
   if(kind==='pin'){if(data.pin!==data.confirm_pin)throw Error('PIN ทั้งสองช่องไม่ตรงกัน');result=await api('setStaffPin',{staff_id:item.staff_id,pin:data.pin});}
   else if(kind==='staff'){result=await api(item.staff_id?'updateStaff':'addStaff',{...data,...(item.staff_id?{staff_id:item.staff_id,expected_version:item.version||0}:{})});}
   else{const field=kind==='shift'?'shift_id':'branch_id';result=await api(kind==='shift'?'saveShift':'saveBranch',{...data,...(item[field]?{[field]:item[field],expected_version:item.version||0}:{})});}
   $('editor').close();await refresh();notice(kind==='pin'?'ตั้ง PIN แล้ว พนักงานต้องเข้าสู่ระบบใหม่':kind==='staff'&&!item.staff_id?'เพิ่มพนักงานแล้ว รหัส '+result.staff_id+' — กดตั้ง PIN เพื่อเริ่มใช้งาน':'บันทึกเรียบร้อยแล้ว');
  }catch(e){$('editor-error').textContent=e.message;}
 });
};
$('settings-form').onsubmit=async event=>{event.preventDefault();await busy(event.submitter,async()=>{try{const values=Object.fromEntries(new FormData(event.target));for(const [k,,type] of settingFields)if(type==='number')values[k]=Number(values[k]);const expected=Object.fromEntries(Object.keys(values).filter(k=>Object.hasOwn(settings,k)).map(k=>[k,settings[k]]));await api('saveSettings',{values,expected});await refresh();notice('บันทึกการตั้งค่าเรียบร้อยแล้ว');}catch(e){notice(e.message,true);}});};
const labels={staff_id:'รหัสพนักงาน',staff_name:'พนักงาน',date:'วันที่',clock_in:'เวลาเข้า',clock_out:'เวลาออก',hours_worked:'ชั่วโมงทำงาน',late_min:'สาย (นาที)',ot_status:'สถานะ OT',branch_name:'สาขา',branch_id:'รหัสสาขา',status:'สถานะ',amount:'จำนวนเงิน',period_start:'เริ่มรอบ',period_end:'สิ้นสุดรอบ',total_pay:'ยอดสุทธิ',leave_type:'ประเภทลา',note:'หมายเหตุ',mode:'รอบ',checked_at:'เวลาเช็ก',created_at:'เวลาบันทึก',action:'การทำรายการ',uid:'ผู้ทำรายการ',items_json:'รายการ',orders_json:'รายการสั่งเพิ่ม',records:'รายการที่เปลี่ยน'};
const columns={timesheets:['date','staff_id','clock_in','clock_out','hours_worked','late_min','ot_status'],leaves:['date','staff_id','leave_type','note'],advances:['date','staff_id','amount','status','period_start','period_end'],payroll_runs:['staff_id','period_start','period_end','total_pay','status'],stock_logs:['checked_at','branch_name','branch_id','mode','items_json','orders_json'],driver_jobs:['date','status','items_json'],audit_log:['created_at','uid','action','records']};
function renderData(){const term=$('data-search').value.toLowerCase(),visible=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(term));const cols=columns[loadedQuery?.collection||$('data-category').value];$('data-count').textContent=`แสดง ${visible.length} จาก ${rows.length} รายการที่โหลดแล้ว`;const display=v=>typeof v==='object'?JSON.stringify(v):String(v??'');$('data-list').innerHTML=visible.length?`<table><thead><tr>${cols.map(k=>`<th>${labels[k]||k}</th>`).join('')}</tr></thead><tbody>${visible.map(r=>`<tr>${cols.map(k=>`<td>${escapeHTML(k==='staff_id'?(staff.find(s=>s.staff_id===r[k])?.nickname||r[k]):display(r[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty">ไม่พบข้อมูลตามเงื่อนไข</div>';$('load-more').hidden=!cursor;}
async function loadData(more=false){
 const button=more?$('load-more'):$('data-filter').querySelector('button');
 await busy(button,async()=>{try{notice('กำลังโหลดข้อมูล…');const query=more?{...loadedQuery,cursor}:{collection:$('data-category').value,date_from:$('data-from').value,date_to:$('data-to').value};if(query.date_from>query.date_to)throw Error('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');const response=await fetch('/api?'+new URLSearchParams({action:'getAdminData',...query}));const result=await response.json();if(!result.success)throw Error(result.message);rows=more?rows.concat(result.data):result.data;cursor=result.next_cursor;if(!more)loadedQuery=query;renderData();notice('');}catch(e){notice(e.message,true);}});
}
function route(){const tab=location.hash.slice(1)||'staff';for(const id of ['staff','settings','data'])$(id+'-panel').hidden=id!==tab;window.dispatchEvent(new Event('easy-nav-refresh'));}
document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.dataset.editStaff)openEditor('staff',staff.find(s=>s.staff_id===b.dataset.editStaff));if(b.dataset.pin)openEditor('pin',staff.find(s=>s.staff_id===b.dataset.pin));if(b.dataset.editShift)openEditor('shift',shifts.find(s=>s.shift_id===b.dataset.editShift));if(b.dataset.editBranch)openEditor('branch',branches.find(s=>s.branch_id===b.dataset.editBranch));});
$('add-staff').onclick=()=>openEditor('staff');$('add-shift').onclick=()=>openEditor('shift');$('add-branch').onclick=()=>openEditor('branch');
$('staff-search').oninput=renderStaff;$('staff-status').onchange=renderStaff;$('data-search').oninput=renderData;
$('close-editor').onclick=$('cancel-editor').onclick=()=> $('editor').close();$('logout').onclick=window.easyLogout;
$('refresh-staff').onclick=()=>refresh().catch(e=>notice(e.message,true));$('data-filter').onsubmit=e=>{e.preventDefault();loadData();};$('load-more').onclick=()=>loadData(true);
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});$('data-to').value=today;$('data-from').value=today.slice(0,8)+'01';
window.addEventListener('hashchange',route);route();refresh().catch(e=>notice(e.message,true));
