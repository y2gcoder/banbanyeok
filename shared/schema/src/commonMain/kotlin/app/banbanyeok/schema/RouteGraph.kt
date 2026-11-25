package app.banbanyeok.schema

/**
 * 사람별 경로를 다시 계산하는 노선 그래프(#120, contracts/data-format.md §11). od.bin을 만든 파이프라인 그래프와 같은 노드·간선이고,
 * 구분마다 다른 것은 계통별 타기 대기(배차/2)뿐이라 구분별 대기표를 함께 둔다. 계산은 shared:core의 `RouteSearch`가 한다.
 *
 * - 노드 = (역 코드, 계통). 한 역에 노드가 여럿일 수 있다(호선·계통마다).
 * - 간선은 노드별로 이어 붙인 배열(CSR)이다. 노드 `v`의 간선은 [edgeStart]`(v)` 이상 [edgeEnd]`(v)` 미만이다.
 * - **타고 가는 간선**은 대기 계통이 없다([NO_WAIT]): 시간은 [edgeSeconds] 그대로이고 환승이 아니다.
 * - **갈아타는 간선**(환승 1회)은 대기 계통이 있다: 시간은 [edgeSeconds](걷기) + 그 구분의 그 계통 대기다. 같은 역의 두 노드만 잇는다.
 * - 출발역에서는 그 역의 모든 노드에서 그 노드 계통의 대기만큼 기다리고 시작한다.
 *
 * 생성자는 파일의 구간(§11.2)을 배열 그대로 받는다. 묶을 자연스러운 단위가 없어 LongParameterList는 끈다.
 */
