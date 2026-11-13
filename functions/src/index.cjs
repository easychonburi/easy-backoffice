const {onRequest}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const {getStorage}=require('firebase-admin/storage');
const {run,hash}=require('./store.cjs');
const {login,setPin}=require('./auth.cjs');
const {writes,authorize}=require('./policy.cjs');
initializeApp();
exports.api=onRequest({region:'asia-southeast1',maxInstances:5,concurrency:40,timeoutSeconds:60,memory:'512MiB',cors:false},async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
    if(!['GET','POST'].includes(req.method))return res.status(405).json({success:false,message:'Method not allowed'});
    let body=req.method==='GET'?req.query:req.body;
    if(typeof body==='string')body=JSON.parse(body);
    if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid request');
    const action=body.action;
    if(action==='getStaffByPin'){
      if(req.method!=='POST')throw Error('Login requires POST');
      return res.json(await login(getFirestore(),getAuth(),String(body.staff_id||''),String(body.pin||''),req.ip||'unknown'));
    }
    const header=req.get('Authorization')||'';
    if(!header.startsWith('Bearer '))return res.status(401).json({success:false,message:'กรุณาเข้าสู่ระบบ'});
    let token;try{token=await getAuth().verifyIdToken(header.slice(7),true);}catch{return res.status(401).json({success:false,message:'กรุณาเข้าสู่ระบบใหม่'});}
    const current=await getFirestore().doc('staff/'+token.uid).get();
    if(!current.exists||Number(current.data().auth_version||0)!==Number(token.auth_version||0))return res.status(401).json({success:false,message:'PIN ถูกเปลี่ยน กรุณาเข้าสู่ระบบใหม่'});
    if(action==='setStaffPin'){
      if(req.method!=='POST')throw Error('Writes require POST');
      return res.json(await setPin(getFirestore(),token.uid,body.staff_id,body.pin,req.get('X-Request-ID')));
    }
    if(writes.has(action)&&req.method!=='POST')throw Error('Writes require POST');
    const requestId=req.get('X-Request-ID');
    if(action==='uploadDriverPhoto'){
      const db=getFirestore(),s=await db.collection('staff').doc(token.uid).get();
      authorize(action,body,s.exists?s.data():null);
      if(!/^[a-f0-9-]{36}$/i.test(requestId||''))throw Error('Missing request ID');
      const b64=body.imageBase64||'';
      if(typeof b64!=='string'||b64.length>5500000||! /^[A-Za-z0-9+/]+={0,2}$/.test(b64))throw Error('Invalid image');
      const bytes=Buffer.from(b64,'base64');
      if(bytes.length>4*1024*1024||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw Error('JPEG required (maximum 4 MB)');
      const delivery_id=hash(token.uid+requestId),storage_path='deliveries/'+delivery_id+'.jpg';
      // Content-addressed request destination makes upload retries safe.
      const imageHash=hash(b64),file=getStorage().bucket().file(storage_path);
      try{await file.save(bytes,{resumable:false,contentType:'image/jpeg',preconditionOpts:{ifGenerationMatch:0},metadata:{metadata:{imageHash}}});}
      catch(e){if(Number(e.code)!==412)throw e;const [metadata]=await file.getMetadata();if(metadata.metadata?.imageHash!==imageHash)throw Error('Request ID reused with different image');}
      body={action,staff_id:token.uid,branch:body.branch,storage_path,delivery_id};
    }
    res.json(await run(getFirestore(),token.uid,action,body,requestId));
  }catch(e){
    // Never log bodies, PINs, tokens, employee records, or provider error payloads.
    const message=String(e.message||'Request failed');
    const permitted=/[ก-๙]|^(Invalid|Missing|Unknown|FORBIDDEN|UNAUTHENTICATED|Record does not match|Request ID reused|Writes require|Too many|JPEG required|Login requires)/.test(message);
    res.status(message==='FORBIDDEN'?403:400).json({success:false,message:permitted?message:'ทำรายการไม่สำเร็จ กรุณาลองใหม่'});
  }
});
