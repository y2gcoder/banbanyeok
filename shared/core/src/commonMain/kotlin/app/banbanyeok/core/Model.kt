package app.banbanyeok.core

/** Pure ranking input. Matrix rows follow participants, columns follow candidates; paired null means unreachable.
 * Codes are opaque nonempty identifiers; production adapters validate the registry ASCII code format.
 * All durations are integer seconds. Invalid input throws IllegalArgumentException from rank().
 */
public data class RankInput(
    val participants: List<String>,
    val candidates: List<String>,
    val times: List<List<Int?>>,
    val transfers: List<List<Int?>>,
    val mode: String = "fair",
    val toleranceSeconds: Int = 0,
)

/** Corresponds to OpenAPI PersonalTime; order follows the input participants. */
public data class PersonalTime(
    val participantId: String,
    val seconds: Int,
    val transfers: Int,
)

/** Corresponds to OpenAPI Candidate; stationName is supplied by the adapter's registry. */
public data class Candidate(
    val rank: Int,
    val stationCode: String,
    val times: List<PersonalTime>,
    val maxSeconds: Int,
    val spreadSeconds: Int,
    val totalSeconds: Long,
    val favoredSeconds: Int? = null,
    val reasonCode: String,
)

public data class ExcludedCandidate(
    val stationCode: String,
    val reasonCode: String,
)

/** Full ranking, without the HTTP layer's top-three truncation, names or dataVersion.
 * mode is fair/fast/favor:<participantId>. baselineStationCode is always strict fair first place.
 * favorCaps contains only nonfavored participants, in integer seconds (half-seconds round down).
 * totalSeconds uses Long to avoid overflow when adding up to four Int durations.
 */
public data class RankResult(
    val status: String,
    val mode: String,
    val participants: List<String>,
    val toleranceSeconds: Int,
    val baselineStationCode: String?,
    val favorCaps: Map<String, Long>?,
    val recommendations: List<Candidate>,
    val excluded: List<ExcludedCandidate>,
)
