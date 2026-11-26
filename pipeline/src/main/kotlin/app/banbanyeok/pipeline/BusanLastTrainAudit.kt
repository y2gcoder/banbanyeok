package app.banbanyeok.pipeline

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainCell
import app.banbanyeok.schema.LastTrainTable
import app.banbanyeok.schema.LtBinCodec
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationCode
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.nio.file.Path
import kotlin.io.path.readBytes
import kotlin.io.path.readText

/** The committed Busan last-train evidence of [root]: config, checks, receipts. */
internal fun readBusanLtEvidence(root: Path): BusanLtEvidence {
    val config = parseBusanLtConfig(parseObject(root.resolve(BUSAN_LT_CONFIG).readText()))
    val checks = root.resolve(config.checks).readText()
    val receipts =
        Json
            .parseToJsonElement(root.resolve("data/config/source-manifest.json").readText())
            .jsonArray
            .map { it.jsonObject }
            .associateBy { it.text("id") }
    return BusanLtEvidence(
        config,
        readBusanLtChecks(checks),
        receipts,
        config.tables.mapValues { busanLtChecksSha256(checks, it.value.lines) },
        receipts.getValue(BUSAN_TAGO_RECEIPT).text("fetched_at").take(10),
    )
}

/** The calculation side from the network input's [lines] and the Busan TAGO cache. */
internal fun busanLtNetwork(
    config: BusanLtConfig,
    lines: Map<String, BusanLine>,
    tago: TagoSnapshot,
    meetings: Set<String>,
    homes: Set<String>,
) = BusanLtNetwork(
    { line, day ->
        val source =
            config.lines
                .getValue(line)
                .days
                .getValue(day)
        val busanLine = lines.getValue(line)
        if (config.tables.getValue(config.lines.getValue(line).table).source == BUSAN_TAGO_RECEIPT) {
            val rows = busanTagoRows(busanLine, tago, "MTRKRK6", DayType.entries.single { it.tagoDailyType == source })
            tagoBusanDirects(busanLine.stations.map { it.code }, rows)
        } else {
            numberedBusanDirects(busanLine, source)
        }
    },
    { line -> lines.getValue(line).stations.map { it.code } },
    meetings,
    homes,
)

/**
 * The regional table on [homes] × [meetings] (code strings in code order): every cell of [capital] as it is, every
 * Busan cell of [busan], and "unknown" elsewhere, cells between the regions included.
 */
internal fun regionalLastTrainTable(
    capital: LastTrainTable,
    busan: BusanLastTrains,
    homes: List<String>,
    meetings: List<String>,
    registryVersion: Int,
): LastTrainTable {
    val cells =
        DayType.entries.flatMap { day ->
            homes.flatMap { home ->
                val row = capital.indexOfHome(StationCode.parse(home))
                meetings.map { meeting ->
                    val column = capital.indexOfMeeting(StationCode.parse(meeting))
                    if (row >= 0 && column >= 0) {
                        capital.cell(day, row, column)
                    } else {
                        busan.cells[Triple(day, home, meeting)] ?: LastTrainCell.UNKNOWN
                    }
                }
            }
        }
    return lastTrainTable(registryVersion, homes.map(StationCode::parse), meetings.map(StationCode::parse), cells)
}

/** [regional]'s cells on [capital]'s axes. */
internal fun projectLastTrains(
    regional: LastTrainTable,
    capital: LastTrainTable,
): LastTrainTable {
    val homes = List(capital.homeCount, capital::homeCode)
    val meetings = List(capital.meetingCount, capital::meetingCode)
    val cells =
        DayType.entries.flatMap { day ->
            homes.flatMap { home ->
                meetings.map { regional.cell(day, regional.indexOfHome(home), regional.indexOfMeeting(it)) }
            }
        }
    return lastTrainTable(capital.registryVersion, homes, meetings, cells)
}

private fun lastTrainTable(
    registryVersion: Int,
    homes: List<StationCode>,
    meetings: List<StationCode>,
    cells: List<LastTrainCell>,
) = LastTrainTable(
    registryVersion,
    homes.map { it.value }.toIntArray(),
    meetings.map { it.value }.toIntArray(),
    cells.map { it.minute ?: LastTrainTable.NONE }.toIntArray(),
    cells.map { it.kind.raw }.toIntArray(),
    cells.map { it.boundFor?.value ?: LastTrainTable.NONE }.toIntArray(),
)

/** The regional last-train table and what `busan-preview` reports about it. */
internal class RegionalLastTrains(
    val table: LastTrainTable,
    val report: JsonObject,
)

/**
 * The Busan block from [input] (the network input) for the Busan [origins], and the regional table made from it and
 * the dev capital table. The regional table's cells on the capital axes must encode to the dev lt.bin byte for byte,
 * and no cell between the regions may have a time.
 */
internal fun regionalLastTrains(
    root: Path,
    input: Path,
    origins: List<Station>,
): RegionalLastTrains {
    val dev = root.resolve("data/artifacts/dev")
    val dataset = loadDevArtifacts(dev)
    val capital = requireNotNull(loadDevLastTrains(dev, dataset)) { "dev artifacts have no last-train table" }
    val evidence = readBusanLtEvidence(root)
    val lines =
        parseObject(
            input.readText(),
        ).getValue("lines").jsonObject.mapValues { parseBusanLine(it.value.jsonObject) }
    val candidates = candidateCodes(root, origins.associateBy { it.code })
    val tago = readRegionalTago(root, TagoRegion.BUSAN)
    val network = busanLtNetwork(evidence.config, lines, tago, candidates.toSet(), origins.map { it.code }.toSet())
    val busan = busanLastTrains(evidence, network, requireNotNull(dataset.manifest.lastTrainAsOf))

    fun axis(
        own: List<String>,
        capitalCodes: List<StationCode>,
    ) = (capitalCodes.map { it.toString() } + own).distinct().sortedBy { StationCode.parse(it).value }
    val homes = axis(origins.map { it.code }, List(capital.homeCount, capital::homeCode))
    val meetings = axis(candidates, List(capital.meetingCount, capital::meetingCode))
    val regional = regionalLastTrainTable(capital, busan, homes, meetings, capital.registryVersion)
    val devBytes = dev.resolve(requireNotNull(dataset.manifest.files.lastTrain).path).readBytes()
    require(LtBinCodec.encode(projectLastTrains(regional, capital)).contentEquals(devBytes)) {
        "Capital last trains changed in the regional table"
    }
    val capitalHomes = List(capital.homeCount) { capital.homeCode(it).toString() }.toSet()
    val capitalMeetings = List(capital.meetingCount) { capital.meetingCode(it).toString() }.toSet()
    val crossRegion =
        DayType.entries.sumOf { day ->
            homes.withIndex().sumOf { (row, home) ->
                meetings.withIndex().count { (column, meeting) ->
                    ((home in capitalHomes) != (meeting in capitalMeetings)).also { cross ->
                        require(!cross || regional.cell(day, row, column) == LastTrainCell.UNKNOWN) {
                            "Cross-region last train $home → $meeting"
                        }
                    }
                }
            }
        }
    val table =
        obj(
            "homes" to homes.size,
            "meetings" to meetings.size,
            "bytes" to LtBinCodec.encode(regional).size,
            "capitalCellsUnchanged" to true,
            "crossRegionUnknownCells" to crossRegion,
        )
    return RegionalLastTrains(regional, JsonObject(busan.report + ("regionalTable" to table)))
}
