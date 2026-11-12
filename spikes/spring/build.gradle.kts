plugins {
    kotlin("jvm") version "2.4.21" apply false
    kotlin("plugin.jpa") version "2.4.21" apply false
    kotlin("plugin.allopen") version "2.4.21" apply false
    kotlin("plugin.spring") version "2.4.21" apply false
    id("org.springframework.boot") version "4.1.2" apply false
}
subprojects {
    apply(plugin = "org.jetbrains.kotlin.jvm")
    apply(plugin = "org.jetbrains.kotlin.plugin.spring")
    apply(plugin = "org.springframework.boot")
    if (project.name == "jpa") {
        apply(plugin = "org.jetbrains.kotlin.plugin.jpa")
        apply(plugin = "org.jetbrains.kotlin.plugin.allopen")
        extensions.configure<org.jetbrains.kotlin.allopen.gradle.AllOpenExtension> {
            annotation("jakarta.persistence.Entity")
            annotation("jakarta.persistence.MappedSuperclass")
            annotation("jakarta.persistence.Embeddable")
        }
    }
    if (providers.gradleProperty("aot").isPresent) {
        layout.buildDirectory.set(layout.projectDirectory.dir("build-aot"))
        apply(plugin = "org.springframework.boot.aot")
        tasks.withType<org.springframework.boot.gradle.tasks.aot.ProcessAot>().configureEach {
            systemProperty("spring.threads.virtual.enabled", "true")
            environment("DATA_FILE", rootProject.file("data/133120.bin").absolutePath)
            if (project.name in listOf("jdbc", "jpa") && providers.gradleProperty("databaseAot").isPresent) {
                systemProperty("spring.datasource.url", "jdbc:postgresql://127.0.0.1:18543/spike")
                systemProperty("spring.datasource.username", "spike")
                systemProperty("spring.datasource.password", "local-spike-only")
                systemProperty("spring.jpa.hibernate.ddl-auto", "validate")
                systemProperty("spring.jpa.open-in-view", "false")
            }
        }
    }
    repositories { mavenCentral() }
    extensions.configure<org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension> {
        sourceSets.getByName("main").kotlin.srcDir(rootProject.file("src/main/kotlin"))
        if (project.name == "jpa" || project.name == "jdbc") {
            sourceSets.getByName("main").kotlin.srcDir(rootProject.file("src/${project.name}/kotlin"))
        }
    }
    if (project.name == "jpa" || project.name == "jdbc") {
        extensions.configure<org.gradle.api.tasks.SourceSetContainer> {
            getByName("main").resources.srcDir(rootProject.file("src/database/resources"))
        }
    }
    dependencies {
        "implementation"(platform("org.springframework.boot:spring-boot-dependencies:4.1.2"))
        "implementation"("org.springframework.boot:spring-boot-starter-webmvc")
        "implementation"("org.jetbrains.kotlin:kotlin-reflect")
        if (project.name in listOf("full", "jdbc", "jpa")) {
            val starter = when (project.name) { "jpa" -> "data-jpa"; "jdbc" -> "data-jdbc"; else -> "jdbc" }
            "implementation"("org.springframework.boot:spring-boot-starter-$starter")
            "implementation"("org.springframework.boot:spring-boot-starter-flyway")
            "implementation"("org.springframework.boot:spring-boot-starter-actuator")
            "runtimeOnly"("org.postgresql:postgresql")
            "runtimeOnly"("org.flywaydb:flyway-database-postgresql")
        }
    }
    tasks.withType<org.springframework.boot.gradle.tasks.bundling.BootJar> {
        archiveFileName.set("app.jar")
        mainClass.set("spike.ApplicationKt")
    }
}
