package app.banbanyeok.schema

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

@Serializable
public data class ManifestFile(
    val path: String,
    val sha256: String,
    val bytes: Long,
) {
    /** 길이와 SHA-256이 모두 맞으면 true. */
    public fun matches(content: ByteArray): Boolean =
        content.size.toLong() == bytes && Sha256.hex(content) == sha256
}

@Serializable
public data class ManifestFiles(
    val registry: ManifestFile,
    val candidates: ManifestFile,
    val od: ManifestFile,
    val seoPages: ManifestFile? = null,
)

/** manifest.json — 발행 포인터. 필드 의미는 contracts/data-format.md §5. */
@Serializable
public data class Manifest(
    val schemaVersion: Int,
    val minClientSchema: Int,
    val dataVersion: String,
    val previousDataVersion: String? = null,
    val generatedAt: String,
    val registryVersion: Int,
    val timeModel: String,
    val originCount: Int,
    val candidateCount: Int,
    val files: ManifestFiles,
)

public object ManifestCodec {
    private val reader = Json { ignoreUnknownKeys = false }
    private val writer = Json {
        prettyPrint = true
        prettyPrintIndent = "  "
        explicitNulls = false
    }

    private val dataVersionPattern = Regex("^[0-9]{8}\\.[0-9]{1,3}$")
    private val timestampPattern = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")

    public fun parse(json: String): Manifest {
        val manifest = try {
            reader.decodeFromString(Manifest.serializer(), json)
        } catch (e: SerializationException) {
            throw SchemaException("manifest JSON 형식 오류: ${e.message}", e)
        } catch (e: IllegalArgumentException) {
            throw SchemaException("manifest JSON 형식 오류: ${e.message}", e)
        }
        validate(manifest)
        return manifest
    }

    public fun encode(manifest: Manifest): String {
        validate(manifest)
        return writer.encodeToString(Manifest.serializer(), manifest) + "\n"
    }

    /** 구조 규칙만 검사한다(파일 내용 대조는 [DataSetLoader]). */
    public fun validate(manifest: Manifest) {
        schemaCheck(manifest.schemaVersion >= 1) { "schemaVersion은 1 이상이어야 합니다" }
        schemaCheck(manifest.minClientSchema in 1..manifest.schemaVersion) {
            "minClientSchema=${manifest.minClientSchema}는 1..schemaVersion(${manifest.schemaVersion}) 이어야 합니다"
        }
        schemaCheck(dataVersionPattern.matches(manifest.dataVersion)) { "dataVersion 형식 오류: '${manifest.dataVersion}'" }
        manifest.previousDataVersion?.let {
            schemaCheck(dataVersionPattern.matches(it)) { "previousDataVersion 형식 오류: '$it'" }
            schemaCheck(versionKey(it) < versionKey(manifest.dataVersion)) {
                "previousDataVersion('$it')은 dataVersion('${manifest.dataVersion}')보다 앞서야 합니다"
            }
        }
        schemaCheck(timestampPattern.matches(manifest.generatedAt)) { "generatedAt은 UTC ISO-8601(...Z)이어야 합니다: '${manifest.generatedAt}'" }
        schemaCheck(manifest.registryVersion >= 1) { "registryVersion은 1 이상이어야 합니다" }
        schemaCheck(manifest.timeModel.isNotBlank()) { "timeModel이 비어 있습니다" }
        schemaCheck(manifest.originCount in 0..StationCode.CAPACITY && manifest.candidateCount in 0..StationCode.CAPACITY) {
            "originCount/candidateCount 범위 오류"
        }
        val files = manifest.files
        listOf("registry" to files.registry, "candidates" to files.candidates, "od" to files.od, "seoPages" to files.seoPages)
            .forEach { (key, file) -> if (file != null) validateFile(key, file) }
    }

    /** `YYYYMMDD.N`을 비교 가능한 수로 바꾼다(문자열 비교는 N이 두 자리일 때 틀린다). */
    private fun versionKey(version: String): Long {
        val (date, n) = version.split('.')
        return date.toLong() * 1000 + n.toLong()
    }

