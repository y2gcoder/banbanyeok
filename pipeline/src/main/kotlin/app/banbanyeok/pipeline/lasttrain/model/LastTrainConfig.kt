package app.banbanyeok.pipeline.lasttrain.model

import app.banbanyeok.pipeline.text
import app.banbanyeok.schema.DayType
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal val SEOUL_LINES = (1..8).map { it.toString() }.toSet()

/**
 * data/config/last-train.json: which lines may produce last trains on each day type, and which line families show
 * the exact minute of a direct train. A day type never borrows another day type's timetable, so a line is listed
 * for a day type only when its own timetable of that day type is cached. Adding a line here and rebuilding is all
 * it takes to turn it on.
 */
internal class LtConfig(
    data: JsonObject,
    families: Set<String>,
) {
    /** Seoul Metro lines (S5, train numbers) per day type. */
    val seoulLines: Map<DayType, Set<String>>

    /** TAGO line families (no train numbers) per day type. */
    val tagoGroups: Map<DayType, Set<String>>

    /** Families whose direct trains matched the operator's published timetable, per day type. */
    val exact: Map<DayType, Set<String>>

    /**
     * The receipt (`source-manifest.json` id) of each exact family's operator timetable: when its pages were fetched
     * and the operator's latest timetable change, which can switch the family off (see `ltExactSwitches`).
     */
    val exactReceipts: Map<String, String>

    /**
     * Whether trains rebuilt from rows without train numbers may give a time ([LtProblem.rebuild]). Off unless the
     * config turns it on: `"rebuild": {"enabled": true}`.
     */
    val rebuild: Boolean =
        data["rebuild"]
            ?.jsonObject
            ?.get("enabled")
            ?.jsonPrimitive
            ?.content == "true"

    /**
     * Day types computed from some lines only: their allowlist leaves out a line that another day type has. A route
     * through a line left out is unknown there, and the manifest says so (`lastTrainPartialDays`).
     */
    val partialDays: List<DayType>
        get() {
            fun lines(day: DayType) =
                seoulLines.getValue(day).map { "seoul:$it" } + tagoGroups.getValue(day).map { "tago:$it" }
            val all = DayType.entries.flatMap(::lines).toSet()
            return DayType.entries.filter { !lines(it).containsAll(all) }
        }

    /**
     * Lines of the operator's train-coded file (S7) to compare with. A Seoul Metro line listed here must agree
     * with S5 pair for pair; a TAGO family listed here is computed from both sources, the earlier answer kept.
     */
    val secondSourceLines: Set<String> =
        data
            .getValue("secondSource")
            .jsonObject
            .getValue("lines")
            .jsonArray
            .map { it.jsonPrimitive.content }
            .toSet()

    init {
        val days = data.getValue("days").jsonObject
        require(days.keys == DayType.entries.map { it.id }.toSet()) { "last-train.json: days must list every day type" }

        fun list(
            day: DayType,
            key: String,
        ) = days
            .getValue(day.id)
            .jsonObject
            .getValue(key)
            .jsonArray
            .map { it.jsonPrimitive.content }
            .toSet()
        seoulLines = DayType.entries.associateWith { list(it, "seoulLines") }
        tagoGroups = DayType.entries.associateWith { list(it, "tagoGroups") }
        require(seoulLines.values.all { SEOUL_LINES.containsAll(it) }) { "last-train.json: unknown Seoul line" }
        require(tagoGroups.values.all { families.containsAll(it) }) { "last-train.json: unknown TAGO line family" }
        require(secondSourceLines.all { it in SEOUL_LINES || it in families }) {
            "last-train.json: unknown second-source line"
        }
        val entries = data.getValue("exact").jsonObject
        entries.forEach { (family, value) ->
            val rule = value.jsonObject
            require(family in families || family in SEOUL_LINES) { "last-train.json: unknown exact family $family" }
            require(
                rule.text("source").startsWith("https://") &&
                    Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(rule.text("checkedAt")),
            ) {
                "last-train.json: exact family $family needs a source URL and the date it was checked"
            }
        }
        exact =
            DayType.entries.associateWith { day ->
                entries
                    .filterValues { rule ->
                        rule.jsonObject
                            .getValue("days")
                            .jsonArray
                            .any { it.jsonPrimitive.content == day.id }
                    }.keys
            }
        exactReceipts =
            entries.mapValues { (family, rule) ->
                requireNotNull(
                    rule.jsonObject["receipt"]
                        ?.jsonPrimitive
                        ?.content
                        ?.takeIf(String::isNotBlank),
                ) {
                    "last-train.json: exact family $family needs the receipt id of its operator timetable"
                }
            }
        // A family is exact only on a day type it is computed: Saturday has no TAGO rows and borrows no other day's.
        exact.forEach { (day, listed) ->
            listed.filter { it !in SEOUL_LINES }.forEach { family ->
                require(family in tagoGroups.getValue(day)) {
                    "last-train.json: exact family $family is not computed on ${day.id} (tagoGroups)"
                }
            }
        }
    }
}
