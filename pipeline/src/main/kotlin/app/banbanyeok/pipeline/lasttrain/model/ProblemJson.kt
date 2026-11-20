package app.banbanyeok.pipeline.lasttrain.model

import app.banbanyeok.pipeline.jsonValue
import app.banbanyeok.pipeline.obj
import app.banbanyeok.schema.DayType
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** The problem file of the independent oracle (and of the toy fixtures) as a [LtProblem]. */
internal fun ltProblemFromJson(data: JsonObject): LtProblem {
    fun strings(key: String) = data.getValue(key).jsonArray.map { it.jsonPrimitive.content }
    val hopRows = data.getValue("hops").jsonArray.map { it.jsonArray }
    val walks =
        data.getValue("walks").jsonArray.associate {
            val row = it.jsonArray
            Triple(row[0].jsonPrimitive.content, row[1].jsonPrimitive.content, row[2].jsonPrimitive.content) to
                row[3].jsonPrimitive.int
        }
    return LtProblem(
        strings("homes"),
        strings("meetings"),
        LtFamilies(
            data.getValue("families").jsonObject.mapValues { (_, edges) ->
                edges.jsonArray.map { it.jsonArray[0].jsonPrimitive.content to it.jsonArray[1].jsonPrimitive.content }
            },
        ),
        data.getValue("stations").jsonObject.mapValues {
            LtStation(
                it.value.jsonArray[0]
                    .jsonPrimitive.content,
                it.value.jsonArray[1]
                    .jsonPrimitive.content,
            )
        },
        hopRows.associate { (it[0].jsonPrimitive.content to it[1].jsonPrimitive.content) to it[2].jsonPrimitive.int },
        LtWalks(walks, data.getValue("stationWalks").jsonObject.mapValues { it.value.jsonPrimitive.int }),
        daySets(data.getValue("exact").jsonObject),
        hopRows.associate { row ->
            val run =
                row.getOrNull(3)?.jsonPrimitive?.int ?: maxOf(row[2].jsonPrimitive.int - LtProblem.DEFAULT_DWELL, 1)
            (row[0].jsonPrimitive.content to row[1].jsonPrimitive.content) to run
        },
        data["sourceMargin"]?.jsonPrimitive?.int ?: LT_SOURCE_MARGIN,
        daySets(data["exactNumbered"]?.jsonObject),
        data["rebuild"]?.jsonPrimitive?.content == "true",
        DayType.entries.associateWith { day ->
            data["proven"]?.jsonObject?.get(day.id)?.jsonArray.orEmpty().map {
                val row = it.jsonArray
                LtProven(
                    row[0].jsonPrimitive.content,
                    row[1].jsonPrimitive.content,
                    row[2].jsonPrimitive.int,
                    row[3].jsonPrimitive.content,
                    row[4].jsonPrimitive.content,
                )
            }
        },
    )
}

/** `{dayType: [name, …]}` of a problem file as a set per day type (empty for a day type or a key left out). */
private fun daySets(data: JsonObject?): Map<DayType, Set<String>> =
    DayType.entries.associateWith { day ->
        data
            ?.get(day.id)
            ?.jsonArray
            .orEmpty()
            .map { it.jsonPrimitive.content }
            .toSet()
    }

private fun ltNumbered(rows: kotlinx.serialization.json.JsonArray): List<LtNumberedStop> =
    rows.map {
        val row = it.jsonArray
        LtNumberedStop(
            row[0].jsonPrimitive.content,
            row[1].jsonPrimitive.content,
            row[2].jsonPrimitive.content,
            row[3].jsonPrimitive.int,
            row[4].jsonPrimitive.int,
            row[5].jsonPrimitive.content.ifEmpty { null },
        )
    }

/** Rows embedded in a problem file (toy fixtures; real runs read the timetable caches). */
internal fun ltRows(
    data: JsonObject,
    day: DayType,
): LtDayRows {
    val rows = data.getValue("rows").jsonObject[day.id]?.jsonObject ?: return LtDayRows(emptyMap(), emptyList())
    return LtDayRows(
        rows.getValue("unnumbered").jsonObject.mapValues { (_, list) ->
            list.jsonArray.map {
                val row = it.jsonArray
                LtRow(row[0].jsonPrimitive.int, row[1].jsonPrimitive.int, row[2].jsonPrimitive.content)
            }
        },
        ltNumbered(rows.getValue("numbered").jsonArray),
        rows["second"]?.jsonArray?.let(::ltNumbered).orEmpty(),
    )
}

/** The fixed inputs as the oracle reads them (`build/last-train/problem.json` without its `allowed` key). */
internal fun ltProblemToJson(problem: LtProblem): JsonObject {
    val (pairWalks, stationWalks) = problem.walks.json()
    return obj(
        "homes" to problem.homes,
        "meetings" to problem.meetings,
        "families" to problem.families.json(),
        "stations" to
            JsonObject(problem.stations.toSortedMap().mapValues { jsonValue(listOf(it.value.code, it.value.group)) }),
        "hops" to
            problem.hops.entries
                .sortedWith(compareBy({ it.key.first }, { it.key.second }))
                .map { listOf(it.key.first, it.key.second, it.value, problem.runs.getValue(it.key)) },
        "sourceMargin" to problem.sourceMargin,
        "walks" to pairWalks,
        "stationWalks" to stationWalks,
        "exact" to JsonObject(problem.exact.entries.associate { it.key.id to jsonValue(it.value.sorted()) }),
        "exactNumbered" to
            JsonObject(problem.exactNumbered.entries.associate { it.key.id to jsonValue(it.value.sorted()) }),
        "rebuild" to problem.rebuild,
        "proven" to
            JsonObject(
                problem.proven.entries.associate { (day, list) ->
                    day.id to jsonValue(list.map { listOf(it.home, it.meeting, it.minute, it.bound, it.family) })
                },
            ),
    )
}