    private fun validateFile(key: String, file: ManifestFile) {
        val path = file.path
        schemaCheck(path.isNotEmpty() && !path.startsWith("/") && !path.contains('\\') && path.split('/').none { it == ".." || it.isEmpty() }) {
            "files.$key.path가 안전한 상대 경로가 아닙니다: '$path'"
        }
        schemaCheck(file.sha256.length == 64 && file.sha256.all { it in '0'..'9' || it in 'a'..'f' }) {
            "files.$key.sha256은 소문자 16진수 64자여야 합니다"
        }
        schemaCheck(file.bytes >= 0) { "files.$key.bytes는 0 이상이어야 합니다" }
    }
}

/** 검증을 통과한 데이터 세트(서버가 새 버전을 올릴 때 쓰는 단위). */
public class DataSet(
    public val manifest: Manifest,
    public val registry: Registry,
    public val candidates: CandidateList,
    public val od: OdMatrix,
)

/** data-format.md §5의 검증 순서 ①~⑥. 하나라도 어긋나면 [SchemaException] — 호출자는 직전 정상 버전을 유지한다. */
public object DataSetLoader {
    public fun load(
        manifestJson: String,
        registryBytes: ByteArray,
        candidatesBytes: ByteArray,
        odBytes: ByteArray,
        supportedSchema: Int = SCHEMA_VERSION,
    ): DataSet {
        val manifest = ManifestCodec.parse(manifestJson)
        schemaCheck(manifest.minClientSchema <= supportedSchema) {
            "이 데이터는 클라이언트 schema ${manifest.minClientSchema} 이상이 필요합니다 (지원: $supportedSchema). 업데이트가 필요합니다"
        }
        schemaCheck(manifest.files.registry.matches(registryBytes)) { "레지스트리 파일의 길이/SHA-256이 manifest와 다릅니다" }
        schemaCheck(manifest.files.candidates.matches(candidatesBytes)) { "후보 파일의 길이/SHA-256이 manifest와 다릅니다" }
        schemaCheck(manifest.files.od.matches(odBytes)) { "od.bin의 길이/SHA-256이 manifest와 다릅니다" }

        val registry = RegistryCodec.parse(registryBytes.decodeToString(throwOnInvalidSequence = true))
        val candidates = RegistryCodec.parseCandidates(candidatesBytes.decodeToString(throwOnInvalidSequence = true))
        val od = OdBinCodec.decode(odBytes)

        schemaCheck(manifest.schemaVersion == registry.schemaVersion && manifest.schemaVersion == candidates.schemaVersion) {
            "manifest.schemaVersion=${manifest.schemaVersion}과 레지스트리/후보의 schemaVersion이 다릅니다"
        }
        schemaCheck(manifest.registryVersion == registry.registryVersion && manifest.registryVersion == od.registryVersion) {
            "registryVersion 불일치: manifest ${manifest.registryVersion}, 레지스트리 ${registry.registryVersion}, od.bin ${od.registryVersion}"
        }
        schemaCheck(manifest.originCount == od.originCount && manifest.candidateCount == od.candidateCount) {
            "manifest의 N×M(${manifest.originCount}×${manifest.candidateCount})이 od.bin(${od.originCount}×${od.candidateCount})과 다릅니다"
        }
        RegistryCodec.validateAgainst(candidates, registry)
        schemaCheck(candidates.candidates.size == od.candidateCount) { "후보 목록 길이가 od.bin의 후보 축과 다릅니다" }
        for (i in 0 until od.candidateCount) {
            schemaCheck(candidates.candidates[i] == od.candidateCode(i).toString()) {
                "후보 목록의 ${i}번째('${candidates.candidates[i]}')가 od.bin 후보 축('${od.candidateCode(i)}')과 다릅니다"
            }
        }
        for (i in 0 until od.originCount) {
            val code = od.originCode(i).toString()
            schemaCheck(registry.station(code) != null) { "od.bin 출발역 '$code'가 레지스트리에 없습니다" }
        }
        return DataSet(manifest, registry, candidates, od)
    }
}
