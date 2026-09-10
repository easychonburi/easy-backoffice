// Use a test-only PIN supplied through the environment, never a command argument or source file.
const backendRequire=require('node:module').createRequire(require('node:path').resolve(__dirname,'../functions/package.json'));
const {initializeApp}=backendRequire('firebase-admin/app');const {getFirestore}=backendRequire('firebase-admin/firestore');
const {hashPin}=require('../functions/src/auth.cjs');
const project=process.env.GCLOUD_PROJECT,staffId=process.env.EASY_STAFF_ID,pin=process.env.EASY_TEST_PIN;
if(project!=='easy-backoffice-staging'&&project!=='demo-easy-backoffice')throw Error('Staging only');
if(project.startsWith('demo-')&&!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Emulator required');
if(!/^[A-Za-z0-9_-]+$/.test(staffId||'')||!/^\d{4}$/.test(pin||''))throw Error('Set EASY_STAFF_ID and EASY_TEST_PIN');
initializeApp({projectId:project});
(async()=>{const db=getFirestore();if(!(await db.doc('staff/'+staffId).get()).exists)throw Error('Staff does not exist');await db.doc('credentials/'+staffId).create(hashPin(pin));console.log('Test credential created');})().catch(e=>{console.error(e.message);process.exitCode=1;});
