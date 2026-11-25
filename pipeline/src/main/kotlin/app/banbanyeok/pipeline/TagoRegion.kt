package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path

internal enum class TagoRegion(
    val configKey: String,
    val receiptId: String,
    val cachePath: String,
) {
    CAPITAL("capital", "S6", "data/raw/tago"),
    BUSAN("busan", "S6-busan", "data/raw/tago-busan"),
    ;

    fun cache(root: Path): Path = root.resolve(cachePath)

    fun scope(config: JsonObject): JsonObject =
        config
            .getValue("regions")
            .jsonObject
            .getValue(configKey)
            .jsonObject
}

internal data class TagoSnapshot(
    val stations: Map<String, Pair<String, String>>,
    /** No day-type fallback is applied when reading a region's cached timetables. */
    val raw: Map<DayType, TagoTimetable>,
)
