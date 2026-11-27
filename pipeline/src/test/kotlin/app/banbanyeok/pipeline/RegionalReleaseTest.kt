package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainTable
import app.banbanyeok.schema.REGIONAL_REGISTRY_SCHEMA_VERSION
import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.StationRegion
import app.banbanyeok.schema.StationStatus
import io.kotest.core.spec.style.DescribeSpec
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private fun station(
    code: String,
    region: StationRegion,
) = Station(code, code, StationStatus.ACTIVE, 37.5, 127.0, listOf("L"), emptyList(), emptyMap(), 1, region = region)

private val registry =
    Registry(
        REGIONAL_REGISTRY_SCHEMA_VERSION,
        1,
        listOf(
            station("b01", StationRegion.BUSAN),
            station("b02", StationRegion.BUSAN),
            station("c01", StationRegion.CAPITAL),
            station("c02", StationRegion.CAPITAL),
        ),
    )

private val homes = listOf("b01", "c01")
private val meetings = listOf("b02", "c02")

/** A table whose same-region cells are direct at 23:00 and whose cell [timed] (day, home, meeting) between regions too. */
private fun table(timed: Triple<DayType, String, String>? = null): LastTrainTable {
    val cells =
        DayType.entries.flatMap { day ->
            homes.flatMap { home ->
                meetings.map { meeting ->
                    val sameRegion = home.first() == meeting.first()
                    sameRegion || Triple(day, home, meeting) == timed
                }
            }
        }
    return LastTrainTable(
        1,
        homes.map { StationCode.parse(it).value }.toIntArray(),
        meetings.map { StationCode.parse(it).value }.toIntArray(),
        cells.map { if (it) 1380 else LastTrainTable.NONE }.toIntArray(),
        cells.map { if (it) 1 else 0 }.toIntArray(),
        cells.map { if (it) StationCode.parse("c02").value else LastTrainTable.NONE }.toIntArray(),
    )
}

private val capitalDays = listOf("weekday", "saturday")

class RegionalReleaseTest :
    DescribeSpec({
        describe("the regional last-train gate") {
            it("passes the capital's partial days and cells between regions left 확인 필요") {
                assertEquals(emptyList(), regionalLastTrainProblems(capitalDays, capitalDays, registry, table()))
            }

            it("refuses partial days that are not the capital's, which would change capital screens") {
                for (changed in listOf(emptyList(), null, listOf("weekday", "saturday", "holiday"))) {
                    val problems = regionalLastTrainProblems(capitalDays, changed, registry, table())
                    assertEquals(1, problems.size, "$changed")
                    assertTrue(problems.single().startsWith("lastTrainPartialDays"))
                }
            }

            it("refuses a time in a cell between regions, either way") {
                for (timed in listOf(
                    Triple(DayType.WEEKDAY, "c01", "b02"),
                    Triple(DayType.HOLIDAY, "b01", "c02"),
                )) {
                    val problems = regionalLastTrainProblems(capitalDays, capitalDays, registry, table(timed))
                    assertEquals(
                        listOf("${timed.first} ${timed.second} → ${timed.third}: a cell between regions has a time"),
                        problems,
                    )
                }
            }
        }
    })
