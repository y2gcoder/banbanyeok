package app.banbanyeok.schema

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonUnquotedLiteral
import kotlin.math.roundToLong

/** 이 모듈이 읽고 쓰는 형식 세대. manifest·레지스트리·후보·od.bin이 함께 쓴다(contracts/data-format.md §1). */
public const val SCHEMA_VERSION: Int = 1

@Serializable
public enum class StationStatus {
    @SerialName("active")
    ACTIVE,

    @SerialName("deprecated")
    DEPRECATED,
}

@Serializable
public data class Station(
    val code: String,
    val name: String,
    val status: StationStatus,
    @Serializable(with = Coordinate6Serializer::class) val lat: Double,
    @Serializable(with = Coordinate6Serializer::class) val lng: Double,
    val lines: List<String>,
    val aliases: List<String>,
    val sources: Map<String, String>,
    val addedIn: Int,
    val deprecatedIn: Int? = null,
    val replacedBy: String? = null,
)

/**
 * 좌표를 소수 6자리까지로 반올림해 항상 소수점이 있는 십진수로 쓴다(127.0, 37.5, 127.01).
 * Double.toString은 플랫폼마다 다르다(Kotlin/JS는 127.0을 "127"로 쓴다). 나중에 타깃이 늘거나 TS 구현과 바이트를 비교해도
 * 같은 결과가 나오도록 플랫폼과 무관한 표기를 직접 만든다.
 */
@OptIn(ExperimentalSerializationApi::class)
internal object Coordinate6Serializer : KSerializer<Double> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("Coordinate6", PrimitiveKind.DOUBLE)

    override fun deserialize(decoder: Decoder): Double = decoder.decodeDouble()

    override fun serialize(
        encoder: Encoder,
        value: Double,
    ) {
        require(value.isFinite()) { "좌표는 유한한 수여야 합니다" }
        if (encoder is JsonEncoder) {
            encoder.encodeJsonElement(
                JsonUnquotedLiteral(format(value)),
            )
        } else {
            encoder.encodeDouble(value)
        }
    }

    internal fun format(value: Double): String {
        val micro = (kotlin.math.abs(value) * 1_000_000).roundToLong()
        val whole = micro / 1_000_000
        var fraction = (micro % 1_000_000).toString().padStart(6, '0').trimEnd('0')
        if (fraction.isEmpty()) fraction = "0"
        val sign = if (value < 0 && micro != 0L) "-" else ""
        return "$sign$whole.$fraction"
    }
}

@Serializable
public data class Registry(
    val schemaVersion: Int,
    val registryVersion: Int,
    val stations: List<Station>,
) {
    public fun station(code: String): Station? = stations.firstOrNull { it.code == code }
}

@Serializable
public data class CandidateList(
    val schemaVersion: Int,
    val registryVersion: Int,
    val candidates: List<String>,
)

/** 레지스트리·후보 JSON의 파서와 (정규형) 작성기. 알 수 없는 키는 오류다(data-format.md §6). */
public object RegistryCodec {
    private val reader = Json { ignoreUnknownKeys = false }
    private val writer =
        Json {
            prettyPrint = true
            prettyPrintIndent = "  "
            explicitNulls = false
        }

    public fun parse(json: String): Registry {
        val registry = decode { reader.decodeFromString(Registry.serializer(), json) }
        validate(registry)
        return registry
    }

    public fun encode(registry: Registry): String {
        validate(registry)
        return writer.encodeToString(Registry.serializer(), registry) + "\n"
    }

    public fun parseCandidates(json: String): CandidateList {
        val list = decode { reader.decodeFromString(CandidateList.serializer(), json) }
        validate(list)
        return list
    }

    public fun encodeCandidates(list: CandidateList): String {
        validate(list)
        return writer.encodeToString(CandidateList.serializer(), list) + "\n"
    }

    private inline fun <T> decode(block: () -> T): T =
        try {
            block()
        } catch (e: SerializationException) {
            throw SchemaException("JSON 형식 오류: ${e.message}", e)
        } catch (e: IllegalArgumentException) {
            throw SchemaException("JSON 형식 오류: ${e.message}", e)
        }

