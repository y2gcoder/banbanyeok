"""Fresh JVM each sample; OS caches remain warm. Run after gradle installDist."""
import json, os, pathlib, subprocess, time, urllib.request
root = pathlib.Path(__file__).resolve().parent
os.chdir(root)
(root/'data').mkdir(exist_ok=True)
for size in [130*1024,1024*1024]:
    (root/f'data/{size}.bin').write_bytes(bytes(range(256))*(size//256))
classpath = ':'.join(str(p.resolve()) for p in sorted((root/'build/install/ktor-startup/lib').glob('*.jar')))
results = []

def run(size, flags, label):
    env = dict(os.environ, DATA_FILE=str(root/f'data/{size}.bin'), PORT='18080')
    with open(root/f'../results/ktor-{label}-{size}.log','w') as log:
        start=time.perf_counter()
        p=subprocess.Popen(['java','-Xms32m','-Xmx256m',*flags,'-cp',classpath,'MainKt'],env=env,stdout=log,stderr=log)
        try:
            deadline=start+30
            while time.perf_counter()<deadline:
                if p.poll() is not None: raise RuntimeError(f'JVM exited: {p.returncode}')
                try:
                    with urllib.request.urlopen('http://127.0.0.1:18080/healthz',timeout=.2) as r: health=r.read().decode()
                    first=(time.perf_counter()-start)*1000
                    with urllib.request.urlopen('http://127.0.0.1:18080/v1/recommend',timeout=1) as r: recommendation=json.load(r)
                    assert health==f'ok:{size}' and recommendation['bytes']==size
                    return round(first,3)
                except OSError: time.sleep(.005)
            raise TimeoutError('30 seconds')
        finally:
            p.terminate();p.wait(timeout=10)

# Train on the same health + recommend workload, then use archive in fresh processes.
archive=str(root/'build/appcds.jsa')
run(133120,[f'-XX:ArchiveClassesAtExit={archive}'],'training')
for label,flags in [('default',[]),('appcds',['-Xshare:on',f'-XX:SharedArchiveFile={archive}'])]:
    for size in [133120,1048576]:
        samples=[run(size,flags,label) for _ in range(5)]
        results.append(dict(mode=label,bytes=size,samples_ms=samples,mean_ms=round(sum(samples)/len(samples),3)))
print(json.dumps(results,indent=2))
(root/'../results/ktor-startup.json').write_text(json.dumps(results,indent=2)+'\n')
