const easyTokenKey = 'easy_firebase_token';
const easyDriverKey = 'easy_driver_session';
window.easyReadToken = () => {
  const tabToken = sessionStorage.getItem(easyTokenKey);
  if (tabToken) return tabToken;
  try {
    const session = JSON.parse(localStorage.getItem(easyDriverKey));
    if (session?.expires > Date.now()) return session.token;
  } catch {}
  localStorage.removeItem(easyDriverKey);
  return '';
};
window.easyKeepDriverToken = token => {
  localStorage.setItem(easyDriverKey, JSON.stringify({token, expires:Date.now()+8*3600000}));
};
window.easyClearToken = () => {
  const token = easyReadToken();
  sessionStorage.removeItem(easyTokenKey);
  try {
    if (JSON.parse(localStorage.getItem(easyDriverKey))?.token === token) localStorage.removeItem(easyDriverKey);
  } catch {}
};
window.easyApi = async function(action, values = {}) {
  // Pilot Hosting uses the existing backend and database; no data migration.
  const pilot = ['easy-backoffice.web.app', 'easy-backoffice.firebaseapp.com'].includes(location.hostname);
  const endpoint = pilot ? 'https://easy-simple-api-mzxgtxalfq-as.a.run.app' : '/api';
  const response = await fetch(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + easyReadToken()}, body: JSON.stringify({...values, action})});
  const result = await response.json();
  if (!response.ok || !result.success) {
    const error = Error(result.error || 'เชื่อมต่อไม่ได้');
    error.status = response.status;
    throw error;
  }
  if (result.data?.notification_warning) alert(result.data.notification_warning);
  return result.data;
};
