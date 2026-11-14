from common import *
import shutil,time
state_path=ROOT/'results/state.json'
if state_path.exists():state=json.loads(state_path.read_text())
else:
    run_id=datetime.datetime.now(datetime.timezone.utc).strftime('%m%d%H%M')
    name='spike-cold-'+run_id
    state={'project':PROJECT,'region':REGION,'repository':name,'runtime_sa':name,'services':[],'started_at':now(),'data_bytes':1048576}
    write('state.json',state)
    gcloud('artifacts','repositories','create',name,'--repository-format=docker','--location='+REGION)
    gcloud('iam','service-accounts','create',name,'--display-name=Temporary cold-start spike runtime')
registry=f'{REGION}-docker.pkg.dev'
config=ROOT/'.private/docker';config.mkdir(parents=True,exist_ok=True)
endpoint=subprocess.check_output(['docker','context','inspect','--format','{{.Endpoints.docker.Host}}'],text=True).strip()
env=dict(os.environ,DOCKER_CONFIG=str(config),DOCKER_HOST=endpoint)
try:
    subprocess.run(['docker','login','-u','oauth2accesstoken','--password-stdin',registry],input=token(),text=True,env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    images=[]
    for variant,config_name,target in [('ktor','', 'base'),('ktor-cds','','cds'),('mvc','minimal',''),('jdbc','jdbc',''),('jpa','jpa','')]:
        image=f'{registry}/{PROJECT}/{state["repository"]}/{variant}:measured'
        args=['docker','buildx','build','--builder','desktop-linux','--platform','linux/amd64','--load','-t',image]
        # Build through the existing Docker context; credentials are used only for push.
        if variant.startswith('ktor'):args+=['-f','cloudrun/Dockerfile.ktor','--target',target]
        else:args+=['-f','cloudrun/Dockerfile.spring','--build-arg','CONFIG='+config_name]
        args+=['.']
        print('Building',variant,flush=True)
        p=subprocess.run(args,cwd=ROOT.parent,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        (ROOT/'.private'/f'build-{variant}.log').write_text(p.stdout)
        if p.returncode:raise RuntimeError('build failed '+variant+': '+clean(p.stdout[-2500:]))
        info=json.loads(subprocess.check_output(['docker','image','inspect',image]))[0]
        if info['Architecture']!='amd64':raise RuntimeError('wrong architecture')
        subprocess.run(['docker','push',image],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        images.append({'variant':variant,'image':image,'architecture':info['Architecture'],'os':info['Os'],'local_size_bytes':info['Size'],'image_id':info['Id']})
        write('images.json',images)
        print('Pushed',variant,flush=True)
finally:
    shutil.rmtree(config,ignore_errors=True)
