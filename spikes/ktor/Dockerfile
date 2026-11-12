FROM eclipse-temurin:25-jre
WORKDIR /app
COPY build/install/ktor-startup/ /app/
COPY data/ /app/data/
ENV DATA_FILE=/app/data/133120.bin PORT=8080
EXPOSE 8080
ENTRYPOINT ["/app/bin/ktor-startup"]
