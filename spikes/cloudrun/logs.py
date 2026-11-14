from common import *
state=json.loads((ROOT/'results/state.json').read_text())
filter='resource.type="cloud_run_revision" AND resource.labels.service_name:"'+state['repository']+'" AND timestamp>="'+state['started_at']+'"'
filter+=' AND (textPayload:"Starting new instance" OR textPayload:"STARTUP TCP probe succeeded" OR textPayload:"Started ApplicationKt" OR textPayload:"Hibernate ORM core" OR textPayload:"Unable to use shared archive" OR textPayload:"HikariPool" OR textPayload:"Responding at")'
data=json.loads(gcloud('logging','read',filter,'--limit=5000','--order=asc','--format=json').stdout)
rows=[]
for entry in data:
    labels=entry.get('resource',{}).get('labels',{})
    text=entry.get('textPayload','')
    # Select startup events only; no IAM metadata, identities, access tokens, local paths.
    if any(s in text for s in ('Starting new instance','startup TCP probe succeeded','Started Application','Hibernate ORM','HikariPool','OutOfMemory','SharedArchive','archive','JVM','Netty started','Responding at')):
        rows.append({'timestamp':entry.get('timestamp'),'service':labels.get('service_name'),'revision':labels.get('revision_name'),'text':clean(text)})
write('startup-logs.json',rows)
print('Sanitized startup events:',len(rows))
