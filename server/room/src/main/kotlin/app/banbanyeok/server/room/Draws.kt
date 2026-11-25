package app.banbanyeok.server.room

import java.time.Instant
import java.util.random.RandomGenerator

/** 뽑기 쓰기의 결과. 저장소가 방 행을 잠근 채 [FavorDrawRule.verdict]로 정한다. */
public sealed interface DrawResult {
    /** 뽑았다. 저장소가 [winner]를 배려 대상으로, [draw]를 뽑기 칸에 쓴다. */
    public data class Drawn(
        val winner: String,
        val draw: FavorDraw,
    ) : DrawResult

    /** 같은 세대에서 방이 이미 그 회차 이상이다. 아무것도 쓰지 않았다(재시도·새로고침 안전, 인스턴스와 상관없음). */
    public data object Unchanged : DrawResult

    /** 방을 만들 때 대상을 뽑기로 정한 방이 아니다. */
    public data object NotAvailable : DrawResult

    /** 뽑기 대상이 2명 미만이다. */
    public data object TooFew : DrawResult

    /** 다시 뽑기를 이미 썼다. */
    public data object LimitReached : DrawResult

    /** 화면이 본 세대·회차의 다음이 아니다(그사이 당첨자가 나가 뽑기 전으로 돌아갔다 등). */
    public data object Stale : DrawResult

    public data object RoomNotFound : DrawResult
}

/** 세대 [generation]의 [round]번째 뽑기(1 = 처음, 2 = 다시 뽑기) 요청. [at]은 뽑은 시각으로 저장된다. */
public data class DrawRequest(
    val generation: Int,
    val round: Int,
    val at: Instant,
)

/**
 * '누구 쪽으로' 뽑기(#172)의 규칙을 한 곳에 둔다: 누가 대상인지, 몇 번 뽑을 수 있는지, 화면에 어떻게 보이는지.
 * 운은 [random]이 정한다(운영은 SecureRandom, 테스트는 고정 값). 대상과 당첨은 참가자 ID·숨김 여부·입장 순서에서만 나오고
 * 출발역은 보지 않는다(숨긴 출발역 비간섭, ADR-0004). 두 저장소(Postgres, 메모리 fake)가 방 행을 잠근 채 [verdict]를 부른다.
 */
public class FavorDrawRule(
    private val random: RandomGenerator,
) {
    /**
     * 뽑기 대상인지. 출발역을 숨긴 사람은 빠진다: 숨긴 사람 쪽 결과는 본인만 볼 수 있어서(ADR-0005), 뽑히면 사람마다 결과가 갈린다.
     * 숨기기를 다시 보는 #173에서 이 규칙을 걷어낼 수 있게 서버에서는 여기 한 곳에만 둔다.
     */
    public fun isCandidate(participant: Participant): Boolean = !participant.hidden

    /**
     * 순서가 규칙이다. 화면이 본 세대가 지금 세대가 아니면(그사이 뽑기 전으로 돌아갔다) [DrawResult.Stale]이라, 리셋 전에 보낸 요청이
     * 다른 인스턴스로 재시도돼도 새로 뽑지 않는다. 같은 세대에서 이미 그 회차 이상이면 [DrawResult.Unchanged]라서 성공한 요청의
     * 재시도도 200이다. 다시 뽑기는 한 번([MAX_ROUNDS])이고, 화면이 본 회차의 다음만 받는다.
     */
    public fun verdict(
        room: Room,
        participants: List<Participant>,
        request: DrawRequest,
    ): DrawResult {
        val draw = room.favorDraw ?: return DrawResult.NotAvailable
        val candidates = participants.filter(::isCandidate)
        return when {
            request.generation != draw.generation -> {
                DrawResult.Stale
            }

            request.round <= draw.round -> {
                DrawResult.Unchanged
            }

            request.round > MAX_ROUNDS -> {
                DrawResult.LimitReached
            }

            request.round != draw.round + 1 -> {
                DrawResult.Stale
            }

            candidates.size < MIN_CANDIDATES -> {
                DrawResult.TooFew
            }

            else -> {
                val winner = candidates[random.nextInt(candidates.size)]
                val next =
                    FavorDraw(
                        generation = draw.generation,
                        round = request.round,
                        candidates = candidates.map { it.id },
                        roster = participants.map { it.id },
                        drawnAt = request.at,
                    )
                DrawResult.Drawn(winner.id, next)
            }
        }
    }

    /** 화면에 보이는 뽑기 상태. 뽑기 방이 아니면 null. [participants]는 입장 순서다. */
    public fun view(
        room: Room,
        participants: List<Participant>,
    ): FavorDrawView? {
        val draw = room.favorDraw ?: return null
        val winner = room.favorParticipantId?.takeIf { id -> participants.any { it.id == id } }
        if (draw.round == 0 || winner == null || draw.drawnAt == null) {
            val (candidates, hidden) = participants.partition(::isCandidate)
            return FavorDrawView(
                generation = draw.generation,
                round = 0,
                maxRounds = MAX_ROUNDS,
                candidates = candidates.map { it.id },
                winner = null,
                drawnAt = null,
                excluded = hidden.map { DrawExclusion(it.id, DrawExclusionReason.HIDDEN) },
            )
        }
        val drawn = draw.candidates.toSet()
        val roster = draw.roster.toSet()
        return FavorDrawView(
            generation = draw.generation,
            round = draw.round,
            maxRounds = MAX_ROUNDS,
            candidates = participants.filter { it.id in drawn }.map { it.id },
            winner = winner,
            drawnAt = draw.drawnAt,
            // 뽑을 때 방에 있었는데 대상이 아니었으면 숨겨서 빠진 것이고, 명단에 없으면 뽑은 뒤에 들어온 것이다.
            excluded =
                participants
                    .filter { it.id !in drawn }
                    .map {
                        val reason = if (it.id in roster) DrawExclusionReason.HIDDEN else DrawExclusionReason.LATE
                        DrawExclusion(it.id, reason)
                    },
        )
    }

    public companion object {
        /** 처음 뽑기 1번 + 다시 뽑기 1번. */
        public const val MAX_ROUNDS: Int = 2
        private const val MIN_CANDIDATES = 2
    }
}
