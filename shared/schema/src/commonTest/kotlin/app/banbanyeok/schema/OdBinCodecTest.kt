package app.banbanyeok.schema

import app.banbanyeok.contracts.ContractFiles
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class OdBinCodecTest {
    private val fixture = ContractFiles.bytes("fixtures/od.sample.bin")

    @Test
    fun decodesFixtureWrittenByIndependentPythonImplementation() {
        val matrix = OdBinCodec.decode(fixture)
        assertEquals(1, matrix.registryVersion)
        assertEquals(18, matrix.originCount)
        assertEquals(6, matrix.candidateCount)
        assertEquals(404, fixture.size)
    }

    @Test
    fun reencodingFixtureIsByteIdentical() {
        assertContentEquals(fixture, OdBinCodec.encode(OdBinCodec.decode(fixture)))
    }

    @Test
    fun valuesMatchOracleNetwork() {
        // 프로토타입 출력: R1 -> [X,Y,Z,R4,B4,G4] = [10,20,26,15,20,30]분, B7 -> [24,28,12,33,18,22]분.
        val set = loadFixtureSet()
        val byName = set.registry.stations.associateBy { it.name }

        fun time(
            from: String,
            to: String,
        ): Pair<Int, Int> {
            val o = set.od.indexOfOrigin(StationCode.parse(byName.getValue(from).code))
            val c = set.od.indexOfCandidate(StationCode.parse(byName.getValue(to).code))
            return set.od.timeSeconds(o, c) to set.od.transfers(o, c)
        }
        assertEquals(1200 to 1, time("R1", "B4"))
        assertEquals(720 to 0, time("B7", "Z"))
        assertEquals(0 to 0, time("X", "X"))
    }

    @Test
    fun roundTripWithUnreachableCells() {
        val matrix =
            OdMatrix(
                registryVersion = 7,
                originCodes = intArrayOf(3, 99, 32767),
                candidateCodes = intArrayOf(0, 5),
                timesSeconds = intArrayOf(0, 65534, -1, 30, 120, 254),
                transfers = intArrayOf(0, 254, -1, 1, 2, 0),
            )
        val bytes = OdBinCodec.encode(matrix)
        assertEquals(32 + 2 * 3 + 2 * 2 + 2 * 6 + 6, bytes.size)
        assertEquals(matrix, OdBinCodec.decode(bytes))
        assertEquals(1, matrix.indexOfOrigin(StationCode.ofValue(99)))
        assertEquals(-1, matrix.indexOfOrigin(StationCode.ofValue(100)))
        assertEquals(-1, matrix.indexOfCandidate(StationCode.ofValue(4)))
    }

    @Test
    fun emptyAxesAreAllowed() {
        val empty = OdMatrix(1, IntArray(0), IntArray(0), IntArray(0), IntArray(0))
        assertEquals(empty, OdBinCodec.decode(OdBinCodec.encode(empty)))
    }

    @Test
    fun writerRejectsOutOfRangeValues() {
        fun matrix(
            time: Int,
            transfer: Int,
        ) = {
            OdMatrix(1, intArrayOf(1), intArrayOf(2), intArrayOf(time), intArrayOf(transfer))
        }
        assertFailsWith<SchemaException> { matrix(65535, 0)() }
        assertFailsWith<SchemaException> { matrix(10, 255)() }
        assertFailsWith<SchemaException> { matrix(-1, 0)() } // 시간만 도달 불가
        assertFailsWith<SchemaException> { matrix(10, -1)() }
        assertFailsWith<SchemaException> { OdMatrix(1, intArrayOf(2, 1), intArrayOf(), IntArray(0), IntArray(0)) }
        assertFailsWith<SchemaException> { OdMatrix(1, intArrayOf(1, 1), intArrayOf(), IntArray(0), IntArray(0)) }
        assertFailsWith<SchemaException> { OdMatrix(1, intArrayOf(32768), intArrayOf(), IntArray(0), IntArray(0)) }
    }

    @Test
    fun readerRejectsCorruptedFiles() {
        fun corrupt(change: (ByteArray) -> ByteArray) =
            assertFailsWith<SchemaException> { OdBinCodec.decode(change(fixture.copyOf())) }

        corrupt { it.copyOf(10) } // 헤더보다 짧음
        corrupt { it.copyOf(it.size - 1) } // 잘림
        corrupt { it + byteArrayOf(0) } // 이어붙임
        corrupt { it.also { b -> b[0] = 'X'.code.toByte() } } // magic
        corrupt { it.also { b -> b[4] = 2 } } // formatVersion
        corrupt { it.also { b -> b[8] = 1 } } // flags
        corrupt { it.also { b -> b[24] = 1 } } // reserved
        corrupt { it.also { b -> b[16] = 19 } } // N 불일치 -> 길이 오류
        corrupt {
            it.also { b ->
                b[32] = b[34]
                b[33] = b[35]
            }
        } // 출발역 코드 중복(오름차순 위반)
        corrupt {
            it.also { b ->
                b[HEADER_TIMES_START] = 0xff.toByte()
                b[HEADER_TIMES_START + 1] = 0xff.toByte()
            }
        } // 시간만 도달 불가
    }

    @Test
    fun layoutIsLittleEndianAsDocumented() {
        val matrix = OdMatrix(0x01020304, intArrayOf(0x0102), intArrayOf(0x0304), intArrayOf(0x0506), intArrayOf(7))
        val bytes = OdBinCodec.encode(matrix)
        assertEquals("BBOD", bytes.copyOfRange(0, 4).decodeToString())
        assertContentEquals(byteArrayOf(1, 0, 32, 0), bytes.copyOfRange(4, 8)) // formatVersion=1, headerSize=32
        assertContentEquals(byteArrayOf(4, 3, 2, 1), bytes.copyOfRange(12, 16)) // registryVersion
        assertContentEquals(byteArrayOf(2, 1, 4, 3, 6, 5, 7), bytes.copyOfRange(32, 39))
        assertTrue(bytes.size == 39)
    }

    private companion object {
        // 헤더 32 + 출발 18*2 + 후보 6*2 = 80: 시간 구간 시작
        const val HEADER_TIMES_START = 80
    }
}

internal fun loadFixtureSet(): DataSet =
    DataSetLoader.load(
        manifestJson = ContractFiles.text("fixtures/manifest.sample.json"),
        registryBytes = ContractFiles.bytes("fixtures/stations.sample.json"),
        candidatesBytes = ContractFiles.bytes("fixtures/candidates.sample.json"),
        odBytes = ContractFiles.bytes("fixtures/od.sample.bin"),
    )
