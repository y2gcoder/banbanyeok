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
    /** 세대 2부터: 기본 구분을 뺀 구분 11개의 행렬(키 = 구분 id). 세대 1에는 없다. */
    val odSlots: Map<String, ManifestFile>? = null,
    /** 세대 3: 귀갓길 막차 표(lt.bin, data-format §10). 세대 1·2에는 없다. */
    val lastTrain: ManifestFile? = null,
    /** 세대 4: 사람별 경로를 다시 계산하는 노선 그래프(rg.bin, data-format §11). 세대 1~3에는 없다. */
    val routeGraph: ManifestFile? = null,
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
    /** 세대 3: 막차 계산에 쓴 시간표 가운데 가장 오래된 수집일(`YYYY-MM-DD`, 서울 날짜). 서버가 이 날짜로 유효 기간을 센다. */
    val lastTrainAsOf: String? = null,
    /** 세대 3: 막차 계산 규칙의 식별자. 규칙이 바뀌면 값이 바뀐다. */
    val lastTrainModel: String? = null,
    /**
     * 세대 3(선택): 시간표가 있는 노선만 계산한 요일 종류의 id(`weekday`·`saturday`·`holiday`). 그 요일 종류의 '확인 필요'는
     * 시간표가 없는 노선을 지나는 길일 수 있다. 없으면 모든 요일 종류를 전 노선으로 계산했다.
     */
    val lastTrainPartialDays: List<String>? = null,
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
    private val datePattern = Regex("^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$")

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
        validateLastTrain(manifest)
        validateRouteGraph(manifest)
    }

    /** 세대 4는 노선 그래프를 가져야 하고, 세대 1~3에는 없어야 한다. */
    private fun validateRouteGraph(manifest: Manifest) {
        val file = manifest.files.routeGraph
        if (manifest.schemaVersion < ROUTE_GRAPH_GENERATION) {
            schemaCheck(file == null) {
                "schemaVersion ${manifest.schemaVersion} manifest에는 files.routeGraph가 없어야 합니다"
            }
            return
        }
        schemaCheck(file != null) { "schemaVersion ${manifest.schemaVersion} manifest에는 files.routeGraph가 있어야 합니다" }
        validateFile("routeGraph", requireNotNull(file))
    }

    /** 세대 3은 막차 표와 수집일·규칙 식별자를 모두 가져야 하고, 세대 1·2에는 셋 다 없어야 한다. */
    private fun validateLastTrain(manifest: Manifest) {
        val file = manifest.files.lastTrain
        if (manifest.schemaVersion < LAST_TRAIN_GENERATION) {
            schemaCheck(
                file == null && manifest.lastTrainAsOf == null && manifest.lastTrainModel == null &&
                    manifest.lastTrainPartialDays == null,
            ) {
                "schemaVersion ${manifest.schemaVersion} manifest에는 막차 항목(files.lastTrain, lastTrainAsOf, " +
                    "lastTrainModel, lastTrainPartialDays)이 없어야 합니다"
            }
            return
        }
        schemaCheck(file != null) { "schemaVersion ${manifest.schemaVersion} manifest에는 files.lastTrain이 있어야 합니다" }
        validateFile("lastTrain", requireNotNull(file))
        schemaCheck(manifest.lastTrainAsOf?.let(::isCalendarDate) == true) {
            "lastTrainAsOf는 달력에 있는 날짜(YYYY-MM-DD)여야 합니다: '${manifest.lastTrainAsOf}'"
        }
        schemaCheck(manifest.lastTrainModel?.isNotBlank() == true) { "lastTrainModel이 비어 있습니다" }
        val partial = manifest.lastTrainPartialDays.orEmpty()
        schemaCheck(partial.distinct() == partial && partial.all { id -> DayType.entries.any { it.id == id } }) {
            "lastTrainPartialDays는 요일 종류 id를 겹치지 않게 적어야 합니다: $partial"
        }
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

    /** `YYYY-MM-DD`이고 실제로 있는 날짜인가(2월 30일, 평년의 2월 29일은 아니다). 공통 코드라 java.time을 쓰지 않는다. */
    internal fun isCalendarDate(text: String): Boolean {
        if (!datePattern.matches(text)) return false
        val (year, month, day) = text.split('-').map(String::toInt)
        val leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
        val days =
            when (month) {
                2 -> if (leap) 29 else 28
                4, 6, 9, 11 -> 30
                else -> 31
            }
        return day in 1..days
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

/**
 * 세대별 manifest 객체 이름(data-format §5). 발행은 넷을 함께 쓴다: [GENERATION_ONE]은 세대 1(평일 낮 행렬만), [GENERATION_TWO]는
 * 구분 행렬까지, [GENERATION_THREE]는 막차 표까지, [GENERATION_FOUR]는 노선 그래프까지 담는다. reader는 자기가 아는 가장 높은 세대부터 읽고 없으면 아래 세대를 읽는다(옛 서버·
 * 클라이언트는 아는 이름만 읽으므로 새 세대가 생겨도 계속 기동한다). 셋은 같은 dataVersion과 같은 해시 파일을 가리킨다.
 */
public object ManifestNames {
    public const val GENERATION_ONE: String = "manifest.json"
    public const val GENERATION_TWO: String = "manifest.v2.json"
    public const val GENERATION_THREE: String = "manifest.v3.json"
    public const val GENERATION_FOUR: String = "manifest.v4.json"

    /** 높은 세대부터. */
    public val NEWEST_FIRST: List<String> = listOf(GENERATION_FOUR, GENERATION_THREE, GENERATION_TWO, GENERATION_ONE)
}

/** 노선 그래프(사람별 경로)가 들어온 manifest 세대. */
public const val ROUTE_GRAPH_GENERATION: Int = 4

/** 막차 표가 들어온 manifest 세대. */
public const val LAST_TRAIN_GENERATION: Int = 3

/** 구분 행렬이 들어온 manifest 세대. */
public const val SLOT_GENERATION: Int = 2

/** 세대 1 timeModel(평일 낮 행렬, 배차/2 대기). */
public const val GENERATION_ONE_TIME_MODEL: String = "weekday-offpeak-half-headway"

/** 세대 2·3 manifest에서 구분 행렬과 막차 표를 뺀 세대 1 manifest(같은 dataVersion·같은 파일). 옛 reader용으로 함께 발행한다. */
public fun Manifest.generationOne(): Manifest =
    copy(
        schemaVersion = 1,
        minClientSchema = 1,
        timeModel = GENERATION_ONE_TIME_MODEL,
        files = files.copy(odSlots = null, lastTrain = null, routeGraph = null),
        lastTrainAsOf = null,
        lastTrainModel = null,
        lastTrainPartialDays = null,
    )

/** 세대 3 manifest에서 막차 표를 뺀 세대 2 manifest(같은 dataVersion·같은 파일). 세대 3을 모르는 reader용으로 함께 발행한다. */
public fun Manifest.generationTwo(): Manifest {
    schemaCheck(schemaVersion >= SLOT_GENERATION) { "세대 1 manifest로는 세대 2를 만들 수 없습니다" }
    return copy(
        schemaVersion = SLOT_GENERATION,
        minClientSchema = SLOT_GENERATION,
        files = files.copy(lastTrain = null, routeGraph = null),
        lastTrainAsOf = null,
        lastTrainModel = null,
        lastTrainPartialDays = null,
    )
}

/** 세대 4 manifest에서 노선 그래프를 뺀 세대 3 manifest(같은 dataVersion·같은 파일). 세대 4를 모르는 reader용으로 함께 발행한다. */
public fun Manifest.generationThree(): Manifest {
    schemaCheck(schemaVersion >= LAST_TRAIN_GENERATION) { "세대 1·2 manifest로는 세대 3을 만들 수 없습니다" }
    return copy(
        schemaVersion = LAST_TRAIN_GENERATION,
        minClientSchema = LAST_TRAIN_GENERATION,
        files = files.copy(routeGraph = null),
    )
}

/** 데이터 세트를 이루는 파일 내용. [odSlots]는 세대 2 manifest의 `files.odSlots` 파일(키 = 구분 id), 세대 1이면 비어 있다. */
public class DataSetBytes(
    public val manifestJson: String,
    public val registry: ByteArray,
    public val candidates: ByteArray,
    public val od: ByteArray,
    public val odSlots: Map<String, ByteArray> = emptyMap(),
)

/** data-format.md §5의 검증 순서 ①~⑥. 하나라도 어긋나면 [SchemaException] — 호출자는 직전 정상 버전을 유지한다. */
public object DataSetLoader {
    /** 구분 행렬이 없는 세트(manifest 세대 1, 또는 구분을 읽지 않는 쪽)를 읽는다. */
    public fun load(
        manifestJson: String,
        registryBytes: ByteArray,
        candidatesBytes: ByteArray,
        odBytes: ByteArray,
        supportedSchema: Int = MANIFEST_SCHEMA_VERSION,
    ): DataSet = load(DataSetBytes(manifestJson, registryBytes, candidatesBytes, odBytes), supportedSchema)

    /**
     * @param supportedSchema 이 클라이언트가 읽을 수 있는 최신 manifest 세대.
     * @param deferSlots true면 구분 행렬은 검사하지 않고 비워 둔다(`files.odSlots`도 비워서 넘긴다). 서버가 기본 행렬만으로 먼저
     *   기동하고 구분 행렬은 뒤에서 [slotMatrices]로 검사할 때 쓴다(콜드스타트). manifest의 구조 검사(구분 목록 포함)는 그대로 한다.
     */
    public fun load(
        files: DataSetBytes,
        supportedSchema: Int = MANIFEST_SCHEMA_VERSION,
        deferSlots: Boolean = false,
    ): DataSet {
        val manifestJson = files.manifestJson
        val registryBytes = files.registry
        val candidatesBytes = files.candidates
        val odBytes = files.od
        val odSlotBytes = files.odSlots
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

        // 구성 형식(레지스트리·후보 JSON, od.bin)은 manifest 모든 세대에서 1판이다(data-format §1).
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
        if (deferSlots) {
            schemaCheck(odSlotBytes.isEmpty()) { "deferSlots면 구분 행렬 파일을 넘기지 않습니다" }
            return DataSet(manifest, registry, candidates, od)
        }
        return DataSet(manifest, registry, candidates, od, slotMatrices(manifest, od, odSlotBytes))
    }

    /** [load]에서 미룬 구분 행렬을 검사해 읽는다. 규칙은 [load]와 같다(해시·길이, 헤더, 레지스트리 버전, 기본 행렬과 같은 축). */
    public fun slotMatrices(
        core: DataSet,
        odSlotBytes: Map<String, ByteArray>,
    ): Map<TimeSlot, OdMatrix> = slotMatrices(core.manifest, core.od, odSlotBytes)

    /**
     * 막차 표(data-format §5 ⑨): 해시·길이, 헤더·길이·칸 불변식([LtBinCodec]), 레지스트리 버전, 기본 행렬과 같은 축. 세대 3 manifest에서만
     * 부른다. 실패해도 나머지 데이터는 쓸 수 있으므로 호출자는 막차만 끈다.
     */
    public fun lastTrains(
        core: DataSet,
        bytes: ByteArray,
    ): LastTrainTable {
        val file = core.manifest.files.lastTrain ?: schemaFail("manifest에 files.lastTrain이 없습니다")
        schemaCheck(file.matches(bytes)) { "lt.bin의 길이/SHA-256이 manifest와 다릅니다" }
        val table = LtBinCodec.decode(bytes)
        schemaCheck(table.registryVersion == core.od.registryVersion) { "lt.bin의 registryVersion이 다릅니다" }
        schemaCheck(table.sameAxesAs(core.od)) { "lt.bin의 집 역·만날 역 축이 od.bin의 출발역·후보 축과 다릅니다" }
        return table
    }

    /**
     * 노선 그래프(data-format §5 ⑩): 해시·길이, 형식([RouteGraphCodec]), 레지스트리 버전, 모든 노드의 역이 레지스트리에 있고 od.bin의
     * 모든 출발역·후보역에 노드가 있다. 세대 4 manifest에서만 부른다. 실패해도 나머지 데이터는 쓸 수 있으므로 호출자는 경로만 끈다.
     */
    public fun routeGraph(
        core: DataSet,
        bytes: ByteArray,
        expectedFormat: Int = RouteGraphCodec.FORMAT_VERSION,
    ): RouteGraph {
        val file = core.manifest.files.routeGraph ?: schemaFail("manifest에 files.routeGraph가 없습니다")
        schemaCheck(file.matches(bytes)) { "rg.bin의 길이/SHA-256이 manifest와 다릅니다" }
        val graph = RouteGraphCodec.decode(bytes)
        schemaCheck(graph.formatVersion == expectedFormat) { "rg.bin 형식 ${graph.formatVersion}, 기대값 $expectedFormat" }
        schemaCheck(graph.registryVersion == core.od.registryVersion) { "rg.bin의 registryVersion이 다릅니다" }
        val platforms = graph.platforms
        platforms.keys.forEach { value ->
            schemaCheck(core.registry.station(StationCode.ofValue(value).toString()) != null) {
                "rg.bin 노드의 역 '${StationCode.ofValue(value)}'가 레지스트리에 없습니다"
            }
        }
        val axes = core.od.rawOrigins + core.od.rawCandidates
        axes.forEach { value ->
            schemaCheck(value in platforms) { "od.bin의 역 '${StationCode.ofValue(value)}'에 rg.bin 노드가 없습니다" }
        }
        return graph
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
