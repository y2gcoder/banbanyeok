from common import *
rows=json.loads((ROOT/'results/requests.json').read_text());logs=json.loads((ROOT/'results/startup-logs.json').read_text());proof=[]
for r in rows:
 events=[e for e in logs if e['revision']==r['revision'] and 'Starting new instance' in e['text']]
 first=datetime.datetime.fromisoformat(r['first_request_started_at'].replace('Z','+00:00'))
 ds=[(datetime.datetime.fromisoformat(e['timestamp'].replace('Z','+00:00'))-first).total_seconds()*1000 for e in events]
 proof.append({'revision':r['revision'],'start_log_count':len(events),'start_after_request_ms':ds,'deployment_rollout':any('DEPLOYMENT_ROLLOUT' in e['text'] for e in events)})
write('cold-proof.json',proof)
print('Measured / with startup log:',len(proof),sum(bool(p['start_log_count']) for p in proof))
if any(any(d< -150 for d in p['start_after_request_ms']) or p['deployment_rollout'] for p in proof):raise RuntimeError('prewarming found')
