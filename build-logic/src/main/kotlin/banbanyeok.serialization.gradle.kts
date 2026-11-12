/**
 * kotlinx.serialization 컴파일러 플러그인. 모듈 빌드 파일은 플러그인 ID를 직접 쓰지 않고 이 컨벤션만 적용한다
 * (build-logic 클래스패스의 플러그인은 버전 없이 ID로 직접 해석되지 않는다).
 */
plugins {
    id("org.jetbrains.kotlin.plugin.serialization")
}
