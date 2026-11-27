package app.banbanyeok.server.room

import app.banbanyeok.schema.TimeBand
import io.kotest.core.spec.style.scopes.DescribeSpecRootScope
import io.kotest.matchers.collections.shouldBeStrictlyIncreasing
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import java.time.LocalDate
import java.time.LocalTime

private const val DECIDED = "130"
private const val OTHER = "225"

/** 한 번의 저장소 쓰기가 공유 번호를 정확히 1 올리는지(아니면 그대로인지), 정한 역을 푸는지. */
private class ShareCase(
    val name: String,
    val bumps: Boolean,
    val releases: Boolean,
    val write: suspend RoomRepository.(roomId: String) -> Unit,
)

private fun participantChange(
    nickname: String? = null,
    origin: String = "03v",
) = ParticipantChange(nickname, origin, T0.plusSeconds(90))

private val shareCases =
    listOf(
        ShareCase("a join", bumps = true, releases = true) {
            addParticipant(it, aParticipant("pid003", T0.plusSeconds(3)), activity(3))
        },
        ShareCase("an origin change", bumps = true, releases = true) {
            updateParticipant(it, "pid002", participantChange(origin = OTHER), activity(3))
        },
        ShareCase("a leave", bumps = true, releases = true) { removeParticipant(it, "pid002", activity(3)) },
        ShareCase("removing the decider", bumps = true, releases = true) {
            removeParticipant(it, "host01", activity(3))
        },
        ShareCase("a nickname change", bumps = true, releases = false) {
            updateParticipant(it, "pid002", participantChange(nickname = "지연"), activity(3))
        },
        ShareCase("a mode change", bumps = true, releases = false) {
            updateRoom(it, RoomChange(mode = RoomMode.FAST), activity(3))
        },
        ShareCase("a favor target change", bumps = true, releases = false) {
            updateRoom(it, RoomChange(mode = RoomMode.FAVOR, favorParticipantId = Change.Set("pid002")), activity(3))
        },
        ShareCase("a lock", bumps = true, releases = false) { updateRoom(it, RoomChange(locked = true), activity(3)) },
        ShareCase("a meeting date", bumps = true, releases = false) {
            updateRoom(it, RoomChange(meetingDate = Change.Set(LocalDate.parse("2026-11-21"))), activity(3))
        },
        ShareCase("a meeting time", bumps = true, releases = false) {
            updateRoom(it, RoomChange(meetingTime = Change.Set(LocalTime.of(8, 0))), activity(3))
        },
        ShareCase("a meeting band", bumps = true, releases = false) {
            updateRoom(
                it,
                RoomChange(meetingTime = Change.Set(null), meetingBand = Change.Set(TimeBand.NIGHT)),
                activity(3),
            )
        },
        ShareCase("a participant save with the same values", bumps = false, releases = false) {
            updateParticipant(it, "pid002", participantChange(), activity(3))
        },
        ShareCase("a room save that changes only the activity", bumps = false, releases = false) {
            updateRoom(it, RoomChange(), activity(3))
        },
        ShareCase("a band-only change refused because the room has a meeting time", bumps = false, releases = false) {
            updateRoom(
                it,
                RoomChange(meetingBand = Change.Set(TimeBand.NIGHT), onlyWithoutMeetingTime = true),
                activity(3),
            )
        },
        ShareCase("an outcome answer", bumps = false, releases = false) {
            recordOutcome(it, Outcome(OutcomeKind.TOP1, null), activity(3))
        },
    )

/** host01·pid002가 있고 meetingTime 19:00, host01이 [DECIDED]로 정한 방. */
private suspend fun RoomRepository.decidedRoom(): String {
    val room = aRoom(freshId()) { it.copy(meetingTime = LocalTime.of(19, 0)) }
    create(room, listOf(aParticipant("host01")))
    addParticipant(room.id, aParticipant("pid002", T0.plusSeconds(1)), activity(1))
    val seen = find(room.id)!!.room.shareVersion
    decide(room.id, DecisionRequest("host01", Decision(DECIDED, "host01", T0.plusSeconds(2)), seen), 2) shouldBe
        DecisionResult.Applied
    return room.id
}

