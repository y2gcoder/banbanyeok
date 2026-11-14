/*
 * contracts/ 아래 파일을 commonTest용 Kotlin 소스 상수로 바꾼다(tech-stack 3.3).
 * 파일 I/O 없이 jvm(·이후 android·ios) 테스트가 같은 데이터를 쓴다.
 * 사용: 모듈 build.gradle.kts에서 id("banbanyeok.contract-test-data")를 적용하고, 코드에서
 *       ContractFiles.text("golden/scenarios.json") / ContractFiles.bytes("fixtures/od.sample.bin")
 */
plugins {
    id("org.jetbrains.kotlin.multiplatform")
}

val generateGoldenTests =
    tasks.register<GenerateContractTestData>("generateGoldenTests") {
        group = "verification"
        description = "contracts/golden, contracts/fixtures를 commonTest 소스(ContractFiles)로 생성한다."
        val contracts = rootProject.layout.projectDirectory.dir("contracts")
        contractsDir.set(contracts)
        files.from(
            contracts.asFileTree.matching {
                include("golden/**", "fixtures/**", "events.json")
            },
        )
        packageName.set("app.banbanyeok.contracts")
        outputDir.set(layout.buildDirectory.dir("generated/contracts/commonTest/kotlin"))
    }

kotlin.sourceSets.named("commonTest") {
    kotlin.srcDir(generateGoldenTests.flatMap { it.outputDir })
}
