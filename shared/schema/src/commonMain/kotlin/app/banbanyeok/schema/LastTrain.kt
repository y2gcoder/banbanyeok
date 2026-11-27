package app.banbanyeok.schema

/**
 * 귀갓길 막차의 분류(contracts/data-format.md §10). 값([LastTrainCell.minute])을 화면에서 어떻게 다루는지를 정한다:
 * [DIRECT]는 분 단위 그대로, [MARGIN_TRANSFER]·[MARGIN_DIRECT]는 10분 단위로 내려 "늦어도"로 보인다(내림은 클라이언트가 한다).
 * [SCHEDULED_DIRECT]는 분 그대로 "출발 예정"으로만 보이고, "늦어도 나갈 시각" 요약과 공유 그림에는 쓰지 않는다.
 */
public enum class LastTrainKind(
    public val raw: Int,
) {
    /** 확인 필요: 시간표에서 이음을 찾지 못했거나 그 요일 종류에 허용된 노선만으로는 갈 수 없다. 시각이 없다. */
    UNKNOWN(0),

    /** 직행 확정: 열차 한 대로 가고, 그 노선은 운영사 공식표 대조를 통과했다. */
    DIRECT(1),

    /** 여유 시각: 갈아타는 길. 갈아탈 때마다 여유를 두고 시간표에서 읽은 가장 늦은 첫 승차 시각이다. */
    MARGIN_TRANSFER(2),

    /** 여유 시각: 열차 한 대로 가지만 그 노선은 아직 공식표 대조 전이거나, 부산권 1~4호선처럼 도착 분만 대조했다. */
    MARGIN_DIRECT(3),

    /**
     * 출발 예정: 열차 한 대로 가고 공식표 대조도 통과했지만, 분이 그 역의 계획 도착보다 늦은 계획 출발 분이다(동해선의 `:00`초 출발,
     * ADR-0010). 탈 수 있는 마지막 순간의 하한이 아니다. 권역 세대(manifest 5세대)의 부산권 칸에만 있다.
     */
    SCHEDULED_DIRECT(4),
    ;

    public companion object {
        public fun ofRaw(raw: Int): LastTrainKind? = entries.firstOrNull { it.raw == raw }
    }
}

/** 한 칸(집 역 × 만날 역 × 요일 종류). [minute]는 운행일의 분(24:03 = 1443), [boundFor]는 직행 열차의 종착역 코드 값. */
public data class LastTrainCell(
    val kind: LastTrainKind,
    val minute: Int?,
    val boundFor: StationCode?,
) {
    public companion object {
        public val UNKNOWN: LastTrainCell = LastTrainCell(LastTrainKind.UNKNOWN, null, null)
    }
}

/**
 * 집 역 N × 만날 역 M × 요일 종류 3의 막차 표. 축은 od.bin과 **같은 값·같은 순서**다(행 = 집 역 = od의 출발역, 열 = 만날 역 = od의 후보).
 * 메모리 표현에서 "없음"은 -1이다. 파일 형식은 contracts/data-format.md §10 ([LtBinCodec]).
 */