@Suppress("LongParameterList")
public class RouteGraph(
    public val registryVersion: Int,
    lines: List<String>,
    serviceLines: IntArray,
    nodeCodes: IntArray,
    nodeServices: IntArray,
    edgeStarts: IntArray,
    edgeTargets: IntArray,
    edgeTimes: IntArray,
    edgeWaits: IntArray,
    slotWaits: List<IntArray>,
    public val formatVersion: Int = RouteGraphCodec.FORMAT_VERSION,
) {
    /** 화면 표시 노선 이름(웹 노선 색표의 키와 같은 말, 예: "2호선", "수인분당선"). */
    public val lines: List<String> = lines.toList()
    private val serviceLine = serviceLines.copyOf()
    private val codes = nodeCodes.copyOf()
    private val services = nodeServices.copyOf()
    private val starts = edgeStarts.copyOf()
    private val targets = edgeTargets.copyOf()
    private val times = edgeTimes.copyOf()
    private val waitServices = edgeWaits.copyOf()
    private val waits = slotWaits.map { it.copyOf() }

    public val nodeCount: Int get() = codes.size
    public val edgeCount: Int get() = targets.size
    public val serviceCount: Int get() = serviceLine.size

    init {
        schemaCheck(formatVersion in RouteGraphCodec.FORMAT_VERSION..RouteGraphCodec.REGIONAL_FORMAT_VERSION) {
            "지원하지 않는 rg.bin formatVersion=$formatVersion"
        }
        schemaCheck(registryVersion >= 1) { "registryVersion은 1 이상이어야 합니다" }
        schemaCheck(this.lines.isNotEmpty() && this.lines.size <= MAX_LINES) { "노선 수 범위 오류: ${this.lines.size}" }
        schemaCheck(this.lines.distinct().size == this.lines.size) { "노선 이름이 겹칩니다" }
        this.lines.forEach { line ->
            schemaCheck(line.isNotBlank() && line.encodeToByteArray().size <= MAX_LINE_BYTES) { "노선 이름 오류: '$line'" }
        }
        schemaCheck(serviceLine.size in 1..MAX_SERVICES) { "계통 수 범위 오류: ${serviceLine.size}" }
        serviceLine.forEach { schemaCheck(it in this.lines.indices) { "계통의 노선 색인 범위 오류: $it" } }
        schemaCheck(codes.isNotEmpty() && codes.size <= MAX_NODES && services.size == codes.size) { "노드 수 오류" }
        for (v in codes.indices) {
            schemaCheck(codes[v] in 0 until StationCode.CAPACITY) { "노드 $v 역 코드 값 범위 오류: ${codes[v]}" }
            schemaCheck(services[v] in serviceLine.indices) { "노드 $v 계통 색인 범위 오류: ${services[v]}" }
        }
        schemaCheck(starts.size == codes.size + 1 && starts[0] == 0 && starts.last() == targets.size) {
            "간선 시작 위치 배열이 노드 수 + 1이 아니거나 처음·끝이 맞지 않습니다"
        }
        for (v in codes.indices) schemaCheck(starts[v] <= starts[v + 1]) { "간선 시작 위치는 줄지 않아야 합니다 (노드 $v)" }
        schemaCheck(times.size == targets.size && waitServices.size == targets.size) { "간선 배열 길이가 다릅니다" }
        for (v in codes.indices) for (e in starts[v] until starts[v + 1]) checkEdge(v, e)
        schemaCheck(waits.size == TimeSlot.ALL.size) { "구분별 대기표는 구분 ${TimeSlot.ALL.size}개여야 합니다" }
        waits.forEachIndexed { i, table ->
            schemaCheck(table.size == serviceLine.size) { "구분 ${TimeSlot.ALL[i]} 대기표 길이가 계통 수와 다릅니다" }
            table.forEach {
                schemaCheck(
                    it in 1..MAX_SECONDS ||
                        (formatVersion == RouteGraphCodec.REGIONAL_FORMAT_VERSION && it == UNAVAILABLE_WAIT),
                ) {
                    "구분 ${TimeSlot.ALL[i]} 대기 $it 초는 형식 $formatVersion 에서 허용되지 않습니다"
                }
            }
        }
    }

    private fun checkEdge(
        from: Int,
        e: Int,
    ) {
        schemaCheck(targets[e] in codes.indices) { "간선 $e 도착 노드 범위 오류: ${targets[e]}" }
        val wait = waitServices[e]
        schemaCheck(wait == NO_WAIT || wait in serviceLine.indices) { "간선 $e 대기 계통 범위 오류: $wait" }
        val outdoor = wait != NO_WAIT && codes[from] != codes[targets[e]]
        if (outdoor) {
            schemaCheck(formatVersion == RouteGraphCodec.REGIONAL_FORMAT_VERSION && wait == services[targets[e]]) {
                "간선 $e: 외부 도보 환승은 rg v2와 도착 계통 대기가 필요합니다"
            }
        }
        // 타고 가는 간선은 0초일 수 없다. 갈아타는 간선의 걷기는 0초일 수 있다(같은 승강장, 대기만 더한다).
        val range = if (wait == NO_WAIT || outdoor) 1..MAX_SECONDS else 0..MAX_SECONDS
        schemaCheck(times[e] in range) { "간선 $e 시간 ${times[e]} 초가 범위 밖입니다" }
    }

    public fun codeValue(node: Int): Int = codes[node]

    public fun service(node: Int): Int = services[node]

    /** 노드가 속한 계통의 표시 노선 이름. */
    public fun lineOf(node: Int): String = lines[serviceLine[services[node]]]

    public fun lineIndexOfService(service: Int): Int = serviceLine[service]

    public fun edgeStart(node: Int): Int = starts[node]

    public fun edgeEnd(node: Int): Int = starts[node + 1]

    public fun edgeTarget(edge: Int): Int = targets[edge]

    /** 대기를 뺀 시간(초): 타고 가는 간선은 주행, 갈아타는 간선은 걷기. */
    public fun edgeSeconds(edge: Int): Int = times[edge]

    /** 갈아타는 간선이면 그 대기 계통 색인, 타고 가는 간선이면 [NO_WAIT]. */
    public fun edgeWaitService(edge: Int): Int = waitServices[edge]

    /** [slot]의 계통별 대기(초). 색인은 계통 색인이다. 복사본이다. */
    public fun waitsFor(slot: TimeSlot): IntArray = waits[TimeSlot.ALL.indexOf(slot)].copyOf()

    /** 역 코드 값 → 그 역의 노드(오름차순). */
    public val platforms: Map<Int, IntArray> by lazy {
        codes.indices.groupBy { codes[it] }.mapValues { it.value.toIntArray() }
    }

    /** 역 코드를 보존하는 외부 도보 연결. 승차 대기를 뺀 방향별 보행 시간이다. */
    public val outdoorWalks: Map<Int, Map<Int, Int>> by lazy {
        if (formatVersion == RouteGraphCodec.FORMAT_VERSION) {
            emptyMap()
        } else {
            val walks = mutableMapOf<Int, MutableMap<Int, Int>>()
            for (v in codes.indices) {
                for (e in starts[v] until starts[v + 1]) {
                    val target = codes[targets[e]]
                    if (waitServices[e] == NO_WAIT || target == codes[v]) continue
                    val from = walks.getOrPut(codes[v], ::mutableMapOf)
                    from[target] = minOf(from[target] ?: MAX_SECONDS, times[e])
                }
            }
            walks.mapValues { it.value.toMap() }
        }
    }

    internal val rawServiceLines: IntArray get() = serviceLine
    internal val rawCodes: IntArray get() = codes
    internal val rawServices: IntArray get() = services
    internal val rawStarts: IntArray get() = starts
    internal val rawTargets: IntArray get() = targets
    internal val rawTimes: IntArray get() = times
    internal val rawWaitServices: IntArray get() = waitServices
    internal val rawWaits: List<IntArray> get() = waits

    override fun toString(): String =
        "RouteGraph(registryVersion=$registryVersion, nodes=$nodeCount, edges=$edgeCount, lines=${lines.size})"

    public companion object {
        /** 타고 가는 간선(대기 없음, 환승 아님). */
        public const val NO_WAIT: Int = -1
        public const val MAX_SECONDS: Int = 65534

        /** rg v2에서만 쓰는 대기 예약값. 이 구분에 이 계통을 탈 수 없다. */
        public const val UNAVAILABLE_WAIT: Int = 0xFFFF
        internal const val MAX_LINES = 255
        internal const val MAX_LINE_BYTES = 255
        internal const val MAX_SERVICES = 254
        internal const val MAX_NODES = 65535
    }
}

