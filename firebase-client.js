window.easyApi = async function(action, values = {}) {
  // Pilot Hosting uses the existing backend and database; no data migration.
  const pilot = ['easy-backoffice.web.app', 'easy-backoffice.firebaseapp.com'].includes(location.hostname);
  const endpoint = pilot ? 'https://easy-simple-api-mzxgtxalfq-as.a.run.app' : '/api';
  const response = await fetch(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + (sessionStorage.getItem('easy_firebase_token') || '')}, body: JSON.stringify({...values, action})});
  const result = await response.json();
  if (!response.ok || !result.success) throw Error(result.error || 'เชื่อมต่อไม่ได้');
  if (result.data?.notification_warning) alert(result.data.notification_warning);
  return result.data;
};
