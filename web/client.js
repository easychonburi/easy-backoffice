import {initializeApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithCustomToken,signOut,setPersistence,browserSessionPersistence} from 'firebase/auth';
const config=window.EASY_FIREBASE;
const auth=getAuth(initializeApp(config));
if(config.emulator)connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
const ready=setPersistence(auth,browserSessionPersistence).then(()=>auth.authStateReady());
const nativeFetch=window.fetch.bind(window);
const inflight=new Map();
const sessionKey='easy_firebase_session';
window.easyLogout=async()=>{localStorage.removeItem(sessionKey);await signOut(auth);location.href='/index.html';};
window.easyPosition=()=>new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude}),reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
async function call(url,init){
 await ready;
 const options={...init,headers:new Headers(init.headers||{}),signal:AbortSignal.timeout(45000)};
 let body=options.method==='POST'?JSON.parse(options.body):Object.fromEntries(url.searchParams);
 const login=body.action==='getStaffByPin';
 if(!login){
   let session;try{session=JSON.parse(localStorage.getItem(sessionKey));}catch{}
   if(!auth.currentUser||!session||session.expires<Date.now()){await signOut(auth);localStorage.removeItem(sessionKey);location.href='/index.html';throw Error('Session expired');}
   options.headers.set('Authorization','Bearer '+await auth.currentUser.getIdToken());
 }
 if(options.method==='POST'){
   options.headers.set('Content-Type','application/json');options.headers.set('X-Request-ID',crypto.randomUUID());
 }
 let response;
 for(let attempt=0;attempt<2;attempt++){
   try{response=await nativeFetch(url,options);break;}catch(e){if(attempt||login)throw e;options.signal=AbortSignal.timeout(45000);}
 }
 const data=await response.clone().json();
 if(response.status===401){localStorage.removeItem(sessionKey);await signOut(auth);location.href='/index.html';throw Error('กรุณาเข้าสู่ระบบใหม่');}
 if(login&&data.success){await signInWithCustomToken(auth,data.customToken);delete data.customToken;return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});}
 if(!data.success&&!login)throw Error(data.message||'ทำรายการไม่สำเร็จ');
 return response;
}
window.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input.url,location.href);
 if(url.origin!==location.origin||url.pathname!=='/api')return nativeFetch(input,init);
 const key=(init.method||'GET')+url.href+(init.body||'');
 if(inflight.has(key))return (await inflight.get(key)).clone();
 const promise=call(url,init);inflight.set(key,promise);
 try{return (await promise).clone();}finally{inflight.delete(key);}
};
window.addEventListener('DOMContentLoaded',()=>{
 const banner=document.createElement('div');banner.textContent='ระบบทดสอบ — ข้อมูลแยกจากระบบใช้งานจริง';banner.style.cssText='background:#fff3cd;color:#6c4e00;text-align:center;padding:6px;font:12px sans-serif;position:relative;z-index:9999';document.body.prepend(banner);
 let session;try{session=JSON.parse(localStorage.getItem(sessionKey));}catch{}
 if(session?.role==='admin'&&location.pathname!=='/index.html'&&location.pathname!=='/'){
   const nav=document.createElement('nav');nav.className='easy-admin-nav';nav.setAttribute('aria-label','เมนูผู้ดูแล');
   const style=document.createElement('style');style.textContent='.easy-admin-nav{display:flex;gap:4px;overflow-x:auto;padding:10px 16px;background:#fff;border-bottom:1px solid #e5e7eb;position:sticky;top:0;z-index:30}.easy-admin-nav a{padding:9px 14px;color:#687386;text-decoration:none;border-radius:8px;font:14px Prompt,sans-serif;white-space:nowrap}.easy-admin-nav a.active{background:#fff0f0;color:#d8212a;font-weight:600}';document.head.append(style);
   const links=[['/dashboard.html','ภาพรวม'],['/payroll.html','เงินเดือน'],['/admin.html#staff','พนักงาน'],['/admin.html#settings','ตั้งค่า'],['/admin.html#data','ข้อมูลระบบ']];
   const draw=()=>{nav.replaceChildren(...links.map(([url,label])=>{const a=document.createElement('a');a.href=url;a.textContent=label;if(location.pathname+(location.hash|| (location.pathname==='/admin.html'?'#staff':''))===url){a.className='active';a.setAttribute('aria-current','page');}return a;}));};
   draw();(document.querySelector('header')||banner).after(nav);window.addEventListener('easy-nav-refresh',draw);window.addEventListener('hashchange',draw);
 }
});
