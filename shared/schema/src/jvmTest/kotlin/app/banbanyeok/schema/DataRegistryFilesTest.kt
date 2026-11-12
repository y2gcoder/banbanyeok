package app.banbanyeok.schema

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/** 저장소 data/registry 폴더의 JSON 파일이 형식 계약에 맞는지 검사한다(파일 I/O가 필요해 jvmTest에만 둔다). */
class DataRegistryFilesTest {
    // Gradle은 jvmTest의 작업 디렉토리를 모듈 디렉토리(shared/schema)로 둔다.
    private val dir = File("../../data/registry")

    @Test
    fun registryAndCandidatesFollowTheContract() {
        assertTrue(dir.isDirectory, "data/registry를 찾을 수 없습니다: ${dir.absolutePath}")
        val registry = RegistryCodec.parse(File(dir, "stations.json").readText())
        val candidates = RegistryCodec.parseCandidates(File(dir, "candidates.json").readText())
        RegistryCodec.validateAgainst(candidates, registry)
    }
}
