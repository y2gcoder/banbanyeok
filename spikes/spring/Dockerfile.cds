FROM eclipse-temurin:25-jre AS extract
WORKDIR /builder
ARG CONFIG=minimal
COPY ${CONFIG}/build/libs/app.jar app.jar
RUN java -Djarmode=tools -jar app.jar extract --destination /runtime

FROM eclipse-temurin:25-jre AS baseline
WORKDIR /app
COPY --from=extract /runtime/ ./
COPY data/ ./data/
ENV DATA_FILE=/app/data/133120.bin SERVER_PORT=8080 SPRING_THREADS_VIRTUAL_ENABLED=true
EXPOSE 8080
ENTRYPOINT ["java", "-Xms32m", "-Xmx256m", "-jar", "app.jar"]

FROM baseline AS cds
ARG CONFIG=minimal
# Local-only test DB. No production credentials or remote deployment.
RUN if [ "$CONFIG" = "minimal" ]; then \
      java -Xms32m -Xmx256m -XX:ArchiveClassesAtExit=application.jsa -Dspring.context.exit=onRefresh -jar app.jar; \
    else \
      SPRING_DATASOURCE_URL=jdbc:postgresql://host.docker.internal:18543/spike \
      SPRING_DATASOURCE_USERNAME=spike SPRING_DATASOURCE_PASSWORD=local-spike-only \
      SPRING_JPA_HIBERNATE_DDL_AUTO=validate SPRING_JPA_OPEN_IN_VIEW=false \
      java -Xms32m -Xmx256m -XX:ArchiveClassesAtExit=application.jsa -Dspring.context.exit=onRefresh -jar app.jar; \
    fi
ENTRYPOINT ["java", "-Xms32m", "-Xmx256m", "-Xshare:on", "-XX:SharedArchiveFile=application.jsa", "-jar", "app.jar"]