private suspend fun RoomRepository.decide(
    roomId: String,
    request: DecisionRequest,
    minutes: Long,
    rule: DecisionRule = fakeDecisionRule,
) = writeDecision(roomId, request, activity(minutes), rule)

private suspend fun RoomRepository.version(roomId: String): ShareVersion = find(roomId)!!.room.shareVersion

internal fun DescribeSpecRootScope.shareVersions(repos: () -> RepositoryPair) {
    describe("share version and the decided station (DB triggers and their in-memory mirror)") {
        for (case in shareCases) {
            val effect =
                when {
                    case.releases -> "bumps the version once and releases the decision"
                    case.bumps -> "bumps the version once and keeps the decision"
                    else -> "leaves the version and the decision alone"
                }
            it("${case.name} $effect") {
                val rooms = repos().rooms
                val roomId = rooms.decidedRoom()
                val before = rooms.find(roomId)!!.room
                case.write(rooms, roomId)
                val after = rooms.find(roomId)!!.room
                after.shareVersion.value shouldBe before.shareVersion.value + if (case.bumps) 1 else 0
                if (case.releases) {
                    after.decision.shouldBeNull()
                    after.decisionBasis shouldBe after.shareVersion
                } else {
                    after.decision shouldBe before.decision
                    after.decisionBasis shouldBe before.decisionBasis
                }
            }
        }

        it("counts the host joining a new room as the first change and stamps the basis when a decision is made") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01")))
            rooms.version(room.id) shouldBe ShareVersion(1)
            val roomId = rooms.decidedRoom()
            val decided = rooms.find(roomId)!!.room
            decided.decision shouldBe Decision(DECIDED, "host01", T0.plusSeconds(2))
            decided.decisionBasis shouldBe decided.shareVersion
            decided.lastActivityAt shouldBe activity(2).at
        }

        it("never repeats a version when the room returns to an earlier state (join, leave, hide, unhide)") {
            val rooms = repos().rooms
            val room = aRoom(freshId())
            rooms.create(room, listOf(aParticipant("host01")))
            val versions = mutableListOf(rooms.version(room.id))
            rooms.addParticipant(room.id, aParticipant("pid002", T0.plusSeconds(1)), activity(1))
            versions += rooms.version(room.id)
            rooms.removeParticipant(room.id, "pid002", activity(2))
            versions += rooms.version(room.id)
            for ((n, nickname) in listOf("지연", null, "지연").withIndex()) {
                rooms.updateParticipant(room.id, "host01", participantChange(nickname = nickname), activity(3L + n))
                versions += rooms.version(room.id)
            }
            versions.map { it.value }.shouldBeStrictlyIncreasing()
        }
    }
}

internal fun DescribeSpecRootScope.decisions(repos: () -> RepositoryPair) {
    describe("writeDecision") {
        it("treats a repeat of the decided station and an empty undo as no-ops, even from an old screen") {
            val rooms = repos().rooms
            val roomId = rooms.decidedRoom()
            val decided = rooms.find(roomId)!!.room
            val old = ShareVersion(decided.shareVersion.value - 1)
            rooms.decide(roomId, DecisionRequest("pid002", Decision(DECIDED, "pid002", T0), old), 5) shouldBe
                DecisionResult.Unchanged
            rooms.find(roomId)!!.room shouldBe decided

            rooms.decide(roomId, DecisionRequest("host01", null, decided.shareVersion), 6) shouldBe
                DecisionResult.Applied
            val undone = rooms.find(roomId)!!.room
            undone.decision.shouldBeNull()
            rooms.decide(roomId, DecisionRequest("pid002", null, old), 7) shouldBe DecisionResult.Unchanged
            rooms.find(roomId)!!.room shouldBe undone
        }

        it("refuses a screen from before the last input change, and a version from the future") {
            val rooms = repos().rooms
            val roomId = rooms.decidedRoom()
            val seen = rooms.version(roomId)
            rooms.updateParticipant(roomId, "pid002", participantChange(origin = OTHER), activity(3))
            val other = Decision(OTHER, "pid002", T0)
            rooms.decide(roomId, DecisionRequest("pid002", other, seen), 4) shouldBe DecisionResult.Stale
            val future = ShareVersion(rooms.version(roomId).value + 1)
            rooms.decide(roomId, DecisionRequest("pid002", other, future), 4) shouldBe DecisionResult.Stale
            rooms
                .find(roomId)!!
                .room.decision
                .shouldBeNull()
            rooms.decide(roomId, DecisionRequest("pid002", other, rooms.version(roomId)), 5) shouldBe
                DecisionResult.Applied
        }
    }
}

