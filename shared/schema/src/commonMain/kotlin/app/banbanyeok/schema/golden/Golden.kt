package app.banbanyeok.schema.golden

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * 골든 계약 파일의 타입(contracts/golden/). shared/core가 알고리즘 구현을 이 데이터로 검증한다.
 * 시간 단위는 파일 안의 `unit`(지금 minutes)을 따른다. Kotlin 코어의 내부 단위(초)로의 변환은 코어 몫이다.
 */
@Serializable
public data class GoldenInput(
    val participants: List<String>,
    val candidates: List<String>,
    /** 행=참가자, 열=후보. null = 도달 불가. */
    val times: List<List<Double?>>,
    val transfers: List<List<Int?>>,
    val mode: String,
    val tolerance: Double,
)

@Serializable
public data class GoldenScenario(
    val id: String,
    val input: GoldenInput,
    val expectedFirst: String,
    val reason: String,
    val expectedReasonContains: String,
)

@Serializable
public data class ExpectedRow(
    val rank: Int,
    val stationId: String,
    val times: List<Double>,
    val transfers: List<Int>,
    val maxMinutes: Double,
    val spreadMinutes: Double,
    val totalMinutes: Double,
    val favoredMinutes: Double? = null,
    val reasonCode: String,
)

@Serializable
public data class ExpectedExcluded(
    val stationId: String,
    val reasonCode: String,
)

@Serializable
public data class ExpectedScenario(
    val id: String,
    val status: String,
    val mode: String,
    val toleranceMinutes: Double,
    val baselineStationId: String? = null,
    val favorCaps: Map<String, Double>? = null,
    val ranking: List<ExpectedRow>,
    val excluded: List<ExpectedExcluded>,
)

@Serializable
public data class ExpectedRankingFile(
    val formatVersion: Int,
    val unit: String,
    val description: String,
    val scenarios: List<ExpectedScenario>,
)

public object GoldenCodec {
    private val json = Json { ignoreUnknownKeys = false }

    public fun parseScenarios(text: String): List<GoldenScenario> =
        json.decodeFromString(kotlinx.serialization.builtins.ListSerializer(GoldenScenario.serializer()), text)

    public fun parseExpected(text: String): ExpectedRankingFile =
        json.decodeFromString(ExpectedRankingFile.serializer(), text)
}
