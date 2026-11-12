// 서버 프레임워크(Ktor vs Spring Boot)는 사용자 검토 중이라 정해지지 않았다.
// 그래서 프레임워크 의존 없이 JDK 내장 HTTP 서버로 /healthz 하나만 둔 자리표시다. 프레임워크가 정해지면 이 파일의
// 의존과 src를 통째로 교체한다(API 계약은 contracts/openapi.yaml이 기준).
plugins {
    id("banbanyeok.server-app")
}

application {
    mainClass.set("app.banbanyeok.server.MainKt")
}

dependencies {
    implementation(project(":shared:schema"))
    testImplementation(kotlin("test"))
}
