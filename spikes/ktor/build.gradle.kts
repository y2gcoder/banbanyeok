plugins {
    kotlin("jvm") version "2.4.21"
    application
}
repositories { mavenCentral() }
dependencies {
    implementation("io.ktor:ktor-server-netty:3.6.1")
    implementation("ch.qos.logback:logback-classic:1.5.21")
}
application { mainClass.set("MainKt") }
