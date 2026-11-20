package app.banbanyeok.schema

import app.banbanyeok.contracts.ContractFiles
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** lt.bin(data-format §10)과 manifest 세대 3. 장난감 픽스처의 od.bin 축 위에 막차 표를 만든다. */
class LastTrainTest {
    private val v1 = ManifestCodec.parse(ContractFiles.text("fixtures/manifest.sample.json"))
    private val registry = ContractFiles.bytes("fixtures/stations.sample.json")
    private val candidates = ContractFiles.bytes("fixtures/candidates.sample.json")
    private val odBytes = ContractFiles.bytes("fixtures/od.sample.bin")
    private val od = OdBinCodec.decode(odBytes)
    private val homes = IntArray(od.originCount) { od.originCodeValue(it) }
    private val meetings = IntArray(od.candidateCount) { od.candidateCodeValue(it) }
    private val cells = homes.size * meetings.size
    private val none = LastTrainTable.NONE

    private fun table(
        change: (minutes: IntArray, kinds: IntArray, bounds: IntArray) -> Unit = { _, _, _ -> },
        homeCodes: IntArray = homes,
        meetingCodes: IntArray = meetings,
    ): LastTrainTable {
        val size = homeCodes.size * meetingCodes.size * LastTrainTable.DAY_COUNT
        val minutes = IntArray(size) { none }
        val kinds = IntArray(size)
        val bounds = IntArray(size) { none }
        // 평일 (0,1): 직행 확정 24:03, 휴일 (1,0): 갈아타는 여유 시각 23:17, 토요일 (0,2): 대조 전 직행 23:31.
        if (size >= 3 * cells && cells > 2) {
            minutes[1] = 1443
            kinds[1] = LastTrainKind.DIRECT.raw
            bounds[1] = homeCodes[0]
            minutes[cells + 2] = 1411
            kinds[cells + 2] = LastTrainKind.MARGIN_DIRECT.raw
            bounds[cells + 2] = homeCodes[1]
            minutes[2 * cells + meetingCodes.size] = 1397
            kinds[2 * cells + meetingCodes.size] = LastTrainKind.MARGIN_TRANSFER.raw
        }
        change(minutes, kinds, bounds)
        return LastTrainTable(od.registryVersion, homeCodes, meetingCodes, minutes, kinds, bounds)
    }

    private val lt = LtBinCodec.encode(table())
    private val others = TimeSlot.ALL.filter { it != TimeSlot.DEFAULT }
    private val v3 =
        v1.copy(
            schemaVersion = 3,
            minClientSchema = 3,
            files =
                v1.files.copy(
                    odSlots =
                        others.associate {
                            it.id to
                                ManifestFile("versions/x/od-${it.id}.bin", Sha256.hex(odBytes), odBytes.size.toLong())
                        },
                    lastTrain = ManifestFile("versions/x/lt.bin", Sha256.hex(lt), lt.size.toLong()),
                ),
            lastTrainAsOf = "2026-11-16",
            lastTrainModel = "chain-v1",
        )

    private fun core(manifest: Manifest = v3) =
        DataSetLoader.load(
            DataSetBytes(ManifestCodec.encode(manifest), registry, candidates, odBytes),
            deferSlots = true,
        )

    @Test
    fun roundTripsEveryKindAndKeepsTheLayout() {
        val decoded = LtBinCodec.decode(lt)
        assertEquals(table(), decoded)
        assertContentEquals(lt, LtBinCodec.encode(decoded))
        assertEquals(32 + 2 * homes.size + 2 * meetings.size + 3 * 5 * cells, lt.size)
        assertEquals("BBLT", lt.copyOfRange(0, 4).decodeToString())
        assertEquals(
            LastTrainCell(LastTrainKind.DIRECT, 1443, StationCode.ofValue(homes[0])),
            decoded.cell(DayType.WEEKDAY, 0, 1),
        )
        assertEquals(
            LastTrainCell(LastTrainKind.MARGIN_DIRECT, 1411, StationCode.ofValue(homes[1])),
            decoded.cell(DayType.SATURDAY, 0, 2),
        )
        assertEquals(LastTrainCell(LastTrainKind.MARGIN_TRANSFER, 1397, null), decoded.cell(DayType.HOLIDAY, 1, 0))
        assertEquals(LastTrainCell.UNKNOWN, decoded.cell(DayType.WEEKDAY, 0, 0))
        assertEquals(0, decoded.indexOfHome(decoded.homeCode(0)))
        assertEquals(meetings.size - 1, decoded.indexOfMeeting(decoded.meetingCode(meetings.size - 1)))
    }

    @Test
    fun rejectsCellsThatBreakTheInvariants() {
        // 확인 필요 칸에 시각, 시각 없는 직행, 범위 밖 시각(19:59, 27:00), 종착역 없는 직행, 종착역 있는 환승, 모르는 분류.
        assertFailsWith<SchemaException> { table({ minutes, _, _ -> minutes[0] = 1300 }) }
        assertFailsWith<SchemaException> { table({ minutes, _, _ -> minutes[1] = none }) }
        assertFailsWith<SchemaException> { table({ minutes, _, _ -> minutes[1] = 1199 }) }
        assertFailsWith<SchemaException> { table({ minutes, _, _ -> minutes[1] = 1620 }) }
        assertFailsWith<SchemaException> { table({ _, _, bounds -> bounds[1] = none }) }
        assertFailsWith<SchemaException> { table({ _, _, bounds -> bounds[2 * cells + meetings.size] = homes[0] }) }
        assertFailsWith<SchemaException> { table({ _, kinds, _ -> kinds[1] = 4 }) }
    }