    /** data-format.md §3의 구조 규칙. 위반이면 [SchemaException]. */
    public fun validate(registry: Registry) {
        schemaCheck(registry.schemaVersion == SCHEMA_VERSION) {
            "지원하지 않는 레지스트리 schemaVersion=${registry.schemaVersion} (지원: $SCHEMA_VERSION)"
        }
        schemaCheck(registry.registryVersion >= 1) { "registryVersion은 1 이상이어야 합니다" }
        var previous: String? = null
        val codes = registry.stations.mapTo(HashSet()) { it.code }
        for (station in registry.stations) {
            StationCode.parse(station.code)
            schemaCheck(previous == null || previous < station.code) {
                "stations는 code 오름차순·중복 없음이어야 합니다: '$previous' 다음에 '${station.code}'"
            }
            previous = station.code
            schemaCheck(station.name.isNotBlank()) { "${station.code}: name이 비어 있습니다" }
            schemaCheck(station.lat in -90.0..90.0 && station.lng in -180.0..180.0) {
                "${station.code}: 좌표 범위 오류 (${station.lat}, ${station.lng})"
            }
            schemaCheck(station.addedIn in 1..registry.registryVersion) {
                "${station.code}: addedIn=${station.addedIn}은 1..${registry.registryVersion} 이어야 합니다"
            }
            when (station.status) {
                StationStatus.ACTIVE -> {
                    schemaCheck(station.deprecatedIn == null && station.replacedBy == null) {
                        "${station.code}: active 역에 deprecatedIn/replacedBy가 있습니다"
                    }
                }

                StationStatus.DEPRECATED -> {
                    schemaCheck(
                        station.deprecatedIn != null &&
                            station.deprecatedIn in station.addedIn..registry.registryVersion,
                    ) { "${station.code}: deprecated 역은 addedIn..registryVersion 범위의 deprecatedIn이 필요합니다" }
                }
            }
            station.replacedBy?.let {
                StationCode.parse(it)
                schemaCheck(it in codes && it != station.code) { "${station.code}: replacedBy '$it'가 레지스트리에 없습니다" }
            }
        }
    }

    public fun validate(list: CandidateList) {
        schemaCheck(list.schemaVersion == SCHEMA_VERSION) {
            "지원하지 않는 후보 목록 schemaVersion=${list.schemaVersion} (지원: $SCHEMA_VERSION)"
        }
        schemaCheck(list.registryVersion >= 1) { "registryVersion은 1 이상이어야 합니다" }
        var previous: String? = null
        for (code in list.candidates) {
            StationCode.parse(code)
            schemaCheck(previous == null || previous < code) { "candidates는 오름차순·중복 없음이어야 합니다: '$code'" }
            previous = code
        }
    }

    /** 후보가 모두 레지스트리에 active로 있고 같은 registryVersion인지 확인한다. */
    public fun validateAgainst(
        list: CandidateList,
        registry: Registry,
    ) {
        schemaCheck(list.registryVersion == registry.registryVersion) {
            "후보 목록 registryVersion=${list.registryVersion} != 레지스트리 ${registry.registryVersion}"
        }
        for (code in list.candidates) {
            val station = registry.station(code) ?: schemaFail("후보 '$code'가 레지스트리에 없습니다")
            schemaCheck(station.status == StationStatus.ACTIVE) { "후보 '$code'가 deprecated 입니다" }
        }
    }
}

/**
 * append-only 규칙 검사(data-format.md §3). 이전 main의 레지스트리와 새 레지스트리를 비교해 위반 목록을 돌려준다.
 * 빈 목록이면 통과. 파이프라인 검증 게이트와 CI가 쓴다.
 */
public object RegistryCompatibility {
    public fun checkAppendOnly(
        previous: Registry,
        next: Registry,
    ): List<String> {
        val violations = mutableListOf<String>()
        if (next.registryVersion < previous.registryVersion) {
            violations += "registryVersion이 줄었습니다: ${previous.registryVersion} -> ${next.registryVersion}"
        }
        if (next.registryVersion == previous.registryVersion && next.stations != previous.stations) {
            violations += "내용이 바뀌었는데 registryVersion(${next.registryVersion})이 그대로입니다"
        }
        val nextByCode = next.stations.associateBy { it.code }
        for (old in previous.stations) {
            val now = nextByCode[old.code]
            if (now == null) {
                violations += "코드 '${old.code}'(${old.name})가 사라졌습니다. 삭제하지 말고 deprecated로 표시하세요"
                continue
            }
            if (now.addedIn != old.addedIn) violations += "코드 '${old.code}'의 addedIn이 바뀌었습니다"
            if (old.status == StationStatus.DEPRECATED && now.status != StationStatus.DEPRECATED) {
                violations += "코드 '${old.code}'가 deprecated에서 되돌려졌습니다"
            }
        }
        return violations
    }
}
