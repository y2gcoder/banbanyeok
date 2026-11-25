package app.banbanyeok.server.room

import app.banbanyeok.schema.StationRegion

/** Evaluated against the participants inside the same write transaction. */
public class RoomRegionRule(
    private val stations: StationCatalog,
) {
    public fun requireMatch(
        participants: List<Participant>,
        code: String,
        replacing: String? = null,
        hidden: Boolean = false,
    ) {
        val selected = stations.regionOf(stations.canonical(code))
        val others = participants.filterNot { it.id == replacing }.mapNotNull(::regionOf)
        if ((hidden && selected != StationRegion.CAPITAL) || others.any { it != selected }) {
            throw RoomException(RoomError.REGION_MISMATCH, "방과 추천은 한 권역 안에서 계산합니다")
        }
    }

    private fun regionOf(participant: Participant): StationRegion? =
        // Existing hidden participants were created when only the metropolitan network was available.
        if (participant.hidden) StationRegion.CAPITAL else stations.regionOf(stations.canonical(participant.originCode))
}
