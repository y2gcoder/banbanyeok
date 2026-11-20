package app.banbanyeok.pipeline

import app.banbanyeok.pipeline.lasttrain.input.officialFetch
import java.nio.file.Path
import kotlin.io.path.exists

/** The commands that stage a release or fetch one source. False when [args] is none of them. */
private fun fetchOrStage(
    root: Path,
    args: Array<String>,
): Boolean {
    when {
        args.firstOrNull() == "stage-release" -> {
            // 발행 디렉터리(기본 build/release). 업로드는 scripts/publish-artifacts.sh.
            require(args.size <= 2) { "Usage: stage-release [outDir]" }
            stageRelease(root.resolve("data/artifacts/dev"), root.resolve(args.getOrElse(1) { "build/release" }))
        }

        args.firstOrNull() == "tago-fetch" -> {
            tagoCommand(root, args.drop(1))
        }

        // Keyless download of the operator's train-coded timetable file (S7), the second source for last trains.
        args.singleOrNull() == "official-fetch" -> {
            officialFetch(root)
        }

        // The only command that needs SEOUL_OPENAPI_KEY. Exit 2 = limit reached; rerun to resume.
        args.singleOrNull() == "seoul-fetch" -> {
            kotlin.system.exitProcess(seoulFetch(root))
        }

        else -> {
            return false
        }
    }
    return true
}

fun main(args: Array<String>) {
    val root =
        generateSequence(Path.of("").toAbsolutePath()) {
            it.parent
        }.first { it.resolve("contracts/data-format.md").exists() }
    if (fetchOrStage(root, args)) return
    when (args.singleOrNull()) {
        "fetch" -> {
            fetch(root)
        }

        "spotcheck" -> {
            spotcheck(root)
        }

        "headways" -> {
            refreshHeadways(root)
        }

        "refresh" -> {
            require(!System.getenv("SEOUL_OPENAPI_KEY").isNullOrBlank()) {
                "SEOUL_OPENAPI_KEY is required for refresh; build/all use configured headways"
            }
            val before = network(root)
            val oldCosts = matrixCosts(before)
            check(seoulFetch(root) == 0) { "Seoul S5 cache incomplete (limit reached); rerun refresh to resume" }
            refreshHeadways(root)
            build(root)
            validate(root)
            writeHeadwayComparison(root, before, oldCosts)
        }

        "build" -> {
            build(root)
        }

        "validate" -> {
            validate(root)
        }

        "all" -> {
            if (!root.resolve("data/raw/kric.xlsx").exists()) fetch(root)
            build(root)
            validate(root)
        }

        else -> {
            error(
                "Usage: fetch|seoul-fetch|official-fetch|headways|build|validate|all|spotcheck|refresh|" +
                    "tago-fetch [probe]|" +
                    "stage-release [outDir]",
            )
        }
    }
}

private fun build(root: Path) {
    val context = StageContext(root)
    val parts = ReleaseParts()
    ARTIFACT_STAGES.forEach { it.build(context, parts) }
    publish(root, context.net, parts)
}

private fun validate(root: Path) {
    val dataset = loadDevArtifacts(root.resolve("data/artifacts/dev"))
    val context = StageContext(root)
    ARTIFACT_STAGES.forEach { it.validate(context, dataset) }
    println(
        "Validated artifact hashes, contract, append-only registry, " +
            "recomputed OD cells of ${context.slots.size} slots and the last-train table",
    )
}

/** The only command that needs TAGO_SERVICE_KEY; everything else reads the cache offline. */
private fun tagoCommand(
    root: Path,
    args: List<String>,
) {
    require(args.size <= 1) { "Usage: tago-fetch [probe]" }
    when (args.firstOrNull()) {
        null -> kotlin.system.exitProcess(tagoFetch(root))
        "probe" -> tagoProbe(root)
        else -> error("Usage: tago-fetch [probe]")
    }
}
