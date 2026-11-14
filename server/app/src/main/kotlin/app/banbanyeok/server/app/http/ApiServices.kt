package app.banbanyeok.server.app.http

import app.banbanyeok.server.app.application.RoomResultService
import app.banbanyeok.server.app.application.StationDirectory
import app.banbanyeok.server.artifact.PublishedArtifacts
import app.banbanyeok.server.recommendation.RecommendationService
import app.banbanyeok.server.room.AnonUserService
import app.banbanyeok.server.room.RoomService

/** 라우트가 쓰는 서비스 묶음. 라우트는 얇게 두고 규칙은 서비스에 있다. */
class ApiServices(
    val anonUsers: AnonUserService,
    val rooms: RoomService,
    val results: RoomResultService,
    val recommendation: RecommendationService,
    val directory: StationDirectory,
    val published: PublishedArtifacts,
)
