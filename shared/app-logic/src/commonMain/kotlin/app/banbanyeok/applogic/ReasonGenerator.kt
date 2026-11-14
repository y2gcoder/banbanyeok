package app.banbanyeok.applogic

/**
 * 후보 카드의 "추천 이유" 문장을 만든다. 서버가 한 번 만들어 응답의 `reason`에 넣고, 웹·앱은 그대로 보여 준다.
 * 규칙표는 docs/setup/p6-notes.md. 분 표시는 [DisplayMinutes]의 반올림 규칙을 따른다.
 *
 * 문장 규칙(product-ux 5.2): 해요체, 한 줄(문장 1~3개), 숫자는 분 단위, 비교 대상(2위 또는 1위)을 밝히고,
 * 손해 보는 사람이 있으면 숨기지 않는다.
 */
public object ReasonGenerator {
    /** 규칙을 어긴 입력이면 [ReasonInputException]을 던진다. 미리 확인하려면 [ReasonInputValidator.validate]. */
    public fun generate(input: ReasonInput): String {
        ReasonInputValidator.validate(input)?.let { throw ReasonInputException(it) }
        val view = View(input)
        val body =
            when {
                view.allZero -> ALREADY_TOGETHER
                else ->
                    when (input.mode) {
                        ReasonMode.FAIR -> if (input.rank == 1) fairWinner(view) else fairAlternative(view)
                        ReasonMode.FAST -> if (input.rank == 1) fastWinner(view) else fastAlternative(view)
                        ReasonMode.FAVOR -> if (input.rank == 1) favorWinner(view) else favorAlternative(view)
                    }
            }
        val tolerance = DisplayMinutes.fromSeconds(input.toleranceSeconds)
        return if (tolerance > 0 && !view.allZero) "$body (${DisplayMinutes.format(tolerance)} 동점 옵션)" else body
    }

    private const val ALREADY_TOGETHER = "이미 같은 동네예요."

    // ---- 공평 ----

