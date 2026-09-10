window.easyApi = async function(action, values = {}) {
  const response = await fetch('/api', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + (sessionStorage.getItem('easy_firebase_token') || '')}, body: JSON.stringify({...values, action})});
  const result = await response.json();
  if (!response.ok || !result.success) throw Error(result.error || 'เชื่อมต่อไม่ได้');
  return result.data;
};
