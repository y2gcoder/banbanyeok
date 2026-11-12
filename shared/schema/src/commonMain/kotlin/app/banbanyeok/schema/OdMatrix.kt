package app.banbanyeok.schema

/**
 * 출발역 N × 후보 M 행렬(시간 정수 초, 환승 횟수). 메모리 표현에서 도달 불가는 -1이다.
 * 파일 형식은 contracts/data-format.md §4 ([OdBinCodec]).
 *
 * 행(출발역)과 열(후보)은 각각 코드 값 엄격 오름차순이다.
 */
public class OdMatrix(
    public val registryVersion: Int,
    originCodes: IntArray,
    candidateCodes: IntArray,
    timesSeconds: IntArray,
    transfers: IntArray,
) {
    private val origins = originCodes.copyOf()
    private val candidates = candidateCodes.copyOf()
    private val times = timesSeconds.copyOf()
    private val changes = transfers.copyOf()

    public val originCount: Int get() = origins.size
    public val candidateCount: Int get() = candidates.size

    init {
        schemaCheck(registryVersion >= 1) { "registryVersion은 1 이상이어야 합니다" }
        requireCodes(origins, "출발역")
        requireCodes(candidates, "후보역")
        val cells = origins.size.toLong() * candidates.size
        schemaCheck(times.size.toLong() == cells && changes.size.toLong() == cells) {
            "행렬 크기가 ${origins.size}×${candidates.size}와 다릅니다 (시간 ${times.size}, 환승 ${changes.size})"
        }
        for (i in times.indices) {
            val t = times[i]
            val x = changes[i]
            schemaCheck((t == UNREACHABLE) == (x == UNREACHABLE)) {
                "칸 $i: 시간과 환승의 도달 불가 표시가 서로 다릅니다 (시간 $t, 환승 $x)"
            }
            schemaCheck(t == UNREACHABLE || t in 0..MAX_SECONDS) { "칸 $i: 시간 $t 은 0..$MAX_SECONDS 이어야 합니다" }
            schemaCheck(x == UNREACHABLE || x in 0..MAX_TRANSFERS) { "칸 $i: 환승 $x 은 0..$MAX_TRANSFERS 이어야 합니다" }
        }
    }

    public fun originCodeValue(index: Int): Int = origins[index]
    public fun candidateCodeValue(index: Int): Int = candidates[index]
    public fun originCode(index: Int): StationCode = StationCode.ofValue(origins[index])
    public fun candidateCode(index: Int): StationCode = StationCode.ofValue(candidates[index])

    /** 코드 값으로 행 인덱스를 찾는다. 없으면 -1. */
    public fun indexOfOrigin(code: StationCode): Int = search(origins, code.value)
    public fun indexOfCandidate(code: StationCode): Int = search(candidates, code.value)

    /** 초. 도달 불가는 [UNREACHABLE]. */
    public fun timeSeconds(origin: Int, candidate: Int): Int = times[cell(origin, candidate)]

    /** 환승 횟수. 도달 불가는 [UNREACHABLE]. */
    public fun transfers(origin: Int, candidate: Int): Int = changes[cell(origin, candidate)]

    private fun cell(origin: Int, candidate: Int): Int {
        require(origin in origins.indices && candidate in candidates.indices) { "인덱스 범위 밖: ($origin, $candidate)" }
        return origin * candidates.size + candidate
    }

    internal fun rawOrigins(): IntArray = origins
    internal fun rawCandidates(): IntArray = candidates
    internal fun rawTimes(): IntArray = times
    internal fun rawTransfers(): IntArray = changes

    override fun equals(other: Any?): Boolean = other is OdMatrix &&
        registryVersion == other.registryVersion && origins.contentEquals(other.origins) &&
        candidates.contentEquals(other.candidates) && times.contentEquals(other.times) &&
        changes.contentEquals(other.changes)

    override fun hashCode(): Int {
        var h = registryVersion
        h = 31 * h + origins.contentHashCode()
        h = 31 * h + candidates.contentHashCode()
        h = 31 * h + times.contentHashCode()
        return 31 * h + changes.contentHashCode()
    }

    override fun toString(): String = "OdMatrix(registryVersion=$registryVersion, ${originCount}x$candidateCount)"

    public companion object {
        public const val UNREACHABLE: Int = -1
        public const val MAX_SECONDS: Int = 65534
        public const val MAX_TRANSFERS: Int = 254

        /** 오름차순 IntArray에서 값의 위치를 찾는다. 없으면 -1. (IntArray.binarySearch는 common stdlib에 없다.) */
        private fun search(sorted: IntArray, value: Int): Int {
            var low = 0
            var high = sorted.size - 1
            while (low <= high) {
                val mid = (low + high) ushr 1
                when {
                    sorted[mid] < value -> low = mid + 1
                    sorted[mid] > value -> high = mid - 1
                    else -> return mid
                }
            }
            return -1
        }

        private fun requireCodes(codes: IntArray, label: String) {
            for (i in codes.indices) {
                schemaCheck(codes[i] in 0 until StationCode.CAPACITY) { "$label 코드 값 범위 오류: ${codes[i]}" }
                schemaCheck(i == 0 || codes[i - 1] < codes[i]) { "$label 코드는 엄격한 오름차순이어야 합니다 (위치 $i)" }
            }
        }
    }
}

