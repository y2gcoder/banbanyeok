from common import *
import time
state=json.loads((ROOT/'results/state.json').read_text())
access=token()
metric='run.googleapis.com/container/startup_latencies'
try:
    desc=api('https://monitoring.googleapis.com/v3/projects/'+PROJECT+'/metricDescriptors/'+metric,access)
    write('metric-descriptor.json',{k:desc[k] for k in ('type','metricKind','valueType','unit','description','metadata') if k in desc})
except Exception as e:write('monitor-error.json',{'error':clean(str(e))});raise
series=[];page=None;query_end=now()
while True:
    params={'filter':f'metric.type="{metric}" AND resource.type="cloud_run_revision"','interval.startTime':state['started_at'],'interval.endTime':query_end,'pageSize':1000,'view':'FULL'}
    if page:params['pageToken']=page
    d=api('https://monitoring.googleapis.com/v3/projects/'+PROJECT+'/timeSeries?'+urllib.parse.urlencode(params),access)
    for s in d.get('timeSeries',[]):
        labels=s.get('resource',{}).get('labels',{})
        if labels.get('service_name','').startswith(state['repository']):
            series.append({'service':labels.get('service_name'),'revision':labels.get('revision_name'),'unit':s.get('unit'),'metric_labels':s.get('metric',{}).get('labels',{}),'points':s.get('points',[])})
    page=d.get('nextPageToken')
    if not page:break
write('startup-latencies.json',{'collected_at':now(),'metric':metric,'series':series})
print('Startup metric revisions:',len(set(s['revision'] for s in series)))
