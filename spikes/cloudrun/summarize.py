from common import *
import math,statistics
rows=json.loads((ROOT/'results/requests.json').read_text())
series=json.loads((ROOT/'results/startup-latencies.json').read_text())['series']
logs=json.loads((ROOT/'results/startup-logs.json').read_text()) if (ROOT/'results/startup-logs.json').exists() else []
summary=[]
def p90(v):return sorted(v)[math.ceil(.9*len(v))-1]
for boost in (True,False):
 for variant in ('ktor','ktor-cds','mvc','jdbc','jpa'):
  cohort=[r for r in rows if r['cpu_boost']==boost and r['variant']==variant]
  if not cohort:continue
  startup=[]
  for r in cohort:
   points=[p for s in series if s['revision']==r['revision'] for p in s['points']]
   ds=[p['value']['distributionValue'] for p in points if 'distributionValue' in p.get('value',{})]
   ds=[d for d in ds if int(d.get('count',0))>0]
   count=sum(int(d['count']) for d in ds)
   if count:
    value=sum(d['mean']*int(d['count']) for d in ds)/count
    startup.append(value)
    r['monitoring_startup_ms']=value;r['monitoring_startup_count']=count;r['monitoring_status']='observed'
   else:
    r['monitoring_startup_ms']=None;r['monitoring_startup_count']=0;r['monitoring_status']='no_nonzero_distribution' 
   events=[e for e in logs if e.get('revision')==r['revision'] and 'Starting new instance' in e['text']]
   r['instance_start_events']=events
  cold=[r['cold']['total_ms'] for r in cohort];warm=[r['warm']['total_ms'] for r in cohort]
  item={'variant':variant,'cpu_boost':boost,'cold_n':len(cold),'warm_n':len(warm),'cold_p50_ms':statistics.median(cold),'cold_p90_ms':p90(cold),'warm_p50_ms':statistics.median(warm),'cold_over_3s_count':sum(v>3000 for v in cold),'meets_3s_p90':p90(cold)<=3000,'monitoring_revision_n':len(startup),'monitoring_startup_p50_ms':statistics.median(startup) if startup else None,'monitoring_startup_p90_ms':p90(startup) if startup else None}
  summary.append(item)
write('requests.json',rows);write('summary.json',summary)
for r in summary:print(r)
