# Match the previous Ktor image runtime base for size comparison.
FROM eclipse-temurin:25-jre
WORKDIR /app
ARG CONFIG=minimal
COPY ${CONFIG}/build/libs/app.jar /app/app.jar
COPY data/ /app/data/
ENV DATA_FILE=/app/data/133120.bin SERVER_PORT=8080 SPRING_THREADS_VIRTUAL_ENABLED=true
EXPOSE 8080
ENTRYPOINT ["java", "-Xms32m", "-Xmx256m", "-jar", "/app/app.jar"]
