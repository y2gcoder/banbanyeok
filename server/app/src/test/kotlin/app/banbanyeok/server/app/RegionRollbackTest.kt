package app.banbanyeok.server.app

import app.banbanyeok.schema.StationRegion
import app.banbanyeok.server.room.CreateRoomCommand
import app.banbanyeok.server.room.NewHiddenOrigins
import app.banbanyeok.server.room.ParticipantInput
import app.banbanyeok.server.room.RoomError
import app.banbanyeok.server.room.RoomException
import app.banbanyeok.server.room.RoomFixture
import app.banbanyeok.server.room.RoomMode
import app.banbanyeok.server.room.RoomService
import app.banbanyeok.server.room.StationCatalog
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
        val capital = DevArtifacts.origins.first()
        val otherCapital = DevArtifacts.origins.last()

        fun rolledBack() = RoomFixture(stations = DevArtifacts.directory, newHidden = NewHiddenOrigins.LEGACY_FIXTURE)

        /** 부산권을 켠 서버. 같은 저장소와 토큰 비밀을 쓴다. */
        fun RoomFixture.enabled(): RoomService {
            val withBusan =
                object : StationCatalog by DevArtifacts.directory {
                    override fun isOrigin(code: String) = code == busan || DevArtifacts.directory.isOrigin(code)

                    override fun regionOf(code: String) =
                        if (code == busan) StationRegion.BUSAN else DevArtifacts.directory.regionOf(code)
                }
            return RoomService(rooms, anonUsers, tokens, ids, withBusan, clock)
        }

        fun command(origin: String) =
            CreateRoomCommand(RoomMode.FAIR, null, null, ParticipantInput(null, origin), null, null)

        it("rejects a metropolitan join to a Busan room") {
            val fixture = rolledBack()
            val room = fixture.enabled().create(command(busan))
            shouldThrow<RoomException> {
                fixture.service.join(room.roomId, ParticipantInput(null, capital), null)
            }.error shouldBe RoomError.REGION_MISMATCH
        }

        it("keeps the only member of a Busan room from moving it to the metropolitan region") {
            val fixture = rolledBack()
            val room = fixture.enabled().create(command(busan))
            shouldThrow<RoomException> {
                fixture.service.updateParticipant(
                    room.roomId,
                    room.participantId,
                    room.participantToken,
                    ParticipantInput(null, capital),
                )
            }.error shouldBe RoomError.REGION_MISMATCH
            fixture.rooms
                .find(room.roomId)!!
                .participants
                .single()
                .originCode shouldBe busan
        }

        it("refuses deciding a station in a Busan room with two Busan members") {
            val fixture = rolledBack()
            val enabled = fixture.enabled()
            val room = enabled.create(command(busan))
            enabled.join(room.roomId, ParticipantInput(null, busan), null)
            val seen = fixture.service.get(room.roomId, null).shareVersion
            val meeting = DevArtifacts.directory.originCodes.first(DevArtifacts.directory::isMeetingStation)
            listOf(meeting to RoomError.REGION_MISMATCH, busan to RoomError.INVALID_STATION).forEach { (code, error) ->
                shouldThrow<RoomException> {
                    fixture.service.decide(room.roomId, room.participantToken, code, seen)
                }.error shouldBe error
            }
        }

        it("takes no station into a room stored under a region this server does not know") {
            val fixture = rolledBack()
            val now = fixture.clock.instant()
            val room = aRoom(createdAt = now) { it.copy(region = null) }
            fixture.rooms.create(room, aParticipant("host01", now).copy(originCode = capital))
            shouldThrow<RoomException> {
                fixture.service.join(room.id, ParticipantInput(null, otherCapital), null)
            }.error shouldBe RoomError.REGION_MISMATCH
        }

        it("keeps a metropolitan room open to metropolitan joins after a member's origin leaves the loaded data") {
            val fixture = rolledBack()
            val now = fixture.clock.instant()
            val room = aRoom(createdAt = now)
            fixture.rooms.create(room, aParticipant("host01", now).copy(originCode = "zzz"))
            fixture.service.join(room.id, ParticipantInput(null, capital), null)
        }

        it("places every origin and meeting station of the metropolitan data in the metropolitan region") {
            val directory = DevArtifacts.directory
            directory.originCodes.count(directory::isMeetingStation) shouldBe 127
            directory.originCodes.map(directory::regionOf).toSet() shouldBe setOf(StationRegion.CAPITAL)
        }

        it("keeps metropolitan joins next to metropolitan and legacy hidden origins") {
            listOf(false, true).forEach { hidden ->
                val fixture = rolledBack()
                val now = fixture.clock.instant()
                val room = aRoom(createdAt = now)
                fixture.rooms.create(room, aParticipant("host01", now).copy(originCode = capital, hidden = hidden))
                fixture.service.join(room.id, ParticipantInput(null, otherCapital), null)
            }
        }
    })