internal fun DescribeSpecRootScope.decisionGuards(repos: () -> RepositoryPair) {
    describe("writeDecision guards") {
        it("refuses to replace or undo a decision the screen never saw, then accepts it after a refresh") {
            val rooms = repos().rooms
            val roomId = rooms.decidedRoom()
            val seenBefore = ShareVersion(rooms.version(roomId).value - 1)
            val replace = Decision(OTHER, "pid002", T0.plusSeconds(4))
            rooms.decide(roomId, DecisionRequest("pid002", replace, seenBefore), 4) shouldBe DecisionResult.Stale
            rooms.decide(roomId, DecisionRequest("pid002", null, seenBefore), 4) shouldBe DecisionResult.Stale
            rooms
                .find(roomId)!!
                .room.decision!!
                .decidedBy shouldBe "host01"

            rooms.decide(roomId, DecisionRequest("pid002", replace, rooms.version(roomId)), 5) shouldBe
                DecisionResult.Applied
            rooms.find(roomId)!!.room.decision shouldBe replace
        }

        it("accepts a screen that saw the decision even after a later nickname change") {
            val rooms = repos().rooms
            val roomId = rooms.decidedRoom()
            val seen = rooms.version(roomId)
            rooms.updateParticipant(roomId, "pid002", participantChange(nickname = "지연"), activity(3))
            rooms.decide(roomId, DecisionRequest("pid002", null, seen), 4) shouldBe DecisionResult.Applied
        }

        it("refuses someone outside the room, a decision with one person, and an unknown room") {
            val rooms = repos().rooms
            val roomId = rooms.decidedRoom()
            val seen = rooms.version(roomId)
            rooms.decide(roomId, DecisionRequest("nobody", null, seen), 3) shouldBe DecisionResult.NotMember
            rooms.removeParticipant(roomId, "pid002", activity(4))
            val alone = rooms.version(roomId)
            rooms.decide(roomId, DecisionRequest("host01", Decision(OTHER, "host01", T0), alone), 5) shouldBe
                DecisionResult.TooFew
            rooms.decide(roomId, DecisionRequest("host01", null, alone), 5) shouldBe DecisionResult.Unchanged
            rooms.decide(freshId(), DecisionRequest("host01", null, alone), 5) shouldBe DecisionResult.RoomNotFound
            rooms
                .find(roomId)
                .shouldNotBeNull()
                .room.decision
                .shouldBeNull()
        }
    }
}

internal fun DescribeSpecRootScope.visibleDecisions(repos: () -> RepositoryPair) {
    describe("writeDecision and the shown decision") {
        it("judges against the decision the screen shows when the stored code was retired or left the meeting set") {
            val rooms = repos().rooms
            val roomId = rooms.decidedRoom()
            val decided = rooms.find(roomId)!!.room
            val retired = DecisionRule(FakeStationCatalog(replacedBy = mapOf(DECIDED to OTHER)))
            val shown = Decision(OTHER, "pid002", T0.plusSeconds(5))
            rooms.decide(roomId, DecisionRequest("pid002", shown, decided.shareVersion), 5, retired) shouldBe
                DecisionResult.Unchanged
            val gone = DecisionRule(FakeStationCatalog(meetingStations = setOf(OTHER)))
            rooms.decide(roomId, DecisionRequest("pid002", null, decided.shareVersion), 6, gone) shouldBe
                DecisionResult.Unchanged
            rooms.find(roomId)!!.room shouldBe decided
        }
    }
}
