package app.banbanyeok.applogic

/** 테스트용 입력 조립 도우미. 시간은 분 단위로 쓰고 초로 바꿔 넣는다. */
internal object Fixtures {
    private val CODES = listOf("03v", "130", "225", "31a")

    fun people(
        names: List<String?>,
        originCodes: List<String?>? = null,
    ): List<PersonRef> =
        names.mapIndexed { i, name -> PersonRef(id = "p$i", name = name, originCode = originCodes?.get(i) ?: CODES[i]) }

    fun reason(
        mode: ReasonMode,
        rank: Int,
        names: List<String?>,
        minutes: List<Int>? = null,
        seconds: List<Int>? = null,
        transfers: List<Int>? = null,
        station: String = "신촌",
        code: String? = null,
        reasonCode: ReasonCode? = null,
        toleranceSeconds: Int = 0,
        versus: Comparison? = null,
        favor: FavorContext? = null,
        isFairBaseline: Boolean = false,
    ): ReasonInput {
        val secs = seconds ?: minutes!!.map { it * 60 }
        val refs = people(names)
        val times = refs.mapIndexed { i, ref -> PersonTime(ref, secs[i], transfers?.get(i) ?: 0) }
        return ReasonInput(
            mode = mode,
            rank = rank,
            stationCode = code ?: "0aj",
            stationName = station,
            people = times,
            maxSeconds = secs.max(),
            spreadSeconds = secs.max() - secs.min(),
            totalSeconds = secs.sum(),
            reasonCode = reasonCode ?: defaultCode(mode, rank),
            toleranceSeconds = toleranceSeconds,
            comparison = versus,
            favor = favor,
            isFairBaseline = isFairBaseline,
        )
    }

    private fun defaultCode(
        mode: ReasonMode,
        rank: Int,
    ): ReasonCode =
        when (mode) {
            ReasonMode.FAIR -> if (rank == 1) ReasonCode.FAIR_MINIMAX else ReasonCode.FAIR_ALTERNATIVE
            ReasonMode.FAST -> if (rank == 1) ReasonCode.FAST_TOTAL else ReasonCode.FAST_ALTERNATIVE
            ReasonMode.FAVOR -> if (rank == 1) ReasonCode.FAVOR_CAPPED else ReasonCode.FAVOR_ALTERNATIVE
        }

    fun versus(
        rank: Int,
        station: String,
        minutes: List<Int>? = null,
        seconds: List<Int>? = null,
        code: String = "0bk",
    ): Comparison = Comparison(rank, code, station, seconds ?: minutes!!.map { it * 60 })

    fun favor(
        index: Int,
        baselineMinutes: List<Int>,
        capMinutes: List<Int?>,
        closerStationsExcluded: Boolean = false,
    ): FavorContext =
        FavorContext(
            index,
            baselineMinutes.map { it * 60 },
            capMinutes.map { it?.let { minutes -> minutes * 60 } },
            closerStationsExcluded,
        )
}
