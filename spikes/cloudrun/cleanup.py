from common import *
import shutil
state=json.loads((ROOT/'results/state.json').read_text())
checks=[]
for service in state.get('services',[]):
    r=gcloud('run','services','delete',service,'--region='+REGION,check=False)
    confirm=gcloud('run','services','describe',service,'--region='+REGION,'--format=value(metadata.name)',check=False)
    checks.append({'resource':'cloud_run_service','name':service,'delete_exit':r.returncode,'confirmed_not_found':confirm.returncode!=0 and ('NOT_FOUND' in confirm.stderr or 'Cannot find' in confirm.stderr)})
r=gcloud('artifacts','repositories','delete',state['repository'],'--location='+REGION,check=False)
c=gcloud('artifacts','repositories','describe',state['repository'],'--location='+REGION,check=False)
checks.append({'resource':'artifact_registry_repository_and_images','name':state['repository'],'delete_exit':r.returncode,'confirmed_not_found':c.returncode!=0 and 'NOT_FOUND' in c.stderr})
r=gcloud('iam','service-accounts','delete',state['runtime_sa']+'@'+PROJECT+'.iam.gserviceaccount.com',check=False)
c=gcloud('iam','service-accounts','describe',state['runtime_sa']+'@'+PROJECT+'.iam.gserviceaccount.com',check=False)
active=gcloud('iam','service-accounts','list','--filter=email='+state['runtime_sa']+'@'+PROJECT+'.iam.gserviceaccount.com','--format=value(uniqueId)')
checks.append({'resource':'runtime_service_account','name':state['runtime_sa'],'delete_exit':r.returncode,'confirmed_not_found':not active.stdout.strip() and c.returncode!=0,'confirmation':'successful deletion and zero matching active accounts; describe may return permission denied for a deleted account'})
checks.append({'resource':'storage_bucket','created':False,'reason':'Local Docker build/push; Cloud Build and GCS not used'})
write('cleanup.json',{'completed_at':now(),'checks':checks})
# Includes temporary Docker credentials and unsanitized build logs, never retained as results.
shutil.rmtree(ROOT/'.private',ignore_errors=True)
if not all(c.get('confirmed_not_found',not c.get('created',True)) for c in checks):raise RuntimeError('cleanup confirmation incomplete')
print('All created remote resources confirmed deleted.')
