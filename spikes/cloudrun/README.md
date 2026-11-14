# Seoul Cloud Run cold-start spike

Use only `banbanyeok-7eoxn` / `asia-northeast3`. Every SDK subprocess runs `export CLOUDSDK_ACTIVE_CONFIG_NAME=banbanyeok` before `gcloud`, and supplies the project explicitly. No application is made public. A temporary runtime service account has no data-access roles. The invoking developer's identity token is held in memory and token issuance occurs outside curl timing.

Prerequisites: existing Ktor installDist and Spring minimal/JDBC/JPA boot JARs, 1 MiB generated binary files from the earlier spike, local Docker buildx with amd64 support, authorized gcloud credentials. Run from this directory:

```sh
# For a fresh rerun after a completed cleanup, archive the previous measurements first:
# mv results "results-$(date +%Y%m%d-%H%M%S)"; mkdir results
python3 build.py
python3 measure.py
# Monitoring samples every 60s and can arrive up to 120s later.
# Collect after the last sample's ingestion window; repeat if revisions are missing.
python3 monitor.py
python3 logs.py
python3 prove-cold.py
python3 audit.py
python3 summarize.py
python3 cleanup.py
```

`build.py` creates a uniquely named Artifact Registry repository and a least-privilege runtime account, builds/pushes five linux/amd64 images, and records their IDs. It uses a temporary Docker credential directory under ignored `.private/`, then removes the credential directory. Cloud Build and GCS buckets are not used. Logs in `.private/` are temporary, uncommitted and deleted during cleanup; sanitized JSON only is retained under `results/`.

The Ktor AppCDS classpath is sorted once into `/app/classpath.txt` and used identically for training and runtime. A wildcard classpath had different enumeration order at build time and in Cloud Run, so the preflight failed and was corrected before the final cohort. Spring CDS uses Boot's extracted efficient layout and `spring.context.exit=onRefresh`. Archives are trained by the same image OS/JDK/classpath on amd64, not copied from macOS. Every CDS runtime uses `-Xshare:on`.

All images preload 1,048,576 bytes and run `-Xms32m -Xmx256m`. Spring uses virtual threads. `offline.properties` disables Flyway startup execution, SQL init, Hibernate metadata access, schema generation/validation and DB health probing; JDBC dialect is PostgreSQL explicitly, as is Hibernate dialect. Hikari has minimumIdle=0 and initializationFailTimeout=-1, so no eager connection attempt is needed. Hibernate entity/repository/EntityManagerFactory initialization remains active. The DB and migration cost is excluded deliberately. No datasource/JPA auto-configuration exclusion is used.

Cloud Run uses gen2, min 0, 1 vCPU, 512 MiB, request-based CPU throttling, per-revision max 1, service max 5, startup CPU boost both on and off. Five independent services are measured concurrently per round. Each boost condition has ten new revisions and one first cold request + one immediately following warm request per revision. All calls are from the same Mac, using fresh curl connections and `/v1/recommend`; curl `time_total` includes DNS/TLS/network and response body, not token generation or gcloud deploy time.

Cold forcing: unique environment value + **new revision with `--no-traffic --tag=<unique>` and `--no-deploy-health-check`**, then call that new tag URL first. The ordinary service URL is not used for timing. Merely turning off the deployment health check while switching normal traffic still caused deployment/autoscaler prewarming in the discarded `rollout-preflight.json` cohort. Tagged, zero-traffic revisions avoid that route-shift prewarming; startup logs are joined by revision to confirm this. Preflight data is not included in final percentiles.

The exact metric is `run.googleapis.com/container/startup_latencies`, milliseconds, 60s sample period / 120s ingest delay according to its descriptor. `monitor.py` retrieves raw per-revision distributions. `summarize.py` joins only final measured revision names, computes the count-weighted per-revision startup mean and reports its median/p90 separately from client latency. The client median uses the middle-pair average; p90 uses nearest-rank (n=10 -> ninth sorted observation). Startup metric count is retained, so multiple starts are not silently treated as a single point.

Authentication tokens, local filesystem paths, usernames and email addresses are not written into result JSON. The sanitizer/assertion rejects those patterns. Full Cloud Run service/IAM/log resources are filtered in memory before saving. `privacy-checks.json` records only whether public IAM bindings exist and unauthenticated HTTP status.

Cleanup deletes all services (including revisions/tags), the repository (including all images), and the dedicated runtime service account. `cleanup.json` includes NOT_FOUND confirmations for Run/Artifact Registry and successful service-account deletion plus an empty active-account list; no bucket was created. The cleanup script operates only on exact names recorded by this run. Do not declare the spike complete until cleanup confirmation passes.
