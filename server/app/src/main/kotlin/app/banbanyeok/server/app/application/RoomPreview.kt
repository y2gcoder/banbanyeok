package app.banbanyeok.server.app.application

import app.banbanyeok.schema.TimeBand
import app.banbanyeok.server.recommendation.RecommendMode
import app.banbanyeok.server.recommendation.TimeBasis
import app.banbanyeok.server.room.ShareVersion
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

/** 한 사람의 이름과 시간. 이름은 짧은 이름(숨긴 사람은 "참가자 N")이다. 출발역 칸은 없다. */
data class PreviewTime(
    val label: String,
    /** 그 역까지 걸리는 시간(초). 갈 수 없으면 null. */
    val seconds: Int?,
)

data class PreviewStation(
    val stationCode: String,
    /** 참여 순서. */
    val times: List<PreviewTime>,
)

/** 방의 기본 기준(보는 사람이 고른 탭이 아니다). */
data class PreviewBasis(
    val mode: RecommendMode,
    /** favor 모드에서 우대하는 사람의 짧은 이름. */
    val favorLabel: String?,
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
    ) : RoomPreview
}
