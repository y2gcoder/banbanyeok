package app.banbanyeok.server.recommendation

import app.banbanyeok.schema.DayType
import app.banbanyeok.schema.LastTrainCell
import app.banbanyeok.schema.LastTrainKind
import app.banbanyeok.schema.LastTrainTable
import app.banbanyeok.schema.StationCode
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
}

/** 요일 종류를 얼마나 믿을 수 있는가. 막차는 요일 종류가 틀리면 늦은 쪽으로 틀리므로(평일 막차가 휴일보다 늦다) 확실할 때만 보인다. */
public enum class DayCertainty {
    /** 사용자가 고른 구분이거나, 공휴일 목록 범위 안의 약속일에서 정했다. */
    KNOWN,

    /** 요일 종류가 주어지지 않아 평일로 계산했다(구분 없는 요청, 약속일 없는 방, 옛 `v=1` 링크). */
    DEFAULTED,

    /** 약속일이 공휴일 목록의 범위 밖이라 평일·토요일이 공휴일일 수 있다. */
    OUT_OF_RANGE,
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

public object LastTrainRule {
    /** 수집일에서 이만큼 지나면 시각을 내지 않는다(분기 재수집 주기 + 여유). 시간표가 바뀐 뒤의 옛 시각은 늦은 쪽으로 틀릴 수 있다. */
    public const val MAX_AGE_DAYS: Long = 120

    public val ZONE: ZoneId = ZoneId.of("Asia/Seoul")

    public fun stale(
        asOf: LocalDate,
        clock: Clock,
    ): Boolean = LocalDate.now(clock.withZone(ZONE)).isAfter(asOf.plusDays(MAX_AGE_DAYS))

    /** 요청 전체의 기준. 시각을 낼 수 없는 이유가 여럿이면 요일 쪽을 먼저 알린다(사용자가 고칠 수 있는 것). */
    public fun basis(
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
    public fun cell(
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
 * **출발역을 숨긴 사람의 막차는 그 사람의 요청([viewerId])에만 넣는다**: 막차 시각으로 숨긴 출발역을 거꾸로 짐작할 수 있다.
 */
internal class LastTrainAttacher(
    private val source: LastTrainSource,
    private val clock: Clock,
    private val names: StationNames,
) {
    /** 이 요청에 막차를 붙일 수 있으면 그 기준과 조회 함수. 표가 없거나 요청한 구분으로 계산하지 못했으면 null(막차 항목을 뺀다). */
    fun forRequest(
        request: RecommendRequest,
        computed: TimeBasis,
    ): Attached? {
        val data = source.current() ?: return null
        if (computed.slot != request.time.slot) return null
        val basis = LastTrainRule.basis(data, computed.slot.day, request.dayCertainty, clock)
        return Attached(basis, data.table, request, names)
    }

    class Attached(
        val basis: LastTrainBasis,
        private val table: LastTrainTable,
        private val request: RecommendRequest,
        private val names: StationNames,
    ) {
        fun at(stationCode: String): List<ParticipantLastTrain> =
            request.participants
                .filter { !it.hidden || it.id == request.viewerId }
                .map { person ->
                    val cell =
                        if (basis.unavailable != null) {
                            LastTrainCell.UNKNOWN
                        } else {
                            LastTrainRule.cell(table, basis.dayType, person.originCode, stationCode)
                        }
                    ParticipantLastTrain(
                        person.id,
                        cell,
                        cell.boundFor?.let {
                            names.nameOf(it.toString())
                                ?: it.toString()
                        },
                    )
                }
    }
}

/** 응답에 쓰는 종류 이름: 직행 확정 / 여유 시각 / 확인 필요. */
public val LastTrainKind.wire: String
    get() =
        when (this) {
            LastTrainKind.DIRECT -> "direct"
            LastTrainKind.MARGIN_TRANSFER, LastTrainKind.MARGIN_DIRECT -> "margin"
            LastTrainKind.UNKNOWN -> "check"
        }
