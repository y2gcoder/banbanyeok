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
    public fun matches(content: ByteArray): Boolean = content.size.toLong() == bytes && Sha256.hex(content) == sha256
}

@Serializable
public data class ManifestFiles(
    val registry: ManifestFile,
    val candidates: ManifestFile,
    /** 기본 구분([TimeSlot.DEFAULT], 평일 낮)의 행렬. */
    val od: ManifestFile,
    val seoPages: ManifestFile? = null,
    /** 세대 2: 기본 구분을 뺀 구분 11개의 행렬(키 = 구분 id). 세대 1에는 없다. */
    val odSlots: Map<String, ManifestFile>? = null,
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
    private val writer =
        Json {
            prettyPrint = true
            prettyPrintIndent = "  "
            explicitNulls = false
        }

    private val dataVersionPattern = Regex("^[0-9]{8}\\.[0-9]{1,3}$")
    private val timestampPattern = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")

    public fun parse(json: String): Manifest {
        val manifest =
            try {
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
        schemaCheck(manifest.schemaVersion in 1..MANIFEST_SCHEMA_VERSION) {
            "지원하지 않는 manifest schemaVersion=${manifest.schemaVersion} (지원: 1..$MANIFEST_SCHEMA_VERSION)"
        }
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
        schemaCheck(timestampPattern.matches(manifest.generatedAt)) {
            "generatedAt은 UTC ISO-8601(...Z)이어야 합니다: '${manifest.generatedAt}'"
        }
        schemaCheck(manifest.registryVersion >= 1) { "registryVersion은 1 이상이어야 합니다" }
        schemaCheck(manifest.timeModel.isNotBlank()) { "timeModel이 비어 있습니다" }
        schemaCheck(
            manifest.originCount in 0..StationCode.CAPACITY && manifest.candidateCount in 0..StationCode.CAPACITY,
        ) {
            "originCount/candidateCount 범위 오류"
        }
        val files = manifest.files
        listOf(
            "registry" to files.registry,
            "candidates" to files.candidates,
            "od" to files.od,
            "seoPages" to files.seoPages,
        ).forEach { (key, file) -> if (file != null) validateFile(key, file) }
        validateSlots(manifest)
    }

    /** 세대 1은 구분 행렬이 없고, 세대 2는 기본 구분을 뺀 11개가 빠짐없이 있어야 한다. */
    private fun validateSlots(manifest: Manifest) {
        val slots = manifest.files.odSlots
        if (manifest.schemaVersion == 1) {
            schemaCheck(slots == null) { "schemaVersion 1 manifest에는 files.odSlots가 없어야 합니다" }
            return
        }
        val expected =
            TimeSlot.ALL
                .filter { it != TimeSlot.DEFAULT }
                .map { it.id }
                .toSet()
        schemaCheck(slots?.keys == expected) {
            "files.odSlots는 기본 구분(${TimeSlot.DEFAULT})을 뺀 구분 ${expected.size}개를 모두 가져야 합니다"
        }
        requireNotNull(slots)
        slots.forEach { (id, file) -> validateFile("odSlots.$id", file) }
        // 내용이 같은 구분(예: 토요일과 일요일·공휴일)은 한 파일을 함께 가리킬 수 있다. 같은 경로면 해시·길이도 같아야 한다.
        (slots.values + manifest.files.od).groupBy { it.path }.forEach { (path, entries) ->
            schemaCheck(entries.map { it.sha256 to it.bytes }.toSet().size == 1) {
                "같은 경로('$path')를 가리키는 구분 행렬의 sha256/bytes가 다릅니다"
            }
        }
    }

    /** `YYYYMMDD.N`을 비교 가능한 수로 바꾼다(문자열 비교는 N이 두 자리일 때 틀린다). */
    private fun versionKey(version: String): Long {
        val (date, n) = version.split('.')
        return date.toLong() * 1000 + n.toLong()
    }

    private fun validateFile(
        key: String,
        file: ManifestFile,
    ) {
        val path = file.path
        schemaCheck(
            path.isNotEmpty() && !path.startsWith("/") && !path.contains('\\') &&
                path.split('/').none { it == ".." || it.isEmpty() },
        ) {
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
    /** 기본 구분(평일 낮)의 행렬. */
    public val od: OdMatrix,
    /** 기본 구분을 뺀 구분별 행렬. 세대 1 데이터면 비어 있다. 모든 행렬은 [od]와 축이 같다. */
    public val odSlots: Map<TimeSlot, OdMatrix> = emptyMap(),
) {
    /** [slot]의 행렬. 기본 구분은 [od], 그 밖에는 [odSlots]. 세대 1 데이터에 없는 구분이면 null. */
    public fun odFor(slot: TimeSlot): OdMatrix? = if (slot == TimeSlot.DEFAULT) od else odSlots[slot]
}

/** data-format.md §5의 검증 순서 ①~⑥. 하나라도 어긋나면 [SchemaException] — 호출자는 직전 정상 버전을 유지한다. */
public object DataSetLoader {
    /**
     * @param odSlotBytes 세대 2 manifest의 `files.odSlots` 파일 내용(키 = 구분 id). 세대 1이면 비워 둔다.
     * @param supportedSchema 이 클라이언트가 읽을 수 있는 최신 manifest 세대.
     */
    public fun load(
        manifestJson: String,
        registryBytes: ByteArray,
        candidatesBytes: ByteArray,
        odBytes: ByteArray,
        supportedSchema: Int = MANIFEST_SCHEMA_VERSION,
        odSlotBytes: Map<String, ByteArray> = emptyMap(),
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

        // 구성 형식(레지스트리·후보 JSON, od.bin)은 manifest 세대 1·2 모두 1판이다(data-format §1).
        schemaCheck(registry.schemaVersion == SCHEMA_VERSION && candidates.schemaVersion == SCHEMA_VERSION) {
            "manifest 세대 ${manifest.schemaVersion}의 레지스트리/후보 schemaVersion은 $SCHEMA_VERSION 이어야 합니다"
        }
        schemaCheck(
            manifest.registryVersion == registry.registryVersion && manifest.registryVersion == od.registryVersion,
        ) {
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
        return DataSet(manifest, registry, candidates, od, slotMatrices(manifest, od, odSlotBytes))
    }

    /** 구분 행렬마다 ③ 해시·길이, ④ 헤더·길이, ⑤ 레지스트리 버전, 그리고 기본 행렬과 같은 축인지 검사한다. */
    private fun slotMatrices(
        manifest: Manifest,
        od: OdMatrix,
        bytes: Map<String, ByteArray>,
    ): Map<TimeSlot, OdMatrix> {
        val files = manifest.files.odSlots.orEmpty()
        schemaCheck(bytes.keys == files.keys) { "구분 행렬 파일이 manifest의 files.odSlots와 다릅니다" }
        // 같은 파일을 가리키는 구분은 한 번만 읽어 같은 행렬 객체를 함께 쓴다(메모리·시작 시간).
        val decoded = mutableMapOf<String, OdMatrix>()
        return files.entries.associate { (id, file) ->
            val content = bytes.getValue(id)
            schemaCheck(file.matches(content)) { "구분 $id od.bin의 길이/SHA-256이 manifest와 다릅니다" }
            val matrix = decoded.getOrPut(file.sha256) { OdBinCodec.decode(content) }
            schemaCheck(matrix.registryVersion == od.registryVersion) { "구분 $id od.bin의 registryVersion이 다릅니다" }
            schemaCheck(
                matrix.rawOrigins.contentEquals(od.rawOrigins) && matrix.rawCandidates.contentEquals(od.rawCandidates),
            ) {
                "구분 $id od.bin의 출발역·후보 축이 기본 행렬과 다릅니다"
            }
            requireNotNull(TimeSlot.parseOrNull(id)) to matrix
        }
    }
}
