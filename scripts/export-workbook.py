"""Read-only conversion. No source rows are printed. Never commit generated JSON.
Usage: python scripts/export-workbook.py source.xlsx private/import.json
Requires openpyxl. The output excludes PINs and integration secrets by default.
"""
import sys,json,datetime,re,hashlib
from pathlib import Path
import openpyxl
source,dest=map(Path,sys.argv[1:3])
schema=json.loads((Path(__file__).parent/'schema.json').read_text())
book=openpyxl.load_workbook(source,read_only=True,data_only=True)
result={};warnings=[]
date_fields={'date','period_start','period_end','pay_date'}
stamp_fields={'created_at','checked_at','paid_at','completed_at','last_updated'}
safe_settings={'shift_morning_start','shift_morning_end','shift_night_start','shift_night_end','late_grace_min','ot_grace_min','ot_rate_per_hour','gps_block_on_fail','allow_cross_branch'}
for sheet in book:
    rows=list(sheet.values);headers=rows[0];records=[]
    for index,row in enumerate(rows[1:],2):
        if not any(x is not None for x in row):continue
        obj={}
        for h,v in zip(headers,row):
            if h not in schema[sheet.title] or h=='pin':continue
            if isinstance(v,(datetime.datetime,datetime.date,datetime.time)):
                if h in date_fields:v=v.strftime('%Y-%m-%d')
                elif h in stamp_fields and isinstance(v,datetime.datetime):
                    v=v.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=7))).astimezone(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
                else:v=v.strftime('%H:%M')
            if v is None:v=''
            if h=='role' and v=='satff':v='staff';warnings.append('Normalized misspelled staff role')
            if h.endswith('_id') or h=='bank_account':v=str(v)
            if h in stamp_fields and isinstance(v,str) and v:
                try:
                    parsed=datetime.datetime.fromisoformat(v.replace('Z','+00:00'))
                    if parsed.tzinfo is None:parsed=parsed.replace(tzinfo=datetime.timezone(datetime.timedelta(hours=7)))
                    v=parsed.astimezone(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
                except ValueError:raise ValueError(f'Invalid timestamp: {sheet.title} row {index} field {h}')
            if h.endswith('_json') and v:
                json.loads(v)
            obj[h]=v
        if sheet.title=='settings' and obj.get('key') not in safe_settings:continue
        obj['_import_row']=index
        records.append(obj)
    result[sheet.title]=records
dest.parent.mkdir(parents=True,exist_ok=True)
dest.write_text(json.dumps({'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'tables':result},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'counts':{k:len(v) for k,v in result.items()},'warnings':sorted(set(warnings))}))
