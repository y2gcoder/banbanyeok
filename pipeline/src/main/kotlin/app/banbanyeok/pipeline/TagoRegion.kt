package app.banbanyeok.pipeline

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
