// Dry-run by default. Import creates documents and refuses to overwrite existing records.
const fs=require('node:fs');const backendRequire=require('node:module').createRequire(require('node:path').resolve(__dirname,'../functions/package.json'));const {initializeApp}=backendRequire('firebase-admin/app');
const {getFirestore}=backendRequire('firebase-admin/firestore');
const {ids}=require('../functions/src/domain.cjs');const {hash,key}=require('../functions/src/store.cjs');
const args=process.argv.slice(2),apply=args.includes('--apply'),remap=args.includes('--remap-duplicate-timesheet-ids'),file=args.find(a=>!a.startsWith('--'));
const project=process.env.GCLOUD_PROJECT;
if(!project||!(project.startsWith('demo-')||project==='easy-backoffice-staging'))throw Error('Only the demo or named staging project is allowed');
if(project.startsWith('demo-')&&!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Emulator host required');
const payload=JSON.parse(fs.readFileSync(file,'utf8'));
const known=new Set(Object.keys(require('./schema.json'))),all=[],seen=new Set();
for(const [collection,rows] of Object.entries(payload.tables)){
 if(!known.has(collection))throw Error('Unknown collection');
 for(const raw of rows){
  const {_import_row,...data}=raw;
  if(Object.keys(data).some(k=>/pin|token|secret/i.test(k)))throw Error('Secret field in import');
  if(collection==='settings'&&!require('../functions/src/domain.cjs').safeSettings.has(data.key))throw Error('Private setting');
  const idField=ids[collection]||({inventory:'item_id',driver_tasks:'task_id'}[collection]);
  const id=idField?String(data[idField]||''):'import_'+hash(collection+':'+payload.source_sha256+':'+_import_row);
  // Source driver_jobs has no job_id. Give such rows a deterministic import identity.
  let resolved=id||'import_'+hash(collection+':'+payload.source_sha256+':'+_import_row);
  if(collection==='timesheets'&&remap&&seen.has(collection+'/'+key(collection,resolved))){data.legacy_record_id=resolved;resolved=resolved+'_row'+_import_row;}
  if(idField)data[idField]=resolved;
  const path=collection+'/'+key(collection,resolved);
  if(seen.has(path))throw Error('Duplicate document identity in '+collection);seen.add(path);all.push({path,data});
 }
}
const staffIds=new Set(all.filter(x=>x.path.startsWith('staff/')).map(x=>x.data.staff_id));
for(const row of all)if(['timesheets','advances','payroll_runs'].includes(row.path.split('/')[0])&&!staffIds.has(row.data.staff_id))throw Error('Orphan staff reference in '+row.path.split('/')[0]);
console.log(JSON.stringify({mode:apply?'apply':'dry-run',project,counts:Object.fromEntries(Object.keys(payload.tables).map(k=>[k,all.filter(x=>x.path.startsWith(k+'/')).length]))}));
if(apply)(async()=>{
 initializeApp({projectId:project});const db=getFirestore();
 // Preflight all destinations before any write. Use a fresh empty staging database.
 for(let i=0;i<all.length;i+=200){const docs=await db.getAll(...all.slice(i,i+200).map(r=>db.doc(r.path)));if(docs.some(d=>d.exists))throw Error('Destination is not empty. No import writes started.');}
 for(let i=0;i<all.length;i+=200){const batch=db.batch();for(const r of all.slice(i,i+200))batch.create(db.doc(r.path),r.data);await batch.commit();}
 console.log('Imported '+all.length+' records. Import is multi-batch: reconcile counts before use.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
