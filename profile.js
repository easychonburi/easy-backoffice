(() => {
  const css=document.createElement('style');css.textContent=`
  .profile-dialog{box-sizing:border-box;width:calc(100% - 24px);max-width:560px;max-height:90dvh;margin:auto;border:0;border-radius:20px;padding:20px;color:var(--text,#20232a);background:white;font:14px 'Prompt',sans-serif;overflow-y:auto}
  .profile-dialog::backdrop{background:#0008}.profile-dialog *{box-sizing:border-box}.profile-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:16px}.profile-top h2{font-size:18px;margin:0}.profile-dialog button,.profile-admin-link{font:inherit;cursor:pointer;border:1px solid var(--border,#ddd);border-radius:10px;background:var(--soft,#f7f7fa);padding:10px;color:inherit}.profile-dialog button:disabled{opacity:.5;cursor:default}.profile-dialog label{display:block;margin:12px 0 6px;font-weight:500}.profile-dialog input:not([type=file]),.profile-dialog textarea{display:block;width:100%;min-width:0;border:1px solid var(--border,#ddd);border-radius:10px;padding:12px;font:inherit;background:var(--soft,#f7f7fa);color:inherit}.profile-dialog textarea{resize:vertical}.profile-save{width:100%;margin-top:16px;background:var(--red,#e51d2a)!important;color:white!important;border:0!important}.profile-doc{border-top:1px solid var(--border,#ddd);margin-top:20px;padding-top:8px}.profile-doc h3{font-size:15px}.profile-doc-actions{display:flex;flex-wrap:wrap;gap:8px}.profile-doc img{display:block;width:100%;height:auto;border-radius:8px;margin-top:12px}.profile-note{font-size:12px;color:var(--text-secondary,#777);line-height:1.7}.profile-message{margin:10px 0;overflow-wrap:anywhere}.profile-admin-link{font-size:11px;margin-top:6px;padding:6px 8px}.profile-status{max-width:300px;text-align:center}.profile-status p{line-height:1.7;overflow-wrap:anywhere}.profile-status button{min-width:100px}.profile-dialog input.profile-account-locked{background:#f5f5f6;border-color:#e9e9ec;color:#999}.profile-bank-edit{margin-top:6px;padding:6px 14px!important}.profile-dialog [hidden]{display:none!important}`;
  document.head.append(css);
  const dialog=document.createElement('dialog');dialog.className='profile-dialog';dialog.setAttribute('aria-labelledby','profile-heading');document.body.append(dialog);
  const statusDialog=document.createElement('dialog');statusDialog.className='profile-dialog profile-status';statusDialog.setAttribute('aria-label','สถานะการบันทึก');document.body.append(statusDialog);statusDialog.addEventListener('cancel',e=>e.preventDefault());
  function saveStatus(text,loading=false){statusDialog.replaceChildren();const icon=document.createElement('div');icon.textContent=loading?'⏳':text.includes('ไม่สำเร็จ')?'⚠️':'✅';icon.style.fontSize='30px';const label=document.createElement('p');label.textContent=text;label.setAttribute('role','status');statusDialog.append(icon,label);if(!loading){const ok=document.createElement('button');ok.type='button';ok.textContent='ตกลง';ok.onclick=()=>statusDialog.close();statusDialog.append(ok);}if(!statusDialog.open)statusDialog.showModal();}
  let busy=false,opener,epoch=0;
  const node=(tag,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
  function close(){if(busy)return;epoch++;dialog.close();dialog.replaceChildren();opener?.focus();}
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  async function jpeg(file){
    if(!file.type.startsWith('image/')||file.size>25*1024*1024)throw Error('กรุณาเลือกรูปภาพขนาดไม่เกิน 25 MB');
    const url=URL.createObjectURL(file),img=new Image();
    try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('เปิดรูปนี้ไม่ได้ กรุณาใช้รูป JPG/PNG หรือถ่ายรูปใหม่'));img.src=url;});
      const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
      for(const quality of [.88,.76,.64,.52]){const result=canvas.toDataURL('image/jpeg',quality);if(result.length<=700000)return result;}
      throw Error('รูปมีขนาดใหญ่เกินไป กรุณาถ่ายเฉพาะเอกสารให้ชัดเจนแล้วลองใหม่');
    }finally{URL.revokeObjectURL(url);}
  }
  window.openMyProfile=async staffId=>{
    if(dialog.open)return;const current=++epoch,readOnly=Boolean(staffId);busy=false;opener=document.activeElement;dialog.replaceChildren();
    const top=node('div');top.className='profile-top';const title=node('h2',readOnly?'👤 ข้อมูลพนักงาน':'👤 ข้อมูลของฉัน');title.id='profile-heading';const exit=node('button','ปิด');exit.type='button';exit.onclick=close;top.append(title,exit);
    const content=node('div','กำลังโหลด...'),message=node('p');message.className='profile-message';message.setAttribute('role','status');dialog.append(top,message,content);dialog.showModal();
    function lock(value){busy=value;dialog.querySelectorAll('button').forEach(b=>b.disabled=value);if(!value)dialog.querySelector('form')?.dispatchEvent(new Event('input'));}
    try{
      const data=await easyApi('getEmployeeProfile',staffId?{staff_id:staffId}:{});if(current!==epoch)return;content.replaceChildren();
      const form=node('form');const fields=[['first_name','ชื่อ','text',80],['last_name','นามสกุล','text',80],['nickname','ชื่อเล่น','text',80],['birthday','วันเกิด','date',10],['age','อายุ','number',3],['address','ที่อยู่ปัจจุบัน','textarea',1000],['bank_name','ธนาคาร','text',80],['bank_account','เลขบัญชีธนาคาร','text',40]];
      for(const [key,label,type,max] of fields){const l=node('label',label),input=node(type==='textarea'?'textarea':'input');input.id='profile-'+key;input.name=key;l.htmlFor=input.id;if(type!=='textarea')input.type=type;else input.rows=3;input.value=data[key]??'';input.readOnly=readOnly;input.maxLength=max;input.required=!readOnly;if(key==='birthday'){input.max=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});}
if(key==='age'){input.min=1;input.max=120;input.step=1;}if(key==='bank_account'||key==='age')input.inputMode='numeric';form.append(l,input);}
      const account=form.elements.bank_account;
      let editAccount;
      const lockAccount=()=>{if(readOnly)return;account.readOnly=Boolean(account.value.trim());account.classList.toggle('profile-account-locked',account.readOnly);editAccount.hidden=!account.readOnly;};
      if(!readOnly){editAccount=node('button','แก้ไข');editAccount.type='button';editAccount.className='profile-bank-edit';account.after(editAccount);editAccount.onclick=()=>{account.readOnly=false;account.classList.remove('profile-account-locked');editAccount.hidden=true;account.focus();};lockAccount();}
      if(!readOnly){const save=node('button','บันทึกข้อมูล');save.type='submit';save.className='profile-save';form.append(save);
        const validity=()=>{for(const input of form.querySelectorAll('input,textarea'))input.setCustomValidity(input.value.trim()?'':'กรุณากรอกข้อมูลให้ครบ');save.disabled=busy||!form.checkValidity();};form.addEventListener('input',validity);validity();
        form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;lock(true);saveStatus('กำลังบันทึกข้อมูล...',true);try{await easyApi('saveEmployeeProfile',Object.fromEntries(new FormData(form)));lockAccount();message.textContent='บันทึกข้อมูลแล้ว';saveStatus('บันทึกข้อมูลสำเร็จ');}catch(error){message.textContent=error.message;saveStatus('บันทึกไม่สำเร็จ: '+error.message);}finally{lock(false);}};
      }
      content.append(form);
      const note=node('p',readOnly?'เอกสารส่วนตัวของพนักงาน':'ใช้รูปเอกสารตัวจริงหรือสำเนาก็ได้ กรุณาให้ตัวหนังสืออ่านชัด · รูปจะบันทึกทันทีเมื่อเลือกสำเร็จ');note.className='profile-note';content.append(note);
      for(const [kind,label] of [['id_card','รูปบัตรประชาชน'],['house_registration','รูปทะเบียนบ้าน']]){
        const section=node('section');section.className='profile-doc';const heading=node('h3',label),status=node('p',data.documents[kind]?'มีรูปที่บันทึกไว้แล้ว':'ยังไม่มีรูป'),actions=node('div'),preview=node('div');status.className='profile-note';actions.className='profile-doc-actions';section.append(heading,status,actions,preview);content.append(section);
        const showImage=image=>{const img=node('img');img.src=image;img.alt=label;preview.replaceChildren(img);};
        const view=node('button','ดูรูปที่บันทึกไว้');view.type='button';view.hidden=!data.documents[kind];actions.append(view);
        view.onclick=async()=>{lock(true);message.textContent='';try{const result=await easyApi('getEmployeeDocument',{kind,...(staffId?{staff_id:staffId}:{})});showImage(result.image);}catch(error){message.textContent=error.message;}finally{lock(false);}};
        if(!readOnly)for(const camera of [true,false]){
          const button=node('button',camera?'📷 ถ่ายรูป':'เลือกรูปจากเครื่อง'),input=node('input');button.type='button';input.type='file';input.accept='image/*';input.hidden=true;if(camera)input.setAttribute('capture','environment');button.onclick=()=>input.click();actions.append(button,input);
          input.onchange=async()=>{const file=input.files[0];if(!file)return;lock(true);message.textContent='กำลังบันทึกรูป...';saveStatus('กำลังบันทึกรูป...',true);try{const image=await jpeg(file);await easyApi('saveEmployeeDocument',{kind,image});showImage(image);view.hidden=false;status.textContent='มีรูปที่บันทึกไว้แล้ว';message.textContent='บันทึกรูปแล้ว';saveStatus('บันทึกรูปสำเร็จ');}catch(error){message.textContent=error.message;saveStatus('บันทึกรูปไม่สำเร็จ: '+error.message);}finally{input.value='';lock(false);}};
        }
      }
    }catch(error){if(current!==epoch)return;content.textContent='';message.textContent=error.message;}
  };
})();
