const test=require('node:test'),assert=require('node:assert/strict');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {spawnSync}=require('node:child_process');
function check(tables,extra=[]){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'easy-import-'));const file=path.join(dir,'input.json');fs.writeFileSync(file,JSON.stringify({source_sha256:'synthetic',tables}));try{return spawnSync(process.execPath,[path.resolve(__dirname,'../../scripts/import-data.cjs'),file,...extra],{encoding:'utf8',env:{...process.env,GCLOUD_PROJECT:'demo-easy-backoffice',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'}});}finally{fs.unlinkSync(file);fs.rmdirSync(dir);}}
test('import refuses duplicate timesheet IDs unless explicit remap preserves both rows',()=>{
 const tables={staff:[{staff_id:'S1'}],timesheets:[{record_id:'TS1',staff_id:'S1',_import_row:2},{record_id:'TS1',staff_id:'S1',_import_row:3}]};
 assert.notEqual(check(tables).status,0);const ok=check(tables,['--remap-duplicate-timesheet-ids']);assert.equal(ok.status,0,ok.stderr);assert.equal(JSON.parse(ok.stdout).counts.timesheets,2);
});
test('import refuses missing staff relationships',()=>{const r=check({staff:[],payroll_runs:[{run_id:'P1',staff_id:'MISSING'}]});assert.notEqual(r.status,0);assert.match(r.stderr,/Orphan staff/);});
test('import refuses credential fields',()=>{const r=check({staff:[{staff_id:'S1',pin:'1234'}]});assert.notEqual(r.status,0);assert.match(r.stderr,/Secret field/);});
