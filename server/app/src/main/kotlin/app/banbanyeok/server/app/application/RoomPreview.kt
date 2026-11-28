package app.banbanyeok.server.app.application

import app.banbanyeok.schema.TimeBand
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.lasttrain.LastTrainBasis
import app.banbanyeok.server.recommendation.lasttrain.ParticipantLastTrain
import app.banbanyeok.server.recommendation.time.TimeBasis
import app.banbanyeok.server.room.ShareVersion
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

/** 한 사람의 이름표와 시간. 방장이 대신 넣은 칸이 있으면 순번 이름표만 쓰고 시간을 가린다. 출발역 칸은 없다. */
data class PreviewTime(
    val label: String,
    /** 그 역까지 걸리는 시간(초). 갈 수 없거나 공개 미리보기에서 가리면 null. */
    val seconds: Int?,
    /** 그 역에서 돌아가는 막차(#62). 막차 표를 쓸 수 없거나 공개 미리보기에서 가리면 null. */
    val lastTrain: ParticipantLastTrain? = null,
)

data class PreviewStation(
    val stationCode: String,
    /** 참여 순서. */
    val times: List<PreviewTime>,
)

/**
 * "지도 한가운데였다면" 비교(#68 2단계). 미리보기를 만든 같은 평가(같은 행렬·같은 구분)의 [app.banbanyeok.server.recommendation.Evaluation.mapMiddle]을
 * 이름표로 바꾼 것이다. 보일 조건(공평 기준, 1위와 다름, 모두 갈 수 있음, 5분 이상 더 걸림)은 그 함수가 지킨다.
 */
data class PreviewMapMiddle(
    val stationCode: String,
    val stationName: String,
    /** 참여 순서([PreviewStation.times]와 같다). 모두 갈 수 있는 역이라 시간이 늘 있다. */
    val times: List<PreviewMiddleTime>,
)

/** 지도 한가운데 역까지 한 사람의 시간. 이름은 [PreviewTime.label]과 같은 짧은 이름이다. */
data class PreviewMiddleTime(
    val label: String,
    val seconds: Int,
)

/** 방의 기본 기준(보는 사람이 고른 탭이 아니다). */
data class PreviewBasis(
    val mode: RecommendMode,
    /** favor 모드에서 우대하는 사람의 짧은 이름. */
    val favorLabel: String?,
    /** 배려 대상을 뽑기로 정했으면 그 세대에서 몇 번째 뽑기인지(#172). 뽑기 방이 아니거나 아직 안 뽑았으면 null. */
    val drawRound: Int? = null,
)

data class PreviewRoom(
    val roomId: String,
    val shareVersion: ShareVersion,
    val participantCount: Int,
    /** 지금 링크로 새로 들어올 수 있다(자리가 있고 잠기지 않았다). */
    val canJoin: Boolean,
    val meetingDate: LocalDate?,
    val meetingTime: LocalTime?,
    val meetingBand: TimeBand?,
    /** 약속 날짜·시각에서 정한 계산 기준과 문구(방 응답의 `timeBasis`와 같다). */
    val timeBasis: TimeBasis,
    /** 방장이 대신 넣은 칸이 있다(#227). 이름은 순번("참가자 N")이고 사람별 소요시간은 null, 막차·지도 한가운데 비교가 없다. */
    val enteredByHost: Boolean = false,
)

/**
 * 링크 미리보기의 단일 원천. 토큰 없이 한 번 읽은 방으로 만들어 누가 묻든 같고, [PreviewRoom.shareVersion]과 내용이 같은 읽기에서 나온다.
 * 역은 역이 있는 단계에만 있다.
 */
sealed interface RoomPreview {
    val room: PreviewRoom

    /** 2명 미만이거나 모두가 갈 수 있는 후보가 없다. */
    data class Collecting(
        override val room: PreviewRoom,
    ) : RoomPreview

    /** 방 기본 기준의 1위. */
    data class Result(
        override val room: PreviewRoom,
        val dataVersion: String,
        val basis: PreviewBasis,
        val station: PreviewStation,
        /** 막차의 기준. null이면 이 미리보기에는 막차가 없다. */
        val lastTrainBasis: LastTrainBasis? = null,
        /** 지도 한가운데 비교. 보일 조건을 채우지 못하면 null(응답에 키가 없다). 정한 역 단계에는 없다. */
        val mapMiddle: PreviewMapMiddle? = null,
        /** 막차 표를 아직 읽는 중이라 막차가 빠졌다(`Recommendation.lastTrainPending`). 그림은 짧게만 캐시한다. */
        val lastTrainPending: Boolean = false,
    ) : RoomPreview

    /** 정한 역. 순위 밖이어도 그 역까지의 시간을 싣는다. */
    data class Decided(
        override val room: PreviewRoom,
        val dataVersion: String,
        val basis: PreviewBasis,
        val station: PreviewStation,
        /** 정한 사람의 짧은 이름. */
        val decidedBy: String,
        val decidedAt: Instant,
        val lastTrainBasis: LastTrainBasis? = null,
        /** [Result.lastTrainPending]와 같다. */
        val lastTrainPending: Boolean = false,
    ) : RoomPreview
}
