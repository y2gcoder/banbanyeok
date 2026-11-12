# Spring Boot startup comparison

Run from `spikes/` (JDK 25, Python 3, Docker required):

```sh
./bootstrap-gradle.sh
.tools/gradle-9.3.1/bin/gradle -p spring bootJar --console=plain
cd spring
python3 measure.py
# Run sequentially: the same TCP port is reused by each fresh process.
DATA_FILE="$PWD/data/133120.bin" ../.tools/gradle-9.3.1/bin/gradle -Paot :minimal:bootJar :full:bootJar --console=plain
python3 measure.py --aot
# Existing Ktor build/AppCDS archive from the earlier spike is required.
python3 measure.py --ktor

docker build --build-arg CONFIG=minimal -t banbanyeok-s0b-spring-minimal .
docker build --build-arg CONFIG=full -t banbanyeok-s0b-spring-full .
docker image inspect banbanyeok-s0b-spring-minimal banbanyeok-s0b-spring-full --format '{{.RepoTags}} {{.Size}}'
```

Two Gradle subprojects use identical Kotlin source. `minimal` has Spring MVC; `full` adds JDBC/JdbcClient, Flyway, Actuator and PostgreSQL driver. No exclusion of auto-configuration and no database server, credentials or embedded database is provided. The harness first tests `full` with defaults; an additional explicitly labelled lazy-initialization trial defers unused database beans, without suppressing auto-configuration or migration properties. Neither result measures working database access.

Every successful sample checks both routes, verifies that the MVC handler ran on a virtual thread, records first health response time, reads process RSS using `ps`, then obtains heap used/committed with `jcmd GC.heap_info` after the fake recommend request. No forced GC occurs. RSS and heap are different metrics. All latencies precede jcmd attachment, and RSS is sampled before it. Five fresh JVMs per file and mode; warm OS cache; `-Xms32m -Xmx256m`. Raw JSON is under `../results/spring-*.json`; local full logs are ignored.

The harness extracts Boot's efficient jar layout via `-Djarmode=tools`. Paired extracted baseline/CDS variants use the same layout and flags except for the archive. Official CDS training is `java -XX:ArchiveClassesAtExit=application.jsa -Dspring.context.exit=onRefresh -jar app.jar` plus the same heap/virtual-thread/lazy properties as runtime. Training stops at context refresh and does not warm HTTP routes. AOT is Spring-generated bean initialization on the JVM (`-Dspring.aot.enabled=true`), not GraalVM native and not JDK AOT cache. With `-Paot`, artifacts are isolated in `build-aot/`; regular jars remain unchanged.

AOT task's working directory is a subproject, so `DATA_FILE` must be absolute. File bytes are read in `main` before Spring initialization in all variants; they are not build-time persisted into the generated application.

## Actual PostgreSQL: JDBC vs JPA

```sh
# From spikes/spring. Local-only dummy credentials, no production data.
docker run --rm -d --name banbanyeok-spring-pg -p 127.0.0.1:18543:5432 \
  -e POSTGRES_DB=spike -e POSTGRES_USER=spike -e POSTGRES_PASSWORD=local-spike-only postgres:18
# Wait for pg_isready success before measuring:
docker exec banbanyeok-spring-pg pg_isready -U spike -d spike
python3 measure.py --database
../.tools/gradle-9.3.1/bin/gradle -Paot -PdatabaseAot :jpa:bootJar --console=plain
python3 measure.py --aot --database --project jpa
# Run Docker builds AFTER timing samples, to avoid self-induced build load.
python3 docker-images.py
# Stops/removes only the local spike PostgreSQL container:
docker stop banbanyeok-spring-pg
```

Both actual-DB variants use three repository interfaces and the same migrated tables. JPA uses three entities and two lazy many-to-one mappings, Kotlin jpa/allopen plugins, Hibernate schema validation and `open-in-view=false`. JDBC uses Spring Data JDBC records for the same three tables. Each performs real Hikari/Flyway initialization; `/v1/recommend` remains the same fake calculation and performs no SQL. The database warmup run creates the schema before timed samples. Repeated measured launches validate existing migrations rather than running first-install DDL.

The AOT task explicitly enables virtual threads at build time as well as runtime. AOT conditions freeze at build time; a runtime flag alone did not produce virtual handler threads in the first trial. Build-time `DATA_FILE` is configured as an absolute path by the task.

Spring Data JDBC AOT was also attempted with `-Paot -PdatabaseAot :jdbc:bootJar`; it failed during jdbcDialect AOT processing while binding DataSource properties. No successful JDBC AOT startup measurement is claimed.