/** rg.bin 인코더/디코더(리틀 엔디언). 형식은 contracts/data-format.md §11. */
public object RouteGraphCodec {
    public const val FORMAT_VERSION: Int = 1
    public const val REGIONAL_FORMAT_VERSION: Int = 2
    public const val HEADER_SIZE: Int = 32
    private const val U8_NONE = 0xFF
    private val MAGIC = byteArrayOf('B'.code.toByte(), 'B'.code.toByte(), 'R'.code.toByte(), 'G'.code.toByte())

    public fun encode(graph: RouteGraph): ByteArray {
        val out = Writer()
        MAGIC.forEach { out.u8(it.toInt() and 0xff) }
        out.u16(graph.formatVersion)
        out.u16(HEADER_SIZE)
        out.u32(0)
        out.u32(graph.registryVersion)
        out.u32(graph.nodeCount)
        out.u32(graph.edgeCount)
        out.u16(graph.lines.size)
        out.u16(graph.serviceCount)
        out.u16(TimeSlot.ALL.size)
        out.u16(0)
        graph.lines.forEach { line ->
            val bytes = line.encodeToByteArray()
            out.u8(bytes.size)
            bytes.forEach { out.u8(it.toInt() and 0xff) }
        }
        graph.rawServiceLines.forEach(out::u8)
        for (v in 0 until graph.nodeCount) {
            out.u16(graph.rawCodes[v])
            out.u8(graph.rawServices[v])
        }
        graph.rawStarts.forEach(out::u32)
        for (e in 0 until graph.edgeCount) {
            out.u16(graph.rawTargets[e])
            out.u16(graph.rawTimes[e])
            out.u8(graph.rawWaitServices[e].let { if (it == RouteGraph.NO_WAIT) U8_NONE else it })
        }
        graph.rawWaits.forEach { table -> table.forEach(out::u16) }
        return out.bytes()
    }

    public fun decode(bytes: ByteArray): RouteGraph {
        val r = Reader(bytes)
        val header = header(r, bytes)
        val lines = List(header.lines) { r.text(r.u8()) }
        val serviceLines = IntArray(header.services) { r.u8() }
        val codes = IntArray(header.nodes)
        val services = IntArray(header.nodes)
        for (v in codes.indices) {
            codes[v] = r.u16()
            services[v] = r.u8()
        }
        val starts = LongArray(header.nodes + 1) { r.u32() }
        starts.forEach { schemaCheck(it <= header.edges) { "간선 시작 위치 범위 오류: $it" } }
        val targets = IntArray(header.edges)
        val times = IntArray(header.edges)
        val waits = IntArray(header.edges)
        for (e in targets.indices) {
            targets[e] = r.u16()
            times[e] = r.u16()
            waits[e] = r.u8().let { if (it == U8_NONE) RouteGraph.NO_WAIT else it }
        }
        val slotWaits = List(TimeSlot.ALL.size) { IntArray(header.services) { r.u16() } }
        schemaCheck(r.position == bytes.size) { "rg.bin 길이가 맞지 않습니다: 읽은 ${r.position}, 실제 ${bytes.size}" }
        return RouteGraph(
            header.registryVersion,
            lines,
            serviceLines,
            codes,
            services,
            IntArray(starts.size) { starts[it].toInt() },
            targets,
            times,
            waits,
            slotWaits,
            header.version,
        )
    }