/** od.bin 인코더/디코더(리틀 엔디언). 형식은 contracts/data-format.md §4. */
public object OdBinCodec {
    public const val FORMAT_VERSION: Int = 1
    public const val HEADER_SIZE: Int = 32
    private const val TIME_RAW_UNREACHABLE = 0xFFFF
    private const val TRANSFER_RAW_UNREACHABLE = 0xFF
    private val MAGIC = byteArrayOf('B'.code.toByte(), 'B'.code.toByte(), 'O'.code.toByte(), 'D'.code.toByte())

    public fun encode(matrix: OdMatrix): ByteArray {
        val n = matrix.originCount
        val m = matrix.candidateCount
        val out = ByteArray(expectedSize(n.toLong(), m.toLong()).toInt())
        MAGIC.copyInto(out)
        putU16(out, 4, FORMAT_VERSION)
        putU16(out, 6, HEADER_SIZE)
        putU32(out, 8, 0)
        putU32(out, 12, matrix.registryVersion)
        putU32(out, 16, n)
        putU32(out, 20, m)
        // 24..31 reserved = 0
        var pos = HEADER_SIZE
        for (v in matrix.rawOrigins()) { putU16(out, pos, v); pos += 2 }
        for (v in matrix.rawCandidates()) { putU16(out, pos, v); pos += 2 }
        for (t in matrix.rawTimes()) {
            putU16(out, pos, if (t == OdMatrix.UNREACHABLE) TIME_RAW_UNREACHABLE else t)
            pos += 2
        }
        for (x in matrix.rawTransfers()) {
            out[pos++] = (if (x == OdMatrix.UNREACHABLE) TRANSFER_RAW_UNREACHABLE else x).toByte()
        }
        return out
    }

    public fun decode(bytes: ByteArray): OdMatrix {
        schemaCheck(bytes.size >= HEADER_SIZE) { "od.bin이 헤더($HEADER_SIZE 바이트)보다 짧습니다: ${bytes.size}" }
        for (i in MAGIC.indices) schemaCheck(bytes[i] == MAGIC[i]) { "od.bin magic이 'BBOD'가 아닙니다" }
        val version = u16(bytes, 4)
        schemaCheck(version == FORMAT_VERSION) { "지원하지 않는 od.bin formatVersion=$version (지원: $FORMAT_VERSION)" }
        val headerSize = u16(bytes, 6)
        schemaCheck(headerSize >= HEADER_SIZE && headerSize <= bytes.size) { "headerSize=$headerSize 가 올바르지 않습니다" }
        schemaCheck(u32(bytes, 8) == 0L) { "알 수 없는 flags=${u32(bytes, 8)}" }
        val registryVersion = u32(bytes, 12)
        val n = u32(bytes, 16)
        val m = u32(bytes, 20)
        schemaCheck(registryVersion in 1..Int.MAX_VALUE.toLong()) { "registryVersion=$registryVersion 범위 오류" }
        for (i in 24 until 32) schemaCheck(bytes[i] == 0.toByte()) { "reserved 영역이 0이 아닙니다" }
        schemaCheck(n <= StationCode.CAPACITY && m <= StationCode.CAPACITY) { "축 길이 범위 오류: N=$n, M=$m" }
        val expected = expectedSize(n, m, headerSize)
        schemaCheck(bytes.size.toLong() == expected) { "od.bin 길이가 맞지 않습니다: 기대 $expected, 실제 ${bytes.size}" }

        var pos = headerSize
        val origins = IntArray(n.toInt()) { u16(bytes, pos + it * 2) }
        pos += n.toInt() * 2
        val candidates = IntArray(m.toInt()) { u16(bytes, pos + it * 2) }
        pos += m.toInt() * 2
        val cells = n.toInt() * m.toInt()
        val times = IntArray(cells) {
            val raw = u16(bytes, pos + it * 2)
            if (raw == TIME_RAW_UNREACHABLE) OdMatrix.UNREACHABLE else raw
        }
        pos += cells * 2
        val transfers = IntArray(cells) {
            val raw = bytes[pos + it].toInt() and 0xff
            if (raw == TRANSFER_RAW_UNREACHABLE) OdMatrix.UNREACHABLE else raw
        }
        return OdMatrix(registryVersion.toInt(), origins, candidates, times, transfers)
    }

    private fun expectedSize(n: Long, m: Long, headerSize: Int = HEADER_SIZE): Long =
        headerSize + 2 * n + 2 * m + 2 * n * m + n * m

    private fun u16(b: ByteArray, o: Int): Int = (b[o].toInt() and 0xff) or ((b[o + 1].toInt() and 0xff) shl 8)

    private fun u32(b: ByteArray, o: Int): Long =
        (u16(b, o).toLong()) or (u16(b, o + 2).toLong() shl 16)

    private fun putU16(b: ByteArray, o: Int, v: Int) {
        b[o] = v.toByte()
        b[o + 1] = (v ushr 8).toByte()
    }

    private fun putU32(b: ByteArray, o: Int, v: Int) {
        putU16(b, o, v and 0xffff)
        putU16(b, o + 2, v ushr 16)
    }
}
