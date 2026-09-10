'use strict';
// Pure calculation and stock catalogue functions copied from the supplied code.gs.
function calcLateMin(shiftStart, clockIn) {
  const [sh, sm] = shiftStart.split(':').map(Number);
  const [ch, cm] = clockIn.split(':').map(Number);
  return Math.max(0, (ch * 60 + cm) - (sh * 60 + sm));
}

function calcOtMins(shiftEnd, clockOut) {
  const [eh, em] = shiftEnd.split(':').map(Number);
  let [ch, cm] = clockOut.split(':').map(Number);
  if (ch < eh - 6) ch += 24;
  return Math.max(0, (ch * 60 + cm) - (eh * 60 + em));
}

function calcHoursWorked(clockIn, clockOut) {
  const [ih, im] = clockIn.split(':').map(Number);
  let [oh, om] = clockOut.split(':').map(Number);
  if (oh < ih) oh += 24;
  return parseFloat(((oh * 60 + om - (ih * 60 + im)) / 60).toFixed(2));
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getItemsListByMode(mode, branch_id) {
    const openModeItemsBase = [
      { name: 'เส้นหมี่', unit: 'ห่อ', type:'fraction', category: 'fresh' },
      { name: 'อกไก่', unit: 'กิโล', type:'free', category: 'fresh' },
      { name: 'หมูกระจก', unit: 'ถุง', type:'fraction', category: 'fresh' },
      { name: 'ผักกาดหอม', unit: 'กิโล', type:'free', category: 'fresh' },
      { name: 'กล่อง 26 oz', unit: 'แถว', type:'fraction', category: 'packaging' },
      { name: 'กล่อง 32 oz', unit: 'แถว', type:'fraction', category: 'packaging' },
      { name: 'โค้ก', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'สไปร์ท', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'น้ำแดง', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'น้ำส้ม', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'เก๊กฮวย', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'อัญชัน', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'ชาไทย', unit: 'ขวด', type:'free', category: 'packaging' },
      { name: 'ชาเขียวมะลิ', unit: 'ขวด', type:'free', category: 'packaging' }
    ];

    const closeModeItemsBase = [
      { name:'เส้นหมี่', unit:'ห่อ', category:'fresh', icon:'🥬', type:'fraction' },
      { name:'อกไก่', unit:'กิโล', category:'fresh', icon:'🥬', type:'free' },
      { name:'หมูกระจก', unit:'ถุง', category:'fresh', icon:'🥬', type:'fraction' },
      { name:'ผักกาดหอม', unit:'กิโล', category:'fresh', icon:'🥬', type:'free' },
      { name:'ใบพาสเล่ย์', unit:'ถุง', category:'fresh', icon:'🥬', type:'fraction' },
      { name:'ลูกชิ้นปลา', unit:'', category:'fresh', icon:'🥬', orderOnly:true },
      { name:'ไข่กุ้ง', unit:'', category:'fresh', icon:'🥬', orderOnly:true },
      { name:'น้ำมันกระเทียมเจียว', unit:'แกลลอน', category:'seasoning', icon:'🧂', type:'fraction' },
      { name:'กระเทียมเจียว', unit:'กรัม', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ซอสดั้งเดิม', unit:'แกลลอน', category:'seasoning', icon:'🧂', type:'fraction' },
      { name:'น้ำมะนาว', unit:'ขวด', category:'seasoning', icon:'🧂', orderOnly:true },
      { name:'พริกป่น', unit:'ถุง', category:'seasoning', icon:'🧂', orderOnly:true },
      { name:'น้ำตาล', unit:'ถุง', category:'seasoning', icon:'🧂', orderOnly:true },
      { name:'น้ำปลา', unit:'ขวด', category:'seasoning', icon:'🧂', orderOnly:true },
      { name:'รสดี', unit:'ถุง', category:'seasoning', icon:'🧂', orderOnly:true },
      { name:'ถุงซีล 7×10', unit:'ห่อ', category:'packaging', icon:'📦', type:'fraction' },
      { name:'ถุงซีล 9×11.5', unit:'ห่อ', category:'packaging', icon:'📦', type:'fraction' },
      { name:'กล่อง 26 oz', unit:'แถว', category:'packaging', icon:'📦', type:'fraction' },
      { name:'กล่อง 32 oz', unit:'แถว', category:'packaging', icon:'📦', type:'fraction' },
      { name:'ถุงหิ้วพลาสติก 6×14', unit:'ห่อ', category:'packaging', icon:'📦', type:'fraction' },
      { name:'ถุงหิ้วพลาสติก 8×16', unit:'ห่อ', category:'packaging', icon:'📦', type:'fraction' },
      { name:'สติ๊กเกอร์ ดั้งเดิม', unit:'แผ่น', category:'packaging', icon:'📦', type:'fraction' },
      { name:'สติ๊กเกอร์ แซ่บ', unit:'แผ่น', category:'packaging', icon:'📦', type:'fraction' },
      { name:'น้ำเปล่า', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'น้ำโค้ก', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'น้ำส้ม', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'น้ำแดง', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'น้ำสไปร์ท', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'น้ำเก๊กฮวย', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'น้ำอัญชัน', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'ชาไทย', unit:'ขวด', category:'packaging', icon:'📦', type:'free' },
      { name:'กระดาษใบเสร็จ', unit:'ม้วน', category:'packaging', icon:'📦', orderOnly:true },
      { name:'ตะเกียบ', unit:'', category:'packaging', icon:'📦', orderOnly:true },
      { name:'ถุงขยะ', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'ทิชชู่เปียก', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'ทิชชู่แห้ง', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'น้ำยาถูพื้น', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'น้ำยาซักผ้า', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'น้ำยาล้างจาน', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'ฟองน้ำล้างจาน', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'ถุงมือ', unit:'', category:'cleaning', icon:'🧹', orderOnly:true },
      { name:'หมวกคลุมผม', unit:'', category:'cleaning', icon:'🧹', orderOnly:true }
    ];

    // 🛠️ แก้ไข: เรียงลำดับใหม่, เปลี่ยน type เป็น 'free' (จำนวนเต็ม), และตั้ง category เป็น 'other' ให้โชว์รวมกัน
    const nongTamleungOpen = [
      { name:'อกไก่', unit:'ถุงเล็ก', type:'free', category: 'other' },
      { name:'หมูกระจก', unit:'ถุง', type:'free', category: 'other' },
      { name:'ซอส', unit:'แกลลอน', type:'free', category: 'other' },
      { name:'น้ำมันกระเทียมเจียว', unit:'แกลลอน', type:'free', category: 'other' },
      { name:'เก๊กฮวย', unit:'ขวด', type:'free', category: 'other' },
      { name:'อัญชัน', unit:'ขวด', type:'free', category: 'other' },
      { name:'ชาไทย', unit:'ขวด', type:'free', category: 'other' }
    ];
    
    const nongTamleungClose = [
      { name:'น้ำมัน', unit:'แกลลอน', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ซีอิ๋วขาว', unit:'แกลลอน', category:'seasoning', icon:'🧂', type:'free' },
      { name:'น้ำส้มสายชู', unit:'แกลลอน', category:'seasoning', icon:'🧂', type:'free' },
      { name:'น้ำตาล', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'น้ำปลา', unit:'ขวด', category:'seasoning', icon:'🧂', type:'free' },
      { name:'รสดีเหลือง', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'รสดีเขียว', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'รสดีส้ม', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ผงชูรส', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'พริกป่น', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'น้ำมันหอย', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'หมูกระจก(ยังไม่ผัด)', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ผงเก๊กฮวย', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ผงอัญชัน', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ผงชาไทยตรามือ', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'ผงชาไทยยอดชา', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'นมข้นจืด', unit:'กระป๋อง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'เกลือ', unit:'ถุง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'น้ำมะนาว', unit:'ขวด', category:'seasoning', icon:'🧂', type:'free' },
      { name:'นมข้นหวาน', unit:'กระป๋อง', category:'seasoning', icon:'🧂', type:'free' },
      { name:'สติ๊กเกอร์อัญชัน', unit:'แผ่น', category:'packaging', icon:'📦', type:'fraction' },
      { name:'สติ๊กเกอร์เก๊กฮวย', unit:'แผ่น', category:'packaging', icon:'📦', type:'fraction' },
      { name:'สติ๊กเกอร์ชาไทย', unit:'แผ่น', category:'packaging', icon:'📦', type:'fraction' },
      { name:'ขวดน้ำ', unit:'', category:'packaging', icon:'📦', orderOnly:true }
    ];

    const branchNameStr = String(branch_id).toUpperCase();
    if (branchNameStr === 'BR005' || branchNameStr.includes('หนองตำลึง')) {
      return mode === 'open' ? nongTamleungOpen : nongTamleungClose;
    }
    
    return mode === 'open' ? openModeItemsBase : closeModeItemsBase;
}


module.exports={calcLateMin,calcOtMins,calcHoursWorked,haversine,getItemsListByMode};
