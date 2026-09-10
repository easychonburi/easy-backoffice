// Session and response bridge for the original EASY pages; no legacy backend fallback.
window.easyRolePath = role => role === 'admin' ? '/dashboard.html' : role === 'driver' ? '/driver.html' : '/clock.html';
window.easyPost = async body => {
  const result = await easyApi(body.action,body);
  if (!result.success) throw Error(result.message || 'บันทึกไม่สำเร็จ');
  return result;
};
window.easyGet = query => easyPost(Object.fromEntries(new URLSearchParams(query)));
window.easyLegacyFetch = async (query,options) => {const result=options ? await easyPost(JSON.parse(options.body)) : await easyGet(query);return {json:async()=>result};};
window.easyLogout = async () => {try {await easyApi('logout');sessionStorage.removeItem('easy_firebase_token');location.href='/index.html';}catch(error){alert(error.message);}};
window.easyPageReady = (async()=>{
 try {const staff=await easyApi('me');window.easyCurrentSession={staff,role:staff.role};window.easyBranches=(await easyGet('action=getBranches')).data;}
 catch {window.easyCurrentSession=null;location.replace('/index.html');}
})();
