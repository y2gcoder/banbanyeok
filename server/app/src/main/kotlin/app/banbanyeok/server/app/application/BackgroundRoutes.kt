package app.banbanyeok.server.app.application

import app.banbanyeok.schema.RouteGraph
import app.banbanyeok.server.recommendation.route.RouteSource
import kotlinx.coroutines.Deferred
import org.slf4j.LoggerFactory
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 시작 뒤 뒤에서 읽는 노선 그래프(ArtifactLoader, #120). 막차 표([BackgroundLastTrains])와 같은 규칙이다: 읽기는 서버가 첫 응답을 보낸 뒤에
 * 시작하고, [current]는 **막지 않고 기다리지도 않는다**. 검사가 끝났으면 그 그래프, 아직이거나 실패했거나 데이터에 그래프가 없으면 null이고,
 * 그 응답에서는 사람별 경로만 빠진다(화면은 중립색 막대). 검사 실패는 한 번만 기록한다.
 */
class BackgroundRoutes(
    private val loading: Deferred<RouteGraph?>,
) : RouteSource {
    private val failureLogged = AtomicBoolean(false)

    override fun current(): RouteGraph? {
        if (!loading.isCompleted) return null
        @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
        val failure = loading.getCompletionExceptionOrNull()
        if (failure != null) {
            if (failureLogged.compareAndSet(false, true)) log.error("노선 그래프를 쓸 수 없어 경로 없이 응답합니다", failure)
            return null
        }
        @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
        return loading.getCompleted()
    }

    private companion object {
        val log: org.slf4j.Logger = LoggerFactory.getLogger(BackgroundRoutes::class.java)
    }
}
