from common import *
state=json.loads((ROOT/'results/state.json').read_text());audit=[]
for service in state['services']:
 d=json.loads(gcloud('run','services','describe',service,'--region='+REGION,'--format=json').stdout)
 t=d['spec']['template'];a=t['metadata'].get('annotations',{});c=t['spec']['containers'][0]
 audit.append({'service':service,'latest_revision':d['status'].get('latestReadyRevisionName'),'revision_annotations':{k:a[k] for k in ('autoscaling.knative.dev/minScale','autoscaling.knative.dev/maxScale','run.googleapis.com/startup-cpu-boost','run.googleapis.com/execution-environment','run.googleapis.com/cpu-throttling') if k in a},'limits':c.get('resources',{}).get('limits'),'container_concurrency':t['spec'].get('containerConcurrency'),'image':c.get('image'),'tagged_revisions':len([x for x in d['status'].get('traffic',[]) if x.get('tag')]),'traffic_percent_for_measured_tags':sum(x.get('percent',0) for x in d['status'].get('traffic',[]) if x.get('tag','').startswith(('t-','u-')))})
write('configuration-audit.json',audit)
