/**
 * 서버 모듈 컨벤션. 서버 프레임워크(Ktor vs Spring Boot)는 아직 정해지지 않았으므로 프레임워크 의존은 넣지 않는다.
 * 프레임워크가 정해지면 여기(또는 server/build.gradle.kts)에 플러그인과 의존만 추가한다.
 */
plugins {
    id("banbanyeok.kotlin-jvm")
    application
}
