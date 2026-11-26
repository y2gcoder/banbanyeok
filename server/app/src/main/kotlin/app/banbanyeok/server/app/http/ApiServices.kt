package app.banbanyeok.server.app.http

import app.banbanyeok.server.app.application.DailyCounter
import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.app.application.StatelessRecommendation
import app.banbanyeok.server.artifact.PublishedArtifacts
import app.banbanyeok.server.recommendation.StationNames
import app.banbanyeok.server.recommendation.time.TimeSlotResolver
import app.banbanyeok.server.room.AnonUserService
import app.banbanyeok.server.room.RoomService

/**
 * 라우트가 쓰는 서비스 묶음. 라우트는 얇게 두고 규칙은 서비스에 있다. 인자 여덟 개는 서로 다른 서비스·포트를 모아 둔 것이라 묶을 자연스러운 단위가
 * 없다(조립 지점이 한 번 만들어 라우트에 넘긴다). LongParameterList는 끈다.
 */
@Suppress("LongParameterList")
class ApiServices(
    val anonUsers: AnonUserService,
    val rooms: RoomService,
    val results: RoomResultService,
    val stateless: StatelessRecommendation,
    /** 응답에 싣는 역 이름. 응답을 만드는 쪽은 이 포트만 안다. */
    val stations: StationNames,
    val published: PublishedArtifacts,
    /** 방 응답이 싣는 계산 기준의 규칙. 방 결과 계산([results])과 같은 인스턴스다. */
    val times: TimeSlotResolver,
    val counter: DailyCounter,
)
