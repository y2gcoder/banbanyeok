package app.banbanyeok.core

/** Deterministic, side-effect-free ranking. See docs/research/algorithm.md for band semantics. */
public fun rank(input: RankInput): RankResult {
    validate(input)
    val participants = input.participants.toList()
    val excluded = mutableListOf<ExcludedCandidate>()
    val reachable = reachableCandidates(input, participants, excluded)
    val fairKeys: List<
        (
            Candidate,
        ) -> Long,
    > = listOf({ it.maxSeconds.toLong() }, { it.spreadSeconds.toLong() }, { it.totalSeconds })
    val baseline = order(reachable, fairKeys, 0).firstOrNull()
    val target = if (input.mode.startsWith("favor:")) participants.indexOf(input.mode.substringAfter(':')) else -1
    val caps =
        if (target >= 0 && baseline != null) {
            baseline.times.filterIndexed { index, _ -> index != target }.associate {
                it.participantId to it.seconds.toLong() + minOf(900L, it.seconds.toLong() / 2)
            }
        } else {
            null
        }
    val eligible = eligibleCandidates(reachable, caps, target, excluded)
    val keys =
        when {
            target >= 0 -> listOf<(Candidate) -> Long>({ requireNotNull(it.favoredSeconds).toLong() }) + fairKeys
            input.mode == "fast" ->
                listOf(
                    { row: Candidate -> row.totalSeconds },
                    { row: Candidate -> row.maxSeconds.toLong() },
                )
            else -> fairKeys
        }
    val recommendations =
        order(eligible, keys, input.toleranceSeconds).mapIndexed { index, row ->
            val reason =
                when (input.mode) {
                    "fair" -> if (index == 0) "FAIR_MINIMAX" else "FAIR_ALTERNATIVE"
                    "fast" -> if (index == 0) "FAST_TOTAL" else "FAST_ALTERNATIVE"
                    else -> if (index == 0) "FAVOR_CAPPED" else "FAVOR_ALTERNATIVE"
                }
            row.copy(rank = index + 1, reasonCode = reason)
        }
    return RankResult(
        if (recommendations.isEmpty()) "no_common_candidate" else "ok",
        input.mode,
        participants,
        input.toleranceSeconds,
        baseline?.stationCode,
        caps,
        recommendations,
        excluded.sortedBy { it.stationCode },
    )
}

private fun validate(input: RankInput) {
    require(
        input.participants.size in 2..4 && input.participants.all { it.isNotEmpty() } &&
            input.participants.distinct().size == input.participants.size,
    ) { "Expected 2 to 4 unique nonempty participant IDs" }
    require(
        input.candidates.all { code -> code.isNotEmpty() } &&
            input.candidates.distinct().size == input.candidates.size,
    ) { "Expected unique nonempty candidate codes" }
    require(
        input.mode == "fair" || input.mode == "fast" ||
            input.participants.any { input.mode == "favor:$it" },
    ) { "Unknown mode or favor participant" }
    require(input.toleranceSeconds >= 0) { "Tolerance must be nonnegative seconds" }
    for (matrix in listOf(input.times, input.transfers)) {
        require(matrix.size == input.participants.size && matrix.all { it.size == input.candidates.size }) {
            "Matrix dimensions must match participants by candidates"
        }
    }
    validateCells(input)
}

/** Anchor every band at its minimum. A pairwise tolerance comparator would be nontransitive. */
private fun order(
    rows: List<Candidate>,
    keys: List<(Candidate) -> Long>,
    tolerance: Int,
): List<Candidate> {
    if (keys.isEmpty()) return rows.sortedBy { it.stationCode }
    val key = keys.first()
    val pending = rows.sortedWith(compareBy(key).thenBy { it.stationCode })
    val result = mutableListOf<Candidate>()
    var start = 0
    while (start < pending.size) {
        val ceiling = key(pending[start]) + tolerance.toLong()
        var end = start + 1
        while (end < pending.size && key(pending[end]) <= ceiling) end++
        result.addAll(order(pending.subList(start, end), keys.drop(1), tolerance))
        start = end
    }
    return result
}

private fun reachableCandidates(
    input: RankInput,
    participants: List<String>,
    excluded: MutableList<ExcludedCandidate>,
): List<Candidate> =
    input.candidates.mapIndexedNotNull { column, code ->
        if (participants.indices.any { input.times[it][column] == null }) {
            excluded.add(ExcludedCandidate(code, "UNREACHABLE"))
            null
        } else {
            val times =
                participants.mapIndexed { row, id ->
                    PersonalTime(
                        id,
                        requireNotNull(input.times[row][column]),
                        requireNotNull(input.transfers[row][column]),
                    )
                }
            val max = times.maxOf { it.seconds }
            Candidate(
                0,
                code,
                times,
                max,
                max - times.minOf { it.seconds },
                times.sumOf { it.seconds.toLong() },
                reasonCode = "",
            )
        }
    }

private fun validateCells(input: RankInput) {
    for (row in input.participants.indices) {
        for (column in input.candidates.indices) {
            val time = input.times[row][column]
            val transfers = input.transfers[row][column]
            require(
                (time == null && transfers == null) ||
                    (time != null && transfers != null && time >= 0 && transfers >= 0),
            ) {
                "Time and transfers must be nonnegative integers or paired nulls"
            }
        }
    }
}

private fun eligibleCandidates(
    reachable: List<Candidate>,
    caps: Map<String, Long>?,
    target: Int,
    excluded: MutableList<ExcludedCandidate>,
): List<Candidate> =
    if (caps != null) {
        reachable.mapNotNull { row ->
            if (row.times.any { time -> caps[time.participantId]?.let { time.seconds > it } == true }) {
                excluded.add(ExcludedCandidate(row.stationCode, "FAVOR_CAP_EXCEEDED"))
                null
            } else {
                row.copy(favoredSeconds = row.times[target].seconds)
            }
        }
    } else {
        reachable
    }