public class LastTrainTable(
    public val registryVersion: Int,
    homeCodes: IntArray,
    meetingCodes: IntArray,
    minutes: IntArray,
    kinds: IntArray,
    bounds: IntArray,
) {
    private val homes = homeCodes.copyOf()
    private val meetings = meetingCodes.copyOf()
    private val times = minutes.copyOf()
    private val classes = kinds.copyOf()
    private val terminals = bounds.copyOf()

    public val homeCount: Int get() = homes.size
    public val meetingCount: Int get() = meetings.size

    init {
        schemaCheck(registryVersion >= 1) { "registryVersion은 1 이상이어야 합니다" }
        requireAxis(homes, "집 역")
        requireAxis(meetings, "만날 역")
        val cells = homes.size.toLong() * meetings.size * DAY_COUNT
        schemaCheck(
            times.size.toLong() == cells && classes.size.toLong() == cells && terminals.size.toLong() == cells,
        ) {
            "막차 표 크기가 ${homes.size}×${meetings.size}×$DAY_COUNT 과 다릅니다"
        }
        for (i in times.indices) checkCell(i)
    }

    private fun checkCell(i: Int) {
        val kind = LastTrainKind.ofRaw(classes[i]) ?: schemaFail("칸 $i: 알 수 없는 분류 ${classes[i]}")
        val minute = times[i]
        val bound = terminals[i]
        if (kind == LastTrainKind.UNKNOWN) {
            schemaCheck(minute == NONE && bound == NONE) { "칸 $i: 확인 필요 칸에 시각이나 종착역이 있습니다" }
            return
        }
        schemaCheck(minute in MIN_MINUTE..MAX_MINUTE) { "칸 $i: 시각 $minute 은 $MIN_MINUTE..$MAX_MINUTE 이어야 합니다" }
        val direct = kind != LastTrainKind.MARGIN_TRANSFER
        schemaCheck(if (direct) bound in 0 until StationCode.CAPACITY else bound == NONE) {
            "칸 $i: 종착역은 직행 칸에만, 직행 칸에는 반드시 있어야 합니다 (분류 $kind, 종착역 $bound)"
        }
    }

    public fun homeCode(index: Int): StationCode = StationCode.ofValue(homes[index])

    public fun meetingCode(index: Int): StationCode = StationCode.ofValue(meetings[index])

    public fun indexOfHome(code: StationCode): Int = search(homes, code.value)

    public fun indexOfMeeting(code: StationCode): Int = search(meetings, code.value)

    public fun cell(
        day: DayType,
        home: Int,
        meeting: Int,
    ): LastTrainCell {
        require(home in homes.indices && meeting in meetings.indices) { "인덱스 범위 밖: ($home, $meeting)" }
        val i = (day.ordinal * homes.size + home) * meetings.size + meeting
        val kind = requireNotNull(LastTrainKind.ofRaw(classes[i]))
        if (kind == LastTrainKind.UNKNOWN) return LastTrainCell.UNKNOWN
        return LastTrainCell(kind, times[i], terminals[i].takeIf { it != NONE }?.let(StationCode::ofValue))
    }

    /** 축이 [od]와 같은 값·같은 순서인가(행 = 출발역, 열 = 후보). */
    public fun sameAxesAs(od: OdMatrix): Boolean =
        homes.contentEquals(od.rawOrigins) && meetings.contentEquals(od.rawCandidates)

    internal val rawHomes: IntArray get() = homes

    internal val rawMeetings: IntArray get() = meetings

    internal val rawMinutes: IntArray get() = times

    internal val rawKinds: IntArray get() = classes

    internal val rawBounds: IntArray get() = terminals

    override fun equals(other: Any?): Boolean =
        other is LastTrainTable &&
            registryVersion == other.registryVersion && homes.contentEquals(other.homes) &&
            meetings.contentEquals(other.meetings) && times.contentEquals(other.times) &&
            classes.contentEquals(other.classes) && terminals.contentEquals(other.terminals)

    override fun hashCode(): Int {
        var h = registryVersion
        h = 31 * h + homes.contentHashCode()
        h = 31 * h + meetings.contentHashCode()
        h = 31 * h + times.contentHashCode()
        h = 31 * h + classes.contentHashCode()
        return 31 * h + terminals.contentHashCode()
    }

    override fun toString(): String = "LastTrainTable(registryVersion=$registryVersion, ${homeCount}x$meetingCount)"

    public companion object {
        public const val NONE: Int = -1

        /** 요일 종류 수. 판의 순서는 [DayType]의 순서(평일, 토요일, 휴일)다. */
        public const val DAY_COUNT: Int = 3

        /** 20:00. 그 전에 떠나야 닿는 길은 찾지 않는다(확인 필요). */
        public const val MIN_MINUTE: Int = 1200

        /** 26:59. 운행일은 03:00에 바뀐다. */
        public const val MAX_MINUTE: Int = 1619

        private fun search(
            sorted: IntArray,
            value: Int,
        ): Int {
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

        private fun requireAxis(
            codes: IntArray,
            label: String,
        ) {
            for (i in codes.indices) {
                schemaCheck(codes[i] in 0 until StationCode.CAPACITY) { "$label 코드 값 범위 오류: ${codes[i]}" }
                schemaCheck(i == 0 || codes[i - 1] < codes[i]) { "$label 코드는 엄격한 오름차순이어야 합니다 (위치 $i)" }
            }
        }
    }
}

/** lt.bin 인코더/디코더(리틀 엔디언). 형식은 contracts/data-format.md §10. */
public object LtBinCodec {
    public const val FORMAT_VERSION: Int = 1
    public const val HEADER_SIZE: Int = 32
    private const val U16_NONE = 0xFFFF
    private const val BYTES_PER_CELL = 5L
    private val MAGIC = byteArrayOf('B'.code.toByte(), 'B'.code.toByte(), 'L'.code.toByte(), 'T'.code.toByte())

    public fun encode(table: LastTrainTable): ByteArray {
        val n = table.homeCount
        val m = table.meetingCount
        val out = ByteArray(expectedSize(n.toLong(), m.toLong()).toInt())
        MAGIC.copyInto(out)
        putU16(out, 4, FORMAT_VERSION)
        putU16(out, 6, HEADER_SIZE)
        putU32(out, 8, 0)
        putU32(out, 12, table.registryVersion)
        putU32(out, 16, n)
        putU32(out, 20, m)
        // 24..31 reserved = 0
        var pos = HEADER_SIZE
        for (v in table.rawHomes) {
            putU16(out, pos, v)
            pos += 2
        }
        for (v in table.rawMeetings) {
            putU16(out, pos, v)
            pos += 2
        }
        val cells = n * m
        for (day in 0 until LastTrainTable.DAY_COUNT) {
            val from = day * cells
            for (i in from until from + cells) {
                putU16(out, pos, table.rawMinutes[i].orNone())
                pos += 2
            }
            for (i in from until from + cells) out[pos++] = table.rawKinds[i].toByte()
            for (i in from until from + cells) {
                putU16(out, pos, table.rawBounds[i].orNone())
                pos += 2
            }
        }
        return out
    }

    public fun decode(bytes: ByteArray): LastTrainTable {
        schemaCheck(bytes.size >= HEADER_SIZE) { "lt.bin이 헤더($HEADER_SIZE 바이트)보다 짧습니다: ${bytes.size}" }
        for (i in MAGIC.indices) schemaCheck(bytes[i] == MAGIC[i]) { "lt.bin magic이 'BBLT'가 아닙니다" }
        val version = u16(bytes, 4)
        schemaCheck(version == FORMAT_VERSION) { "지원하지 않는 lt.bin formatVersion=$version (지원: $FORMAT_VERSION)" }
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
        schemaCheck(bytes.size.toLong() == expected) { "lt.bin 길이가 맞지 않습니다: 기대 $expected, 실제 ${bytes.size}" }

        var pos = headerSize
        val homes = IntArray(n.toInt()) { u16(bytes, pos + it * 2) }
        pos += n.toInt() * 2
        val meetings = IntArray(m.toInt()) { u16(bytes, pos + it * 2) }
        pos += m.toInt() * 2
        val cells = n.toInt() * m.toInt()
        val total = cells * LastTrainTable.DAY_COUNT
        val minutes = IntArray(total)
        val kinds = IntArray(total)
        val bounds = IntArray(total)
        for (day in 0 until LastTrainTable.DAY_COUNT) {
            val from = day * cells
            for (i in 0 until cells) minutes[from + i] = u16(bytes, pos + i * 2).fromNone()
            pos += cells * 2
            for (i in 0 until cells) kinds[from + i] = bytes[pos + i].toInt() and 0xff
            pos += cells
            for (i in 0 until cells) bounds[from + i] = u16(bytes, pos + i * 2).fromNone()
            pos += cells * 2
        }
        return LastTrainTable(registryVersion.toInt(), homes, meetings, minutes, kinds, bounds)
    }

    private fun Int.orNone(): Int = if (this == LastTrainTable.NONE) U16_NONE else this

    private fun Int.fromNone(): Int = if (this == U16_NONE) LastTrainTable.NONE else this

    private fun expectedSize(
        n: Long,
        m: Long,
        headerSize: Int = HEADER_SIZE,
    ): Long = headerSize + 2 * n + 2 * m + LastTrainTable.DAY_COUNT * BYTES_PER_CELL * n * m

    private fun u16(
        b: ByteArray,
        o: Int,
    ): Int = (b[o].toInt() and 0xff) or ((b[o + 1].toInt() and 0xff) shl 8)

    private fun u32(
        b: ByteArray,
        o: Int,
    ): Long = (u16(b, o).toLong()) or (u16(b, o + 2).toLong() shl 16)

    private fun putU16(
        b: ByteArray,
        o: Int,
        v: Int,
    ) {
        b[o] = v.toByte()
        b[o + 1] = (v ushr 8).toByte()
    }

    private fun putU32(
        b: ByteArray,
        o: Int,
        v: Int,
    ) {
        putU16(b, o, v and 0xffff)
        putU16(b, o + 2, v ushr 16)
    }
}
