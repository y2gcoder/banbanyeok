"""Fresh-process wall time + RSS (not heap). No forced GC; database connections only with --database."""
import json, os, pathlib, re, shutil, subprocess, time, urllib.request
ROOT=pathlib.Path(__file__).resolve().parent
RESULTS=ROOT.parent/'results'
os.chdir(ROOT)
for size in (133120,1048576):
    (ROOT/'data').mkdir(exist_ok=True)
    (ROOT/f'data/{size}.bin').write_bytes(bytes(range(256))*(size//256))
JAVA=['java','-Xms32m','-Xmx256m']
ENV_EXTRA={}
PROPS=['-Dspring.threads.virtual.enabled=true','-Dserver.port=18080']

def sample(command,cwd,label,size,index,expect_virtual=True):
    env=dict(os.environ,**ENV_EXTRA,DATA_FILE=str(ROOT/f'data/{size}.bin'),PORT='18080')
    logfile=RESULTS/f'spring-{label}-{size}-{index}.log'
    with logfile.open('w') as log:
        start=time.perf_counter()
        p=subprocess.Popen(command,cwd=cwd,env=env,stdout=log,stderr=log)
        result={}
        try:
            while time.perf_counter()-start<30:
                if p.poll() is not None:
                    result={'status':'failed','exit_code':p.returncode,'elapsed_ms':round((time.perf_counter()-start)*1000,3)};break
                try:
                    with urllib.request.urlopen('http://127.0.0.1:18080/healthz',timeout=.2) as r:
                        health=r.read().decode();virtual=r.headers.get('X-Virtual-Thread')
                    elapsed=(time.perf_counter()-start)*1000
                    assert health==f'ok:{size}',health
                    if expect_virtual: assert virtual=='true',virtual
                    rss=int(subprocess.check_output(['ps','-o','rss=','-p',str(p.pid)],text=True).strip())*1024
                    with urllib.request.urlopen('http://127.0.0.1:18080/v1/recommend',timeout=2) as r: recommendation=json.load(r)
                    assert recommendation['bytes']==size
                    heap=subprocess.check_output(['jcmd',str(p.pid),'GC.heap_info'],text=True)
                    match=re.search(r'heap\s+total(?: reserved \d+K,)?\s+(?:committed )?(\d+)K,\s+used\s+(\d+)K',heap)
                    result={'status':'ok','first_ms':round(elapsed,3),'rss_bytes':rss,'heap_used_bytes':int(match[2])*1024 if match else None,'heap_committed_bytes':int(match[1])*1024 if match else None,'virtual_thread':virtual}
                    break
                except (OSError,urllib.error.URLError): time.sleep(.005)
            else: result={'status':'timeout'}
        finally:
            if p.poll() is None: p.terminate()
            p.wait(timeout=15)
    if result['status']!='ok':
        text=logfile.read_text()
        result['error_tail']=text[-2500:]
    return result

def group(command,cwd,label):
    rows=[]
    for size in (133120,1048576):
        samples=[sample(command,cwd,label,size,i,expect_virtual=not label.startswith('ktor')) for i in range(5)]
        ok=[s for s in samples if s['status']=='ok']
        row={'variant':label,'bytes':size,'command':command,'cwd':str(cwd),'samples':samples}
        for key in ('first_ms','rss_bytes','heap_used_bytes','heap_committed_bytes'):
            vals=[s[key] for s in ok if s[key] is not None]
            row['mean_'+key]=round(sum(vals)/len(vals),3) if vals else None
        rows.append(row)
        print(label,size,row['mean_first_ms'],row['mean_rss_bytes'],flush=True)
    return rows

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('--aot',action='store_true');ap.add_argument('--ktor',action='store_true');ap.add_argument('--project');ap.add_argument('--database',action='store_true');args=ap.parse_args()
    rows=[]
    if args.database:
        ENV_EXTRA.update(SPRING_DATASOURCE_URL='jdbc:postgresql://127.0.0.1:18543/spike',SPRING_DATASOURCE_USERNAME='spike',SPRING_DATASOURCE_PASSWORD='local-spike-only',SPRING_JPA_HIBERNATE_DDL_AUTO='validate',SPRING_JPA_OPEN_IN_VIEW='false')
        warmup=sample(JAVA+PROPS+['-jar',str(ROOT/'jdbc/build/libs/app.jar')],ROOT,'database-warmup',133120,0)
        if warmup['status']!='ok': raise RuntimeError(warmup)
    if args.ktor:
        root=ROOT.parent/'ktor'
        cp=':'.join(str(p.resolve()) for p in sorted((root/'build/install/ktor-startup/lib').glob('*.jar')))
        for mode,flags in [('default',[]),('cds',['-Xshare:on',f'-XX:SharedArchiveFile={root}/build/appcds.jsa'])]:
            rows+=group(JAVA+flags+['-cp',cp,'MainKt'],root,'ktor-'+mode)
        outfile='spring-ktor-memory.json'
    else:
        for project in ((args.project,) if args.project else ('jdbc','jpa') if args.database else ('minimal','full')):
            if args.aot:
                jar=ROOT/project/'build-aot/libs/app.jar'
                if jar.exists():
                    flags=['-Dspring.aot.enabled=true']+(['-Dspring.main.lazy-initialization=true'] if project=='full' else [])
                    rows+=group(JAVA+PROPS+flags+['-jar',str(jar)],ROOT,project+'-aot')
                continue
            jar=ROOT/project/'build/libs/app.jar'
            rows+=group(JAVA+PROPS+['-jar',str(jar)],ROOT,project+'-fatjar-default')
            lazy=['-Dspring.main.lazy-initialization=true'] if project=='full' else []
            if lazy: rows+=group(JAVA+PROPS+lazy+['-jar',str(jar)],ROOT,project+'-fatjar-lazy')
            extracted=ROOT/project/'build/extracted'
            if extracted.exists(): shutil.rmtree(extracted)
            subprocess.run(['java','-Djarmode=tools','-jar',str(jar),'extract','--destination',str(extracted)],check=True)
            # Same extracted efficient layout for the paired baseline/CDS comparison.
            rows+=group(JAVA+PROPS+lazy+['-jar','app.jar'],extracted,project+'-extracted-default')
            with (RESULTS/f'spring-{project}-training.log').open('w') as log:
                train=subprocess.run(JAVA+PROPS+lazy+['-XX:ArchiveClassesAtExit=application.jsa','-Dspring.context.exit=onRefresh','-jar','app.jar'],cwd=extracted,env=dict(os.environ,**ENV_EXTRA,DATA_FILE=str(ROOT/'data/133120.bin')),stdout=log,stderr=log)
            if train.returncode==0 and (extracted/'application.jsa').exists():
                rows+=group(JAVA+PROPS+lazy+['-Xshare:on','-XX:SharedArchiveFile=application.jsa','-jar','app.jar'],extracted,project+'-cds')
            else: rows.append({'variant':project+'-cds-training','status':'failed','exit_code':train.returncode})
        outfile='spring-aot-database.json' if args.aot and args.database else 'spring-aot.json' if args.aot else 'spring-database.json' if args.database else f'spring-{args.project}.json' if args.project else 'spring-startup.json'
    (RESULTS/outfile).write_text(json.dumps(rows,indent=2)+'\n')
