package app.banbanyeok.server.app

import app.banbanyeok.schema.StationRegion
import app.banbanyeok.server.room.NewHiddenOrigins
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomError
import app.banbanyeok.server.room.RoomException
import app.banbanyeok.server.room.RoomFixture
import app.banbanyeok.server.room.aParticipant
import app.banbanyeok.server.room.aRoom
import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.DescribeSpec
import io.kotest.matchers.shouldBe

/**
 * 부산권을 켠 서버가 만든 방을, 권역 파일을 읽지 않는 서버(되돌린 뒤, 전환 중인 이전 리비전)가 받는 경우. 이 서버가 실은 수도권
 * 산출물(data/artifacts/dev)의 레지스트리에도 부산 역 코드가 권역 없이 들어 있다.
 */
class RegionRollbackTest :
    DescribeSpec({
        val busan = "904"
        val unregistered = "zzz"
        val capital = DevArtifacts.origins.first()
        val otherCapital = DevArtifacts.origins.last()

        suspend fun joinNextTo(
            hostOrigin: String,
            hidden: Boolean = false,
        ) {
            val fixture = RoomFixture(stations = DevArtifacts.directory, newHidden = NewHiddenOrigins.LEGACY_FIXTURE)
            val now = fixture.clock.instant()
            val room = aRoom(createdAt = now)
            val host = aParticipant("host01", now).copy(originCode = hostOrigin, hidden = hidden)
            fixture.rooms.create(room, host)
            fixture.service.join(room.id, ParticipantInput(null, capital), null)
        }

        it("rejects a metropolitan join to a room whose Busan origin the loaded data does not place") {
            shouldThrow<RoomException> { joinNextTo(busan) }.error shouldBe RoomError.REGION_MISMATCH
        }

        it("rejects a join next to an origin code the loaded registry does not have") {
            shouldThrow<RoomException> { joinNextTo(unregistered) }.error shouldBe RoomError.REGION_MISMATCH
        }

        it("places every origin and meeting station of the metropolitan data in the metropolitan region") {
            val directory = DevArtifacts.directory
            directory.originCodes.count(directory::isMeetingStation) shouldBe 127
            directory.originCodes.map(directory::regionOf).toSet() shouldBe setOf(StationRegion.CAPITAL)
        }

        it("keeps metropolitan joins next to metropolitan and legacy hidden origins") {
            joinNextTo(otherCapital)
            joinNextTo(otherCapital, hidden = true)
        }
    })