    private fun fairWinner(v: View): String {
        val first =
            if (v.maxMin == v.minMin) {
                "${v.group} ${v.dur(v.maxMin)}이에요."
            } else if (v.n == 2) {
                "가장 오래 걸리는 ${v.longestNames}도 ${v.dur(v.maxMin)}이에요."
            } else {
                "가장 오래 걸리는 ${v.longestNames}도 ${v.dur(v.maxMin)}, ${v.n}명 모두 ${v.range(v.minMin, v.maxMin)} 사이예요."
            }
        val vs = v.versus ?: return first
        val label = v.rankLabel(vs)
        val dMax = vs.maxMin - v.maxMin
        val dSpread = vs.spreadMin - v.spreadMin
        val dTotal = vs.totalMin - v.totalMin
        val second =
            when {
                dMax > 0 -> "${label}보다 가장 오래 걸리는 사람이 ${v.dur(dMax)} 덜 걸려요."
                dMax < 0 ->
                    "최장 시간은 ${label}보다 ${v.dur(-dMax)} 길지만, " +
                        if (dSpread >
                            0
                        ) {
                            "시간 차이가 더 작아요 (${v.dur(v.spreadMin)} vs ${v.dur(vs.spreadMin)})."
                        } else {
                            "동점 옵션 범위 안이에요."
                        }
                dSpread > 0 -> "${v.withWa(
                    vs,
                )} 최장 시간은 같지만, 시간 차이가 더 작아요 (${v.dur(v.spreadMin)} vs ${v.dur(vs.spreadMin)})."
                dTotal > 0 -> "${v.withWa(vs)} 최장 시간과 차이가 같고, 합계가 ${v.dur(dTotal)} 더 짧아요."
                else -> "${v.withWa(vs)} 거의 같아요."
            }
        return "$first $second"
    }

    private fun fairAlternative(v: View): String {
        val first = "공평 모드 대안이에요."
        val vs = v.versus ?: return first
        val label = v.rankLabel(vs)
        val dMax = v.maxMin - vs.maxMin
        val dSpread = vs.spreadMin - v.spreadMin
        val second =
            when {
                dMax > 0 ->
                    "${label}보다 가장 오래 걸리는 사람이 ${v.dur(dMax)} 더 걸려요." +
                        if (dSpread > 0) " 대신 시간 차이는 ${v.dur(dSpread)} 더 작아요." else ""
                dMax < 0 -> "${label}보다 가장 오래 걸리는 사람이 ${v.dur(-dMax)} 덜 걸려요."
                else ->
                    "${v.withWa(vs)} 최장 시간은 같아요." +
                        if (dSpread > 0) " 시간 차이는 ${v.dur(dSpread)} 더 작아요." else ""
            }
        return "$first $second"
    }

    // ---- 빨리 만나기 ----

    private fun fastWinner(v: View): String {
        val together = if (v.n == 2) "둘이 합쳐" else "${v.n}명 모두 합쳐"
        val claim = if (v.input.toleranceSeconds > 0) "후보 중 가장 짧은 편이에요." else "후보 중 가장 짧아요."
        val first = "$together ${v.dur(v.totalMin)}, $claim"
        val second =
            when {
                v.input.isFairBaseline -> "가장 빠르면서 공평하기도 한 역이에요."
                v.n == 2 && v.maxMin > v.minMin ->
                    "대신 ${Korean.attach(
                        v.longestNames,
                        Josa.I_GA,
                    )} ${v.shortestNames}보다 ${v.dur(v.maxMin - v.minMin)} 더 걸려요."
                v.n == 2 -> "둘 다 ${v.dur(v.maxMin)}이에요."
                else -> "가장 오래 걸리는 ${Korean.attach(v.longestNames, Josa.EUN_NEUN)} ${v.dur(v.maxMin)}이에요."
            }
        return "$first $second"
    }

    private fun fastAlternative(v: View): String {
        val first = "빠른 만남 대안이에요."
        val vs = v.versus ?: return first
        val label = v.rankLabel(vs)
        val dTotal = v.totalMin - vs.totalMin
        val dMax = vs.maxMin - v.maxMin
        val second =
            when {
                dTotal > 0 ->
                    "${label}보다 합쳐서 ${v.dur(dTotal)} 더 걸려요." +
                        if (dMax > 0) " 대신 가장 오래 걸리는 사람은 ${v.dur(dMax)} 덜 걸려요." else ""
                dTotal < 0 -> "${label}보다 합쳐서 ${v.dur(-dTotal)} 덜 걸려요."
                else ->
                    "합계는 ${v.withWa(vs)} 같아요." +
                        if (dMax > 0) " 가장 오래 걸리는 사람은 ${v.dur(dMax)} 덜 걸려요." else ""
            }
        return "$first $second"
    }

    // ---- 배려(오늘은 ○○ 쪽으로) ----

    private fun favorWinner(v: View): String {
        val favor = checkNotNull(v.input.favor)
        val fav = v.names[favor.index]
        val transfers = v.input.people[favor.index].transfers
        val travel = if (transfers == 0) "환승 없이" else "환승 ${transfers}번으로"
        val first = "${Korean.attach(fav, Josa.EUN_NEUN)} ${v.dur(v.minutes[favor.index])}, $travel 와요."

        val others = v.names.indices.filter { it != favor.index }
        // 기준(공평 1위)보다 얼마나 더 걸리는가. 가장 많이 맞춰 주는 사람을 문장의 주인공으로 한다.
        val increases =
            others.associateWith {
                v.minutes[it] -
                    DisplayMinutes.fromSeconds(favor.baselineTimesSeconds[it])
            }
        val giver = others.maxBy { increases.getValue(it) }
        val increase = increases.getValue(giver)
        val giverName = v.names[giver]
        val second =
            when {
                increase > 0 -> {
                    val cap =
                        favor.capSeconds[giver]?.let {
                            DisplayMinutes.fromSeconds(it) -
                                DisplayMinutes.fromSeconds(favor.baselineTimesSeconds[giver])
                        }
                    val note =
                        buildString {
                            append(v.dur(v.minutes[giver]))
                            if (cap != null) append(", 상한 +").append(v.dur(cap))
                        }
                    val subject = if (others.size == 1) giverName else "가장 많이 맞춰 주는 $giverName"
                    "${Korean.attach(subject, Josa.EUN_NEUN)} 공평하게보다 ${v.dur(increase)} 더 걸려요 ($note)." +
                        if (others.size > 1) " 나머지도 상한 안이에요." else ""
                }
                others.size == 1 -> "${Korean.attach(
                    giverName,
                    Josa.EUN_NEUN,
                )} 공평하게 골랐을 때와 같은 ${v.dur(v.minutes[giver])}이에요."
                else -> "다른 ${others.size}명은 공평하게보다 더 걸리지 않아요."
            }
        val excluded = if (favor.closerStationsExcluded) " $fav 쪽에 더 가까운 역은 다른 사람 상한을 넘어서 뺐어요." else ""
        return "$first $second$excluded"
    }

    private fun favorAlternative(v: View): String {
        val favor = checkNotNull(v.input.favor)
        val fav = v.names[favor.index]
        val first = "$fav 쪽 대안이에요."
        val vs = v.versus ?: return first
        val label = v.rankLabel(vs)
        val mine = v.minutes[favor.index]
        val theirs = vs.minutes[favor.index]
        val second =
            when {
                mine > theirs -> "${label}보다 ${Korean.attach(
                    fav,
                    Josa.EUN_NEUN,
                )} ${v.dur(mine - theirs)} 더 걸려요 (${v.dur(mine)})."
                mine < theirs -> "${label}보다 ${Korean.attach(
                    fav,
                    Josa.EUN_NEUN,
                )} ${v.dur(theirs - mine)} 덜 걸려요 (${v.dur(mine)})."
                else -> "${Korean.attach(fav, Josa.EUN_NEUN)} ${v.withWa(vs)} 같은 ${v.dur(mine)}이에요."
            }
        return "$first $second"
    }

    // ---- 표시용 값 ----

    /** 사람별 초를 분으로 반올림한 뒤, 최장·차이·합계를 그 분 값에서 다시 계산한 표시용 값. */
    private class Stats(
        val minutes: List<Int>,
    ) {
        val maxMin = minutes.max()
        val minMin = minutes.min()
        val spreadMin = maxMin - minMin
        val totalMin = minutes.sum()
    }

    private class Other(
        val rank: Int,
        val stationName: String,
        minutes: List<Int>,
    ) {
        val stats = Stats(minutes)
        val maxMin get() = stats.maxMin
        val spreadMin get() = stats.spreadMin
        val totalMin get() = stats.totalMin
        val minutes get() = stats.minutes
    }

    private class View(
        val input: ReasonInput,
    ) {
        val names: List<String> = DisplayNames.resolve(input.people.map { it.person })
        val n = input.people.size
        val minutes: List<Int> = input.people.map { DisplayMinutes.fromSeconds(it.seconds) }
        private val stats = Stats(minutes)
        val maxMin get() = stats.maxMin
        val minMin get() = stats.minMin
        val spreadMin get() = stats.spreadMin
        val totalMin get() = stats.totalMin
        val allZero get() = maxMin == 0
        val group: String get() = if (n == 2) "둘 다" else "${n}명 모두"
        val longestNames: String get() = names.filterIndexed { i, _ -> minutes[i] == maxMin }.joinToString("·")
        val shortestNames: String get() = names.filterIndexed { i, _ -> minutes[i] == minMin }.joinToString("·")

        val versus: Other? =
            input.comparison?.let { c ->
                Other(c.rank, c.stationName, c.timesSeconds.map { DisplayMinutes.fromSeconds(it) })
            }

        fun dur(minutes: Int): String = DisplayMinutes.format(minutes)

        fun range(
            low: Int,
            high: Int,
        ): String = if (high < 60) "$low~${high}분" else "${dur(low)}~${dur(high)}"

        /** "2위 합정" */
        fun rankLabel(other: Other): String = "${other.rank}위 ${other.stationName}"

        /** "2위 합정과" */
        fun withWa(other: Other): String = "${other.rank}위 ${Korean.attach(other.stationName, Josa.WA_GWA)}"
    }
}
