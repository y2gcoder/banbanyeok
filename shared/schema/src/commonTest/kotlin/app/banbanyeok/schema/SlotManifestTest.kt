package app.banbanyeok.schema

import app.banbanyeok.contracts.ContractFiles
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertSame

/** manifest 세대 2(구분별 od 행렬, data-format §5). 장난감 픽스처의 od.bin을 구분마다 다른 경로로 다시 쓴다. */
class SlotManifestTest {
    private val v1 = ManifestCodec.parse(ContractFiles.text("fixtures/manifest.sample.json"))
    private val registry = ContractFiles.bytes("fixtures/stations.sample.json")
    private val candidates = ContractFiles.bytes("fixtures/candidates.sample.json")
    private val od = ContractFiles.bytes("fixtures/od.sample.bin")
    private val others = TimeSlot.ALL.filter { it != TimeSlot.DEFAULT }

    private fun slotFile(
        slot: TimeSlot,
        content: ByteArray = od,
    ) = ManifestFile("versions/x/od-${slot.id}.bin", Sha256.hex(content), content.size.toLong())

    private val v2 =
        v1.copy(
            schemaVersion = 2,
            minClientSchema = 2,
            files = v1.files.copy(odSlots = others.associate { it.id to slotFile(it) }),
        )

    private fun load(
        manifest: Manifest = v2,
        slots: Map<String, ByteArray> = others.associate { it.id to od },
    ) = DataSetLoader.load(ManifestCodec.encode(manifest), registry, candidates, od, odSlotBytes = slots)

    @Test
    fun loadsEverySlotWithTheSameAxes() {
        val set = load()
        assertEquals(11, set.odSlots.size)
        assertSame(set.od, set.odFor(TimeSlot.DEFAULT))
        val night = TimeSlot(DayType.SATURDAY, TimeBand.NIGHT)
        assertEquals(set.od.timeSeconds(0, 1), set.odFor(night)?.timeSeconds(0, 1))
        assertEquals(v2, ManifestCodec.parse(ManifestCodec.encode(v2)))
    }

    @Test
    fun slotsWithTheSameContentShareOneFileAndOneMatrix() {
        val saturdayNight = TimeSlot(DayType.SATURDAY, TimeBand.NIGHT)
        val holidayNight = TimeSlot(DayType.HOLIDAY, TimeBand.NIGHT)
        val shared =
            v2.files.odSlots
                .orEmpty()
                .getValue(saturdayNight.id)
        val manifest =
            v2.copy(
                files = v2.files.copy(odSlots = v2.files.odSlots.orEmpty() + (holidayNight.id to shared)),
            )
        val set = load(manifest)
        assertSame(set.odFor(saturdayNight), set.odFor(holidayNight))
    }

    @Test
    fun generationOneHasOnlyTheDefaultSlot() {
        val set = DataSetLoader.load(ManifestCodec.encode(v1), registry, candidates, od)
        assertNull(set.odFor(TimeSlot(DayType.HOLIDAY, TimeBand.MORNING)))
        assertFailsWith<SchemaException> { ManifestCodec.validate(v1.copy(files = v2.files)) }
    }

    @Test
    fun rejectsIncompleteOrUnknownSlots() {
        val files = v2.files.odSlots.orEmpty()
        val missing = v2.copy(files = v2.files.copy(odSlots = files - "holiday-night"))
        assertFailsWith<SchemaException> { ManifestCodec.validate(missing) }
        val withDefault =
            v2.copy(
                files = v2.files.copy(odSlots = files + ("weekday-day" to slotFile(TimeSlot.DEFAULT))),
            )
        assertFailsWith<SchemaException> { ManifestCodec.validate(withDefault) }
        val unknown =
            v2.copy(
                files =
                    v2.files.copy(
                        odSlots =
                            files - "holiday-night" + ("holiday-dawn" to files.getValue("holiday-night")),
                    ),
            )
        assertFailsWith<SchemaException> { ManifestCodec.validate(unknown) }
        val samePathOtherHash =
            v2.copy(
                files =
                    v2.files.copy(
                        odSlots =
                            files + ("holiday-night" to v2.files.od.copy(sha256 = "0".repeat(64))),
                    ),
            )
        assertFailsWith<SchemaException> { ManifestCodec.validate(samePathOtherHash) }
        assertFailsWith<SchemaException> { load(manifest = v2.copy(schemaVersion = 3, minClientSchema = 3)) }
    }

    @Test
    fun rejectsTamperedOrMisalignedSlotFiles() {
        val slots = others.associate { it.id to od }
        assertFailsWith<SchemaException> { load(slots = slots - "weekday-night") }
        val tampered = od.copyOf().also { it[it.size - 1] = 7 }
        assertFailsWith<SchemaException> { load(slots = slots + ("weekday-night" to tampered)) }
        // 축이 다른 행렬(후보 하나 뺌): 해시는 맞춰도 축 검사에서 거부한다.
        val base = OdBinCodec.decode(od)
        val narrower =
            OdBinCodec.encode(
                OdMatrix(
                    base.registryVersion,
                    IntArray(base.originCount) { base.originCodeValue(it) },
                    IntArray(base.candidateCount - 1) { base.candidateCodeValue(it) },
                    IntArray(base.originCount * (base.candidateCount - 1)) { 60 },
                    IntArray(base.originCount * (base.candidateCount - 1)) { 0 },
                ),
            )
        val manifest =
            v2.copy(
                files =
                    v2.files.copy(
                        odSlots =
                            v2.files.odSlots.orEmpty() +
                                ("weekday-night" to slotFile(TimeSlot(DayType.WEEKDAY, TimeBand.NIGHT), narrower)),
                    ),
            )
        assertFailsWith<SchemaException> { load(manifest, slots + ("weekday-night" to narrower)) }
    }

    @Test
    fun clientThatOnlyReadsGenerationOneRefusesGenerationTwo() {
        assertFailsWith<SchemaException> {
            DataSetLoader.load(ManifestCodec.encode(v2), registry, candidates, od, supportedSchema = 1)
        }
    }
}
