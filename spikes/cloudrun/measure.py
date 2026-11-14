from common import *
import concurrent.futures,statistics,time
STATE=json.loads((ROOT/'results/state.json').read_text())
IMAGES=json.loads((ROOT/'results/images.json').read_text())

def request(url,identity):
    # curl's timer excludes token issuance and process launch; stdin keeps bearer out of argv/files.
    fmt='\n{"total_s":%{time_total},"ttfb_s":%{time_starttransfer},"dns_s":%{time_namelookup},"tls_s":%{time_appconnect},"http":%{http_code}}'
    args=['curl','--silent','--show-error','--max-time','180','--config','-','--write-out',fmt,url+'/v1/recommend']
    p=subprocess.run(args,input='header = "Authorization: Bearer '+identity+'"\n',text=True,capture_output=True)
    if p.returncode:raise RuntimeError('HTTP transport failure '+clean(p.stderr))
    body,metrics=p.stdout.rsplit('\n',1);r=json.loads(metrics)
    if r['http']!=200:raise RuntimeError('unexpected HTTP '+str(r['http'])+': '+clean(body[:250]))
    payload=json.loads(body)
    assert payload['bytes']==1048576
    return {'total_ms':round(r['total_s']*1000,3),'ttfb_ms':round(r['ttfb_s']*1000,3),'dns_ms':round(r['dns_s']*1000,3),'tls_ms':round(r['tls_s']*1000,3),'http':r['http']}


def one(image,boost,index,identity):
    variant=image['variant'];service=STATE['repository']+'-'+variant
    suffix='u-'+('b' if boost else 'n')+f'{index:02d}'
    env='DATA_FILE=/app/data.bin,PORT_DUMMY=8080,SPIKE_SAMPLE='+suffix
    args=['run','deploy',service,'--image='+image['image'],'--region='+REGION,'--revision-suffix='+suffix,'--cpu=1','--memory=512Mi','--min-instances=0','--max-instances=1','--concurrency=1','--execution-environment=gen2','--cpu-throttling','--max=5','--no-traffic','--tag='+suffix,'--timeout=180','--no-allow-unauthenticated','--no-deploy-health-check','--cpu-boost' if boost else '--no-cpu-boost','--set-env-vars='+env,'--service-account='+STATE['runtime_sa']+'@'+PROJECT+'.iam.gserviceaccount.com','--format=json']
    deploy_start=now();p=gcloud(*args);obj=json.loads(p.stdout)
    revision=obj['status']['latestCreatedRevisionName'];url=next(t['url'] for t in obj['status']['traffic'] if t.get('tag')==suffix)
    first_started=now();cold=request(url,identity);warm=request(url,identity)
    return {'variant':variant,'cpu_boost':boost,'sample':index,'service':service,'revision':revision,'deploy_started_at':deploy_start,'first_request_started_at':first_started,'cold':cold,'warm':warm,'memory':'512Mi','vcpus':1,'url':url}

if __name__=='__main__':
    rows=json.loads((ROOT/'results/requests.json').read_text()) if (ROOT/'results/requests.json').exists() else []
    STATE['services']=[STATE['repository']+'-'+i['variant'] for i in IMAGES];write('state.json',STATE)
    # Independent services in each round, at most five concurrent deployments.
    for boost in (True,False):
        for index in range(1,11):
            pending=[i for i in IMAGES if not any(r['variant']==i['variant'] and r['cpu_boost']==boost and r['sample']==index for r in rows)]
            if not pending:continue
            identity=token('identity')
            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
                futures={pool.submit(one,i,boost,index,identity):i for i in pending}
                for f in concurrent.futures.as_completed(futures):
                    row=f.result();rows.append(row);write('requests.json',rows)
                    print(row['variant'],boost,index,row['cold']['total_ms'],row['warm']['total_ms'],flush=True)
    checks=[]
    for service in STATE['services']:
        policy=json.loads(gcloud('run','services','get-iam-policy',service,'--region='+REGION,'--format=json').stdout)
        public=any(m in ('allUsers','allAuthenticatedUsers') for b in policy.get('bindings',[]) for m in b.get('members',[]))
        if public:raise RuntimeError('unexpected public binding')
        url=next(r['url'] for r in rows if r['service']==service)
        status=subprocess.check_output(['curl','-s','-o','/dev/null','-w','%{http_code}',url+'/healthz'],text=True).strip()
        checks.append({'service':service,'public_iam_binding':public,'unauthenticated_http':int(status)})
    write('privacy-checks.json',checks)
