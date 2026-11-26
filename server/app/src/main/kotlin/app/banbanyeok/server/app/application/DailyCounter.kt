package app.banbanyeok.server.app.application

enum class UsageStage {
    RECOMMEND,
    CREATE_ROOM,
    JOIN_ROOM,
    DECIDE_STATION,
}

fun interface DailyCounter {
    fun increment(stage: UsageStage)
}
