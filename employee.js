(() => {
  const el=id=>document.getElementById(id),money=n=>Number(n||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})+' บาท';
  const date=v=>new Date(v+'T12:00:00').toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'});
  const states={pending:'รออนุมัติ',approved:'อนุมัติแล้ว',rejected:'ไม่อนุมัติ'};
  let opener,version=0;
  function node(tag,text,cls=''){const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;}
  function close(){version++;el('employee-modal').hidden=true;el('employee-modal').classList.remove('visible');document.body.style.overflow='';opener?.focus();}
  el('employee-close').onclick=close;
  el('employee-modal').onclick=e=>{if(e.target===el('employee-modal'))close();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!el('employee-modal').hidden)close();});
  function history(data,type,box){box.append(node('h3','คำขอของฉัน','employee-section-title'));const requests=data.requests.filter(r=>r.type===type);if(!requests.length)box.append(node('p','ยังไม่มีคำขอ','employee-note'));for(const r of requests){const card=node('div','','employee-request');card.append(node('div',type==='leave'?r.leave_type+' · '+date(r.date):money(r.amount)+' · '+date(r.date)));if(type==='advance'&&r.payout_date)card.append(node('div','กำหนดรับเงินวันอาทิตย์ '+date(r.payout_date)));if(r.reason)card.append(node('div',r.reason));card.append(node('span',states[r.status]||r.status,'employee-state '+r.status));box.append(card);}}
  function form(data,type,box){
    const f=document.createElement('form');f.className='employee-form';const requestId=crypto.randomUUID();
    if(type==='leave')f.innerHTML='<label for="employee-leave-type">ประเภทลา</label><select id="employee-leave-type" name="leave_type"><option>ลากิจ</option><option>ลาป่วย</option></select><label for="employee-leave-date">วันที่จะลา</label><input id="employee-leave-date" name="date" type="date" required><label for="employee-leave-reason">เหตุผล</label><textarea id="employee-leave-reason" name="reason" rows="3" maxlength="500" required placeholder="ระบุเหตุผลการลา"></textarea>';
    else f.innerHTML='<fieldset><legend>จำนวนเงินที่ขอเบิก</legend><label class="employee-amount"><input type="radio" name="amount" value="500" checked>500 บาท</label><label class="employee-amount"><input type="radio" name="amount" value="1000">1,000 บาท</label></fieldset>';
    if(type==='leave'){f.elements.date.min=data.today;f.elements.date.value=data.today;}
    f.append(node('p',type==='leave'?'คำขอจะรอแอดมินอนุมัติก่อนบันทึกวันลา':'ส่งคำขอได้ทุกวัน · รับเงินเฉพาะวันอาทิตย์ หลังแอดมินอนุมัติ · รวมไม่เกิน 1,000 บาทต่ออาทิตย์','employee-note'));
    if(type==='advance'){
      f.append(node('p','กำหนดรับเงินวันอาทิตย์ '+date(data.advancePayoutDate)+' · วงเงินเหลือ '+money(data.advanceRemaining),'employee-note'));
      f.append(node('p','หักรอบ '+date(data.advancePeriod.start)+' – '+date(data.advancePeriod.end),'employee-note'));
      for(const radio of f.querySelectorAll('input[name=amount]')){radio.disabled=Number(radio.value)>data.advanceRemaining;if(radio.disabled)radio.checked=false;}
    }
    const submit=node('button','ส่งคำขอ','modal-btn primary');submit.type='submit';submit.style.width='100%';submit.disabled=type==='advance'&&!data.canAdvance;
    if(submit.disabled)submit.textContent='วงเงินวันอาทิตย์นี้เต็มแล้ว';f.append(submit);box.append(f);
    f.onsubmit=async e=>{e.preventDefault();submit.disabled=true;el('employee-error').textContent='';const values=Object.fromEntries(new FormData(f));if(type==='advance')values.amount=Number(values.amount);try{await easyApi('submitEmployeeRequest',{...values,type,request_id:requestId});f.replaceWith(node('p',type==='advance'?'ส่งคำขอแล้ว รอแอดมินอนุมัติ · กำหนดรับเงินวันอาทิตย์ '+date(data.advancePayoutDate):'ส่งคำขอแล้ว รอแอดมินอนุมัติ','employee-success'));const latest=await easyApi('getEmployeeOverview');const old=box.querySelector('.employee-history');old.replaceChildren();history(latest,type,old);}catch(error){el('employee-error').textContent=error.message;if(f.isConnected)submit.disabled=false;}};
    const list=node('div','','employee-history');history(data,type,list);box.append(list);
  }
  function income(data,box){
    box.append(node('p','รอบ '+date(data.period.start)+' – '+date(data.period.end)+' · จ่าย '+date(data.period.payDate),'employee-note'));
    const total=node('div',data.paid?'ยอดจ่ายที่บันทึกแล้ว':'คาดว่าจะได้รับตามเวลาที่บันทึกแล้ว','employee-total');total.append(node('strong',money(data.summary.total)));box.append(total);
    const dl=node('dl','','employee-breakdown');for(const [label,value] of [['ค่าแรง',data.summary.base],['OT อนุมัติแล้ว',data.summary.otApproved],['หักมาสาย',-data.summary.late],['หักออกก่อน',-data.summary.early],['ปรับยอด',data.summary.adjust],['ยอดเบิกที่หักในรอบนี้',-data.summary.advance]]){const line=node('div','');line.append(node('dt',label),node('dd',money(value)));dl.append(line);}box.append(dl);
    box.append(node('p','OT รออนุมัติ '+Number(data.otPendingHours.toFixed(2))+' ชม. ('+money(data.otPendingAmount)+') · เงินเบิกรออนุมัติ '+money(data.pendingAdvance)+' — ยังไม่รวมในยอดรับสุทธิ','employee-note'));
    if(!data.paid)box.append(node('p','ยอดประมาณการถึงตอนนี้ ยังไม่รวมวันทำงานที่เหลือ และอาจเปลี่ยนเมื่อแอดมินตรวจรายการก่อนจ่าย','employee-note'));
    box.append(node('h3','เวลาทำงานในรอบนี้','employee-section-title'));
    if(!data.attendance.length){box.append(node('p',data.missingHistory?'รอบเก่านี้ไม่ได้เก็บรายละเอียดเวลาไว้':'ยังไม่มีรายการลงเวลาในรอบนี้','employee-note'));return;}
    const table=node('table','','employee-attendance');table.innerHTML='<thead><tr><th>วันที่</th><th>เข้า</th><th>ออก</th><th>OT</th><th>รายได้</th></tr></thead><tbody></tbody>';
    for(const r of data.attendance){const tr=node('tr','');for(const text of [date(r.date),r.clock_in||'—',r.clock_out||'—',Number(r.ot_hours)>0&&Object.hasOwn(states,r.ot_status)?r.ot_hours+' ชม. · '+states[r.ot_status]:'—',r.day_total!=null?money(r.day_total):'—'])tr.append(node('td',text));table.tBodies[0].append(tr);}box.append(table);
  }
  window.openEmployeePanel=async type=>{
    if(!el('employee-modal').hidden)return;
    const current=++version;opener=document.activeElement;el('employee-title').textContent={leave:'ขอลา',advance:'ขอเบิกเงิน',income:'เวลาทำงาน / รายได้'}[type];el('employee-content').textContent='กำลังโหลด...';el('employee-error').textContent='';el('employee-modal').hidden=false;el('employee-modal').classList.add('visible');document.body.style.overflow='hidden';el('employee-close').focus();
    const loadForm=async()=>{
      el('employee-content').textContent='กำลังโหลด...';
      try{const data=await easyApi('getEmployeeOverview');if(current!==version)return;el('employee-content').replaceChildren();if(type==='income')income(data,el('employee-content'));else form(data,type,el('employee-content'));}catch(error){if(current!==version)return;el('employee-content').textContent='';el('employee-error').textContent=error.message;}
    };
    if(type==='advance'){
      el('employee-title').textContent='เงื่อนไขการเบิกเงิน';
      const box=el('employee-content');box.replaceChildren();
      box.append(node('p','สามารถเบิกเงินได้เฉพาะวันอาทิตย์ อาทิตย์ละไม่เกิน 1,000 บาท','employee-note'));
      box.append(node('p','ส่งคำขอได้ทุกวัน หากขอนอกเหนือจากวันอาทิตย์ จะได้รับเงินในวันอาทิตย์ถัดไปเท่านั้น โดยต้องรอแอดมินอนุมัติก่อน','employee-note'));
      box.append(node('p','วงเงินรวมคำขอที่รออนุมัติและอนุมัติแล้วของวันอาทิตย์เดียวกัน','employee-note'));
      const actions=node('div','','modal-btn-row'),cancel=node('button','ยกเลิก','modal-btn secondary'),accept=node('button','รับทราบ / เลือกจำนวนเงิน','modal-btn primary');
      cancel.type=accept.type='button';cancel.onclick=close;accept.onclick=()=>{el('employee-title').textContent='ขอเบิกเงิน';loadForm();};actions.append(cancel,accept);box.append(actions);accept.focus();
    }else await loadForm();
  };
})();