    @Test
    fun rejectsDamagedFiles() {
        assertFailsWith<SchemaException> { LtBinCodec.decode(lt.copyOf(lt.size - 1)) }
        assertFailsWith<SchemaException> { LtBinCodec.decode(lt + 0) }
        assertFailsWith<SchemaException> { LtBinCodec.decode(lt.copyOf().also { it[3] = 'D'.code.toByte() }) }
        assertFailsWith<SchemaException> { LtBinCodec.decode(lt.copyOf().also { it[4] = 2 }) }
        assertFailsWith<SchemaException> { LtBinCodec.decode(lt.copyOf().also { it[8] = 1 }) }
        assertFailsWith<SchemaException> { LtBinCodec.decode(lt.copyOf().also { it[24] = 1 }) }
    }

    @Test
    fun generationThreeNeedsTheTableItsDateAndItsModel() {
        assertEquals(v3, ManifestCodec.parse(ManifestCodec.encode(v3)))
        assertFailsWith<SchemaException> { ManifestCodec.validate(v3.copy(files = v3.files.copy(lastTrain = null))) }
        assertFailsWith<SchemaException> { ManifestCodec.validate(v3.copy(lastTrainAsOf = null)) }
        assertFailsWith<SchemaException> { ManifestCodec.validate(v3.copy(lastTrainAsOf = "2026-13-01")) }
        assertFailsWith<SchemaException> { ManifestCodec.validate(v3.copy(lastTrainModel = " ")) }
        // 세대 1·2에는 막차 항목이 있으면 안 된다(세대 2만 아는 reader는 모르는 키를 거부한다).
        assertFailsWith<SchemaException> { ManifestCodec.validate(v3.copy(schemaVersion = 2, minClientSchema = 2)) }
    }

    @Test
    fun olderGenerationsOfTheSameDataDropOnlyTheNewerParts() {
        val two = v3.generationTwo()
        assertEquals(2, two.schemaVersion)
        assertEquals(v3.files.odSlots, two.files.odSlots)
        assertNull(two.files.lastTrain)
        assertNull(two.lastTrainAsOf)
        ManifestCodec.validate(two)
        val one = v3.generationOne()
        assertNull(one.files.odSlots)
        assertNull(one.files.lastTrain)
        ManifestCodec.validate(one)
        assertEquals(v3.dataVersion, one.dataVersion)
        assertTrue("lastTrain" !in ManifestCodec.encode(two))
        assertFailsWith<SchemaException> { v1.generationTwo() }
    }

    @Test
    fun loadsTheTableAgainstTheCoreDataSet() {
        val loaded = DataSetLoader.lastTrains(core(), lt)
        assertEquals(table(), loaded)
        // 세대 3 manifest를 세대 2까지만 아는 클라이언트는 거부한다.
        assertFailsWith<SchemaException> {
            DataSetLoader.load(
                DataSetBytes(ManifestCodec.encode(v3), registry, candidates, odBytes),
                supportedSchema = 2,
                deferSlots = true,
            )
        }
    }

    @Test
    fun rejectsATableThatDoesNotBelongToTheDataSet() {
        assertFailsWith<SchemaException> { DataSetLoader.lastTrains(core(), lt.copyOf().also { it[lt.size - 1] = 9 }) }
        // 해시는 맞지만 축이 다르다(만날 역 하나 뺌).
        val narrower = LtBinCodec.encode(table(meetingCodes = meetings.copyOf(meetings.size - 1)))
        val manifest =
            v3.copy(
                files =
                    v3.files.copy(
                        lastTrain = ManifestFile("versions/x/lt.bin", Sha256.hex(narrower), narrower.size.toLong()),
                    ),
            )
        assertFailsWith<SchemaException> { DataSetLoader.lastTrains(core(manifest), narrower) }
        val otherRegistry =
            LtBinCodec.encode(
                LastTrainTable(
                    od.registryVersion + 1,
                    homes,
                    meetings,
                    IntArray(3 * cells) { none },
                    IntArray(3 * cells),
                    IntArray(3 * cells) { none },
                ),
            )
        val stale =
            v3.copy(
                files =
                    v3.files.copy(
                        lastTrain =
                            ManifestFile(
                                "versions/x/lt.bin",
                                Sha256.hex(otherRegistry),
                                otherRegistry.size.toLong(),
                            ),
                    ),
            )
        assertFailsWith<SchemaException> { DataSetLoader.lastTrains(core(stale), otherRegistry) }
        // 세대 2 데이터에는 막차 표가 없다.
        assertFailsWith<SchemaException> { DataSetLoader.lastTrains(core(v3.generationTwo()), lt) }
    }
}