    private class Header(
        val version: Int,
        val registryVersion: Int,
        val nodes: Int,
        val edges: Int,
        val lines: Int,
        val services: Int,
    )

    /** §11.1 헤더를 읽고 검사한 뒤 본문 시작(headerSize)으로 옮긴다. */
    private fun header(
        r: Reader,
        bytes: ByteArray,
    ): Header {
        schemaCheck(bytes.size >= HEADER_SIZE) { "rg.bin이 헤더($HEADER_SIZE 바이트)보다 짧습니다: ${bytes.size}" }
        for (i in MAGIC.indices) schemaCheck(bytes[i] == MAGIC[i]) { "rg.bin magic이 'BBRG'가 아닙니다" }
        r.skip(MAGIC.size)
        val version = r.u16()
        schemaCheck(version in FORMAT_VERSION..REGIONAL_FORMAT_VERSION) { "지원하지 않는 rg.bin formatVersion=$version" }
        val headerSize = r.u16()
        schemaCheck(headerSize >= HEADER_SIZE && headerSize <= bytes.size) { "headerSize=$headerSize 가 올바르지 않습니다" }
        val flags = r.u32()
        schemaCheck(flags == 0L) { "알 수 없는 flags=$flags" }
        val registryVersion = r.u32()
        schemaCheck(registryVersion in 1..Int.MAX_VALUE.toLong()) { "registryVersion=$registryVersion 범위 오류" }
        val nodeCount = r.u32()
        val edgeCount = r.u32()
        schemaCheck(nodeCount in 1..RouteGraph.MAX_NODES.toLong()) { "노드 수 범위 오류: $nodeCount" }
        schemaCheck(edgeCount in 0..MAX_EDGES) { "간선 수 범위 오류: $edgeCount" }
        val lineCount = r.u16()
        val serviceCount = r.u16()
        val slotCount = r.u16()
        schemaCheck(slotCount == TimeSlot.ALL.size) { "구분 수 $slotCount 는 ${TimeSlot.ALL.size}이어야 합니다" }
        schemaCheck(r.u16() == 0) { "reserved 영역이 0이 아닙니다" }
        r.seek(headerSize)
        return Header(version, registryVersion.toInt(), nodeCount.toInt(), edgeCount.toInt(), lineCount, serviceCount)
    }

    private const val MAX_EDGES = 1_000_000L

    private class Writer {
        private var buffer = ByteArray(INITIAL)
        private var size = 0

        fun u8(v: Int) {
            if (size == buffer.size) buffer = buffer.copyOf(buffer.size * 2)
            buffer[size++] = v.toByte()
        }

        fun u16(v: Int) {
            require(v in 0..0xFFFF) { "u16 범위 밖: $v" }
            u8(v and 0xff)
            u8(v ushr 8)
        }

        fun u32(v: Int) {
            require(v >= 0) { "u32 범위 밖: $v" }
            u16(v and 0xffff)
            u16(v ushr 16)
        }

        fun bytes(): ByteArray = buffer.copyOf(size)

        private companion object {
            const val INITIAL = 32 * 1024
        }
    }

    private class Reader(
        private val bytes: ByteArray,
    ) {
        var position = 0
            private set

        fun skip(n: Int) {
            position += n
        }

        fun seek(to: Int) {
            position = to
        }

        fun u8(): Int {
            schemaCheck(position < bytes.size) { "rg.bin이 잘렸습니다(위치 $position)" }
            return bytes[position++].toInt() and 0xff
        }

        fun u16(): Int = u8() or (u8() shl 8)

        fun u32(): Long = u16().toLong() or (u16().toLong() shl 16)

        fun text(length: Int): String {
            schemaCheck(position + length <= bytes.size) { "rg.bin이 잘렸습니다(위치 $position)" }
            val text =
                try {
                    bytes.decodeToString(position, position + length, throwOnInvalidSequence = true)
                } catch (e: CharacterCodingException) {
                    throw SchemaException("노선 이름이 UTF-8이 아닙니다(위치 $position)", e)
                }
            position += length
            return text
        }
    }
}
