"""Build/verify local fat-jar and efficient-layout/CDS images; PostgreSQL must be running."""
import json, pathlib, subprocess, time, urllib.request
root=pathlib.Path(__file__).resolve().parent
results=[]
for config in ('minimal','full','jdbc','jpa'):
    variants=('fatjar',) if config=='full' else ('fatjar','extracted','cds')
    for variant in variants:
        tag=f'banbanyeok-s0b-spring-{config}-{variant}'
        args=['docker','build','--build-arg',f'CONFIG={config}','-t',tag]
        if variant!='fatjar': args+=['-f','Dockerfile.cds','--target','baseline' if variant=='extracted' else 'cds']
        args+=['.']
        with (root.parent/f'results/spring-docker-{config}-{variant}.log').open('w') as log:
            r=subprocess.run(args,cwd=root,stdout=log,stderr=log)
        row={'config':config,'variant':variant,'tag':tag,'build_exit':r.returncode}
        if r.returncode==0:
            info=json.loads(subprocess.check_output(['docker','image','inspect',tag]))[0]
            row.update(bytes=info['Size'],image_id=info['Id'],platform=f"{info['Os']}/{info['Architecture']}")
        results.append(row)
        print(row,flush=True)
        (root.parent/'results/spring-images.json').write_text(json.dumps(results,indent=2)+'\n')

checks=[]
for config in ('minimal','jdbc','jpa'):
    tag=f'banbanyeok-s0b-spring-{config}-cds'
    command=['docker','run','--rm','-d','--name','banbanyeok-spring-check','-p','127.0.0.1:18081:8080']
    if config!='minimal':
        for entry in ('SPRING_DATASOURCE_URL=jdbc:postgresql://host.docker.internal:18543/spike','SPRING_DATASOURCE_USERNAME=spike','SPRING_DATASOURCE_PASSWORD=local-spike-only','SPRING_JPA_HIBERNATE_DDL_AUTO=validate','SPRING_JPA_OPEN_IN_VIEW=false'):
            command+=['-e',entry]
    command+=[tag]
    subprocess.run(command,check=True,stdout=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                with urllib.request.urlopen('http://127.0.0.1:18081/healthz',timeout=.5) as r:
                    body=r.read().decode();virtual=r.headers.get('X-Virtual-Thread')
                assert body=='ok:133120' and virtual=='true'
                with urllib.request.urlopen('http://127.0.0.1:18081/v1/recommend',timeout=2) as r: assert json.load(r)['bytes']==133120
                checks.append({'config':config,'health':body,'virtual_thread':virtual,'cds':'-Xshare:on'})
                break
            except OSError: time.sleep(.1)
        else: raise RuntimeError(f'container health failed: {tag}')
    finally:
        with (root.parent/f'results/spring-docker-check-{config}.log').open('w') as log:
            subprocess.run(['docker','logs','banbanyeok-spring-check'],stdout=log,stderr=log)
        subprocess.run(['docker','stop','banbanyeok-spring-check'],stdout=subprocess.DEVNULL)
(root.parent/'results/spring-docker-checks.json').write_text(json.dumps(checks,indent=2)+'\n')
sizes={}
for config in ('minimal','full','jdbc','jpa'):
    sizes[config]={'fatjar_bytes':(root/config/'build/libs/app.jar').stat().st_size}
    for path,key in [(root/config/'build-aot/libs/app.jar','aot_fatjar_bytes'),(root/config/'build/extracted/application.jsa','macos_cds_bytes')]:
        if path.exists() and not (config=='full' and key=='macos_cds_bytes'):sizes[config][key]=path.stat().st_size
for config in ('minimal','jdbc','jpa'):
    sizes[config]['linux_cds_bytes']=int(subprocess.check_output(['docker','run','--rm','--entrypoint','stat',f'banbanyeok-s0b-spring-{config}-cds','-c','%s','/app/application.jsa']))
(root.parent/'results/spring-artifact-sizes.json').write_text(json.dumps(sizes,indent=2)+'\n')
