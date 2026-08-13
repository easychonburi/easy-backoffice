/* Browser-side Firebase API for the no-cost Spark plan. */
(function () {
  const cfg = window.EASY_FIREBASE_CONFIG;
  firebase.initializeApp(cfg);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const isAdmin = () => auth.currentUser?.email === 'pc001@easy-backoffice.local';
  const id = prefix => `${prefix}${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).replace(/[- :]/g, '')}`;
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const clock = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
  const data = snap => ({ ...snap.data(), _id: snap.id });
  const all = async name => (await db.collection(name).get()).docs.map(data);
  const put = (name, key, value) => db.collection(name).doc(String(key)).set(value, { merge: true });
  const same = (a, b) => String(a ?? '') === String(b ?? '');
  const minutes = v => { const [h, m] = String(v || '00:00').split(':').map(Number); return h * 60 + m; };
  const worked = (a, b) => { let n = minutes(b) - minutes(a); if (n < 0) n += 1440; return +(n / 60).toFixed(2); };
  const distance = (a, b, c, d) => { const r = 6371000, x = v => v * Math.PI / 180; const n = Math.sin(x(c-a)/2)**2 + Math.cos(x(a))*Math.cos(x(c))*Math.sin(x(d-b)/2)**2; return r * 2 * Math.atan2(Math.sqrt(n), Math.sqrt(1-n)); };
  const filter = (rows, b = {}) => rows.filter(x => (!b.staff_id || same(x.staff_id,b.staff_id)) && (!b.status || x.status === b.status) && (!b.date_from || String(x.date).slice(0,10) >= b.date_from) && (!b.date_to || String(x.date).slice(0,10) <= b.date_to));
  const publicStaff = x => { const { pin, rate, ot_rate, bank_name, bank_account, national_id, _id, ...v } = x; return { ...v, email: `${String(x.staff_id).toLowerCase()}@easy-backoffice.local` }; };

  async function getStaff() {
    const basic = await all('staff');
    if (!isAdmin()) return basic;
    const privateRows = await all('staff_private');
    return basic.map(x => ({ ...x, ...(privateRows.find(y => y.staff_id === x.staff_id) || {}) }));
  }
  async function getSettings() { return Object.fromEntries((await all('settings')).map(x => [x.key, x.value])); }
  async function clockIn(b) {
    const [staff, branches, cfg, records] = await Promise.all([getStaff(), all('branches'), getSettings(), all('timesheets')]);
    const member = staff.find(x => same(x.staff_id,b.staff_id)); const date = b.date || today();
    if (!member) return { success:false, message:'ไม่พบพนักงาน' };
    if (records.some(x => same(x.staff_id,b.staff_id) && x.date === date && x.clock_in)) return { success:false, message:'บันทึกเข้างานวันนี้แล้ว' };
    let near, best = Infinity;
    branches.filter(x => x.status === 'active').forEach(x => { const d = distance(+b.lat,+b.lng,+x.lat,+x.lng); if (d <= +x.allowed_radius_m && d < best) { near=x; best=d; } });
    if (!near) return { success:false, message:'คุณอยู่นอกพื้นที่สาขา ไม่สามารถบันทึกได้' };
    const at=clock(), start=member.shift==='night'?cfg.shift_night_start:cfg.shift_morning_start, late=Math.max(0,minutes(at)-minutes(start)), record_id=id('TS');
    await put('timesheets',record_id,{record_id,staff_id:member.staff_id,staff_name:member.nickname||member.name,branch_id:near.branch_id,branch_name:near.name,date,clock_in:at,clock_out:'',hours_worked:'',late_min:late,late_reason:b.late_reason||'',ot_hours:'',ot_requested:'',ot_reason:'',ot_status:'',status:'active',clock_in_lat:b.lat,clock_in_lng:b.lng,created_at:new Date().toISOString()});
    return {success:true,record_id,branch_name:near.name,clock_in:at,late_min:late};
  }
  async function clockOut(b) {
    const [records, staff, cfg] = await Promise.all([all('timesheets'),getStaff(),getSettings()]);
    const member=staff.find(x=>same(x.staff_id,b.staff_id)), date=b.date||today(), yesterday=new Date(Date.now()-86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'});
    const record=records.find(x=>same(x.staff_id,b.staff_id)&&!x.clock_out&&[date,yesterday].includes(x.date));
    if(!record) return {success:false,message:'ไม่พบข้อมูลการเข้างานที่ค้างอยู่'};
    const out=clock(), end=member?.shift==='night'?cfg.shift_night_end:cfg.shift_morning_end; let ot=minutes(out)-minutes(end); if(ot < -360) ot+=1440; ot=Math.max(0,ot); const has=ot>(+cfg.ot_grace_min||15);
    await put('timesheets',record.record_id,{clock_out:out,clock_out_lat:b.lat,clock_out_lng:b.lng,hours_worked:worked(record.clock_in,out),ot_hours:has?+(ot/60).toFixed(2):0,ot_requested:b.ot_requested||'no',ot_reason:b.ot_reason||'',ot_status:b.ot_requested==='yes'?'pending':'no',status:'complete'});
    return {success:true,clock_out:out,hours_worked:worked(record.clock_in,out),ot_mins:ot,has_ot:has,shift_end:end};
  }
  function stockItems(mode, branchId) {
    const central = String(branchId).toUpperCase() === 'BR005';
    const open = central ? [['อกไก่','ถุงเล็ก'],['หมูกระจก','ถุง'],['ซอส','แกลลอน'],['น้ำมันกระเทียมเจียว','แกลลอน'],['เก๊กฮวย','ขวด'],['อัญชัน','ขวด'],['ชาไทย','ขวด']] : [['เส้นหมี่','ห่อ'],['อกไก่','กิโล'],['หมูกระจก','ถุง'],['ผักกาดหอม','กิโล'],['กล่อง 26 oz','แถว'],['กล่อง 32 oz','แถว'],['โค้ก','ขวด'],['สไปร์ท','ขวด'],['น้ำแดง','ขวด'],['น้ำส้ม','ขวด'],['เก๊กฮวย','ขวด'],['อัญชัน','ขวด'],['ชาไทย','ขวด'],['ชาเขียวมะลิ','ขวด']];
    const close = central ? [['น้ำมัน','แกลลอน'],['ซีอิ๋วขาว','แกลลอน'],['น้ำส้มสายชู','แกลลอน'],['น้ำตาล','ถุง'],['น้ำปลา','ขวด'],['รสดีเหลือง','ถุง'],['รสดีเขียว','ถุง'],['รสดีส้ม','ถุง'],['ผงชูรส','ถุง'],['พริกป่น','ถุง'],['น้ำมันหอย','ถุง'],['หมูกระจก(ยังไม่ผัด)','ถุง'],['ผงเก๊กฮวย','ถุง'],['ผงอัญชัน','ถุง'],['ผงชาไทยตรามือ','ถุง'],['ผงชาไทยยอดชา','ถุง'],['นมข้นจืด','กระป๋อง'],['เกลือ','ถุง'],['น้ำมะนาว','ขวด'],['นมข้นหวาน','ถุง'],['สติ๊กเกอร์อัญชัน','แผ่น'],['สติ๊กเกอร์เก๊กฮวย','แผ่น'],['สติ๊กเกอร์ชาไทย','แผ่น'],['ขวดน้ำ','']] : [['เส้นหมี่','ห่อ'],['อกไก่','กิโล'],['หมูกระจก','ถุง'],['ผักกาดหอม','กิโล'],['ใบพาสเล่ย์','ถุง'],['ลูกชิ้นปลา',''],['ไข่กุ้ง',''],['น้ำมันกระเทียมเจียว','แกลลอน'],['กระเทียมเจียว','กรัม'],['ซอสดั้งเดิม','แกลลอน'],['น้ำมะนาว','ขวด'],['พริกป่น','ถุง'],['น้ำตาล','ถุง'],['น้ำปลา','ขวด'],['รสดี','ถุง'],['ถุงซีล 7×10','ห่อ'],['ถุงซีล 9×11.5','ห่อ'],['กล่อง 26 oz','แถว'],['กล่อง 32 oz','แถว'],['ถุงหิ้วพลาสติก 6×14','ห่อ'],['ถุงหิ้วพลาสติก 8×16','ห่อ'],['สติ๊กเกอร์ ดั้งเดิม','แผ่น'],['สติ๊กเกอร์ แซ่บ','แผ่น'],['น้ำเปล่า','ขวด'],['น้ำโค้ก','ขวด'],['น้ำส้ม','ขวด'],['น้ำแดง','ขวด'],['น้ำสไปร์ท','ขวด'],['น้ำเก๊กฮวย','ขวด'],['น้ำอัญชัน','ขวด'],['ชาไทย','ขวด'],['กระดาษใบเสร็จ','ม้วน'],['ตะเกียบ',''],['ถุงขยะ',''],['ทิชชู่เปียก',''],['ทิชชู่แห้ง',''],['น้ำยาถูพื้น',''],['น้ำยาซักผ้า',''],['น้ำยาล้างจาน',''],['ฟองน้ำล้างจาน',''],['ถุงมือ',''],['หมวกคลุมผม','']];
    return (mode === 'open' ? open : close).map(([name,unit]) => ({name,unit,type:'free',category:'other'}));
  }
  async function request(action,b={}) {
    if (!auth.currentUser) return {success:false,message:'กรุณาเข้าสู่ระบบใหม่'};
    if(action==='getMyStaff') { const email=auth.currentUser.email; const row=(await all('staff')).find(x=>x.email===email); return row?{success:true,data:row}:{success:false,message:'ยังไม่ได้ตั้งค่าพนักงาน'}; }
    if(action==='getSettings') return {success:true,data:await getSettings()};
    if(action==='getStaff') return {success:true,data:await getStaff()};
    if(action==='getBranches') return {success:true,data:(await all('branches')).filter(x=>x.status==='active')};
    if(action==='clockIn') return clockIn(b); if(action==='clockOut') return clockOut(b);
    if(action==='getTimesheets') return {success:true,data:filter(await all('timesheets'),b)};
    if(action==='getTodayStatus') return {success:true,data:(await all('timesheets')).filter(x=>x.date===today())};
    if(action==='updateTimesheetOT') { await put('timesheets',b.record_id,{ot_status:b.ot_status}); return {success:true}; }
    if(action==='getPayrollRuns') return {success:true,data:filter(await all('payroll_runs'),b)};
    if(action==='savePayrollRun') { const run_id=id('PR'); await put('payroll_runs',run_id,{...b,run_id,status:b.status||'paid'}); return {success:true,run_id}; }
    if(action==='markPaid') { await put('payroll_runs',b.run_id,{status:'paid',paid_at:new Date().toISOString()}); return {success:true}; }
    if(action==='getAdvances') return {success:true,data:filter(await all('advances'),b)};
    if(action==='saveAdvance') { const advance_id=id('ADV'); await put('advances',advance_id,{...b,advance_id,date:b.date||today(),status:'pending',created_at:new Date().toISOString()}); return {success:true,advance_id}; }
    if(action==='markAdvancesDeducted') { await Promise.all((b.advance_ids||[]).map(x=>put('advances',x,{status:'deducted'}))); return {success:true}; }
    if(action==='getLeaves') return {success:true,data:filter(await all('leaves'),b)};
    if(action==='saveLeave') { const leave_id=id('LV'); await put('leaves',leave_id,{...b,leave_id,created_at:new Date().toISOString()}); return {success:true,leave_id}; }
    if(action==='deleteLeave') { await db.collection('leaves').doc(b.leave_id).delete(); return {success:true}; }
    if(action==='getCentralTargets') return {success:true,data:await all('central_targets')};
    if(action==='updateCentralTarget') { await put('central_targets',b.item_name,{target_qty:b.target_qty}); return {success:true}; }
    if(action==='getStockItems') return {success:true,data:stockItems(b.mode,b.branch_id)};
    if(action==='saveStockLog') { const staff=(await getStaff()).find(x=>same(x.staff_id,b.staff_id)), branch=(await all('branches')).find(x=>same(x.branch_id,b.branch_id)), log_id=id('ST'); await put('stock_logs',log_id,{log_id,branch_id:b.branch_id,branch_name:branch?.name||b.branch_id,mode:b.mode,items_json:JSON.stringify(b.stocks||[]),orders_json:JSON.stringify(b.orders||[]),staff_id:b.staff_id,staff_name:staff?.nickname||staff?.name||b.staff_id,checked_at:new Date().toISOString()}); return {success:true,log_id,workOrders:[]}; }
    if(action==='getTodayStockOrders') { const rows=(await all('stock_logs')).filter(x=>x.mode==='close'&&x.orders_json&&x.orders_json!=='[]'); return {success:true,data:rows.map(x=>({branch_id:x.branch_id,branch_name:x.branch_name,time:new Date(x.checked_at).toLocaleTimeString('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit'}),orders:JSON.parse(x.orders_json)}))}; }
    if(action==='getDriverOrders') { const grouped={}; (await all('stock_logs')).filter(x=>x.mode==='close'&&x.branch_id!=='BR005'&&x.orders_json&&x.orders_json!=='[]').forEach(x=>{(grouped[x.branch_name]||=[]).push(...JSON.parse(x.orders_json));}); return {success:true,data:grouped}; }
    if(action==='approvePurchase') { const task_id=id('JOB'); await put('driver_jobs',task_id,{task_id,date:today(),items_json:JSON.stringify(b.items||[]),status:'pending',created_at:new Date().toISOString()}); return {success:true}; }
    if(action==='getPickups') { const job=(await all('driver_jobs')).filter(x=>x.date===today()).sort((a,z)=>String(z.created_at).localeCompare(String(a.created_at)))[0]; const grouped={}; JSON.parse(job?.items_json||'[]').forEach(x=>(grouped[x.location]||=[]).push(`${x.name} ${x.qty} ${x.unit}`)); return {success:true,data:grouped}; }
    if(action==='submitDriverReturn') { const log_id=id('ST_DRV'); await put('stock_logs',log_id,{log_id,branch_id:'DRIVER',branch_name:'รถคนขับ',mode:'return',items_json:JSON.stringify(b.items||[]),orders_json:'[]',staff_id:'DRIVER',staff_name:'คนขับรถ',checked_at:new Date().toISOString()}); return {success:true}; }
    return {success:false,message:`ยังไม่ได้ย้ายคำสั่ง ${action}`};
  }
  window.easyApi={auth,db,request,publicStaff,isAdmin};
})();
