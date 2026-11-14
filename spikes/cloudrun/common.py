import json,os,pathlib,re,subprocess,urllib.request,urllib.parse,datetime
ROOT=pathlib.Path(__file__).resolve().parent
PROJECT='banbanyeok-7eoxn';REGION='asia-northeast3'

def gcloud(*args,check=True):
    # Every invocation explicitly selects the authorized named configuration.
    p=subprocess.run(['bash','-c','export CLOUDSDK_ACTIVE_CONFIG_NAME=banbanyeok; exec gcloud "$@"','gcloud',*args,'--project='+PROJECT,'--quiet'],capture_output=True,text=True)
    if check and p.returncode: raise RuntimeError(clean(p.stderr))
    return p

def clean(s):
    s=re.sub(r'[\w.+-]+@[\w.-]+','[redacted-email]',s)
    s=re.sub(r'/Users/[^\s\"\']+','[redacted-local-path]',s)
    s=re.sub(r'eyJ[A-Za-z0-9_.-]+','[redacted-token]',s)
    return s

def write(name,value):
    text=json.dumps(value,indent=2,ensure_ascii=False)+'\n'
    if re.search(r'/Users/|[\w.+-]+@[\w.-]+|eyJ[A-Za-z0-9_.-]+',text):raise ValueError('result contains restricted identifiers')
    (ROOT/'results'/name).write_text(text)

def token(kind='access'):
    return gcloud('auth','print-'+('identity-token' if kind=='identity' else 'access-token')).stdout.strip()

def api(url,access):
    req=urllib.request.Request(url,headers={'Authorization':'Bearer '+access})
    with urllib.request.urlopen(req,timeout=60) as r:return json.load(r)

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
