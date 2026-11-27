package app.banbanyeok.server.recommendation.lasttrain

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainCell
import app.banbanyeok.schema.LastTrainTable
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.TimeSlot
import app.banbanyeok.server.recommendation.time.DayCertainty
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId

/**
 * 검증을 마친 막차 표와 그 시간표의 수집일(manifest `lastTrainAsOf`, 서울 날짜). [partialDays]는 시간표가 있는 노선만 계산한
 * 요일 종류다(manifest `lastTrainPartialDays`).
 */
public class LastTrainData(
    public val table: LastTrainTable,
    public val asOf: LocalDate,
    public val partialDays: Set<DayType> = emptySet(),
)

/**
 * 지금 쓸 수 있는 막차 표. 없으면 null이다: 데이터가 세대 3이 아니거나, 아직 뒤에서 읽는 중이거나, 검증에 실패했다. 그러면 응답에서
 * 막차 항목만 빠지고 순위·시간은 그대로다.
 */
public fun interface LastTrainSource {
    public fun current(): LastTrainData?

    /**
     * 이 데이터에 막차 표가 있는데 **아직 읽는 중**이다(서버가 막 떴다). [current]가 null인 이유가 이것일 때만 true다: 데이터에 막차 표가
     * 없거나 검증에 실패했으면 false다. 응답의 `lastTrainPending`으로 나가서, 막차 없는 응답을 오래 캐시하지 않게 한다(공유 그림).
     */
    public fun pending(): Boolean = false
}

/** 막차 시각을 내지 않는 이유(응답 전체에 해당). 이때 사람별 항목은 모두 확인 필요다. */
public enum class LastTrainUnavailable {
    /** 시간표를 받은 지 [LastTrainRule.MAX_AGE_DAYS]일이 넘었다. */
    STALE,
    DAY_UNKNOWN,
    DATE_OUT_OF_RANGE,
}

public data class LastTrainBasis(
    public val dayType: DayType,
    public val asOf: LocalDate,
    public val unavailable: LastTrainUnavailable? = null,
    /** 이 요일 종류는 시간표가 있는 노선만 계산했다: 확인 필요 항목은 시간표가 없는 노선을 지나는 길일 수 있다. */
    public val partial: Boolean = false,
)

/** 한 사람이 만날 역에서 집(출발역)으로 돌아가는 막차. [cell]의 종류가 확인 필요면 시각이 없다. */
public data class ParticipantLastTrain(
    public val participantId: String,
    public val cell: LastTrainCell,
    /** 직행 열차의 행선지(종착역) 표시 이름. 직행이 아니면 null. */
    public val boundName: String? = null,
)

internal object LastTrainRule {
    /** 수집일에서 이만큼 지나면 시각을 내지 않는다(분기 재수집 주기 + 여유). 시간표가 바뀐 뒤의 옛 시각은 늦은 쪽으로 틀릴 수 있다. */
    const val MAX_AGE_DAYS: Long = 120

    val ZONE: ZoneId = ZoneId.of("Asia/Seoul")

    fun stale(
        asOf: LocalDate,
        clock: Clock,
    ): Boolean = LocalDate.now(clock.withZone(ZONE)).isAfter(asOf.plusDays(MAX_AGE_DAYS))

    /** 요청 전체의 기준. 시각을 낼 수 없는 이유가 여럿이면 요일 쪽을 먼저 알린다(사용자가 고칠 수 있는 것). */
    fun basis(
        data: LastTrainData,
        day: DayType,
        certainty: DayCertainty,
        clock: Clock,
    ): LastTrainBasis =
        LastTrainBasis(
            day,
            data.asOf,
            when {
                certainty == DayCertainty.DEFAULTED -> LastTrainUnavailable.DAY_UNKNOWN
                certainty == DayCertainty.OUT_OF_RANGE -> LastTrainUnavailable.DATE_OUT_OF_RANGE
                stale(data.asOf, clock) -> LastTrainUnavailable.STALE
                else -> null
            },
            day in data.partialDays,
        )

    /** [homeCode]에 사는 사람이 [meetingCode]에서 돌아가는 막차. 축에 없는 역이면 확인 필요다. */
    fun cell(
        table: LastTrainTable,
        day: DayType,
        homeCode: String,
        meetingCode: String,
    ): LastTrainCell {
        val home = StationCode.parseOrNull(homeCode)?.let(table::indexOfHome) ?: -1
        val meeting = StationCode.parseOrNull(meetingCode)?.let(table::indexOfMeeting) ?: -1
        return if (home < 0 || meeting < 0) LastTrainCell.UNKNOWN else table.cell(day, home, meeting)
    }
}

/**
 * 순위를 다 정한 뒤 만날 역마다 사람별 막차를 붙인다. 순위·시간·이유 문장에는 쓰이지 않는다.
 */
internal class LastTrainAttacher(
    private val source: LastTrainSource,
    private val clock: Clock,
    /** 역 코드의 표시 이름(직행 열차의 행선지). */
    private val names: (String) -> String?,
) {
    class Rider(
        val id: String,
        val homeCode: String,
    )

    /**
     * 이 요청에 막차를 붙일 수 있으면 그 기준과 조회 함수([Lookup.attached]). 표가 없거나 요청한 구분([requested])으로 계산하지
     * 못했으면([computed]가 다르면) null(막차 항목을 뺀다). 표는 여기서 **한 번** 읽고, 돌려준 값은 그 표만 쓴다.
     * [Lookup.pending]은 표를 아직 읽는 중이라서 빠졌고 **기다리면 시각이 붙을 요청**일 때만 true다. 구분이 달라 빠졌거나, 요일을
     * 믿을 수 없어([certainty]가 [DayCertainty.KNOWN]이 아니다: 구분을 고르지 않은 무상태 요청(v=1 링크), 날짜 없는 방, 공휴일 목록 밖)
     * 표가 와도 모두 확인 필요가 되는 요청은 false다.
     */
    fun forRequest(
        requested: TimeSlot,
        computed: TimeSlot,
        certainty: DayCertainty,
        riders: List<Rider>,
    ): Lookup {
        // 읽는 중인지 먼저 본다: 그 사이 읽기가 끝나면 아래 current()가 표를 주므로, 준비 중이라고 잘못 알리는 일이 없다.
        val pending = source.pending()
        val data =
            source.current()
                ?: return Lookup(null, pending && computed == requested && certainty == DayCertainty.KNOWN)
        if (computed != requested) return Lookup(null, false)
        val basis = LastTrainRule.basis(data, computed.day, certainty, clock)
        return Lookup(Attached(basis, data.table, riders, names), false)
    }

    class Lookup(
        val attached: Attached?,
        val pending: Boolean,
    )

    class Attached(
        val basis: LastTrainBasis,
        private val table: LastTrainTable,
        private val riders: List<Rider>,
        private val names: (String) -> String?,
    ) {
        fun at(stationCode: String): List<ParticipantLastTrain> =
            riders.map { person ->
                val cell =
                    if (basis.unavailable != null) {
                        LastTrainCell.UNKNOWN
                    } else {
                        LastTrainRule.cell(table, basis.dayType, person.homeCode, stationCode)
                    }
                ParticipantLastTrain(
                    person.id,
                    cell,
                    cell.boundFor?.let {
                        names(it.toString())
                            ?: it.toString()
                    },
                )
            }
    }
}
