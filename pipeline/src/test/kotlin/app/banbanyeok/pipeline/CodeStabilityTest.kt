package app.banbanyeok.pipeline

import app.banbanyeok.schema.CandidateList
import app.banbanyeok.schema.OdBinCodec
import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.RegistryCodec
import app.banbanyeok.schema.StationCode
import app.banbanyeok.schema.StationStatus
import io.kotest.core.spec.style.DescribeSpec
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Path
import kotlin.io.path.readBytes
import kotlin.io.path.readText
import kotlin.math.hypot
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Codes published before D1. Shared links and SEO URLs embed them, so they must never move. */
private val stable =
    parseObject(requireNotNull(CodeStabilityTest::class.java.getResource("/stable-codes.json")).readText())

class CodeStabilityTest :
    DescribeSpec({
        describe("pre-D1 station codes") {
            val registry = RegistryCodec.parse(Path.of("../data/registry/stations.json").readText())
            val byCode = registry.stations.associateBy { it.code }
            val origins = stable.getValue("origins").jsonArray.map { it.jsonObject }

            it("keep the same active physical station (name and coordinates within 100 m)") {
                assertEquals(240, origins.size)
                origins.forEach { origin ->
                    val station = requireNotNull(byCode[origin.text("code")]) { "Lost code ${origin.text("code")}" }
                    assertEquals(StationStatus.ACTIVE, station.status, station.code)
                    assertEquals(origin.text("name"), station.name, station.code)
                    val km =
                        hypot(
                            (station.lat - origin.getValue("lat").jsonPrimitive.double) * 111.0,
                            (station.lng - origin.getValue("lng").jsonPrimitive.double) * 88.0,
                        )
                    assertTrue(km < 0.1, "${station.code} moved $km km")
                }
            }
            it("stay on the published origin axis and keep the reviewed candidates") {
                val od = OdBinCodec.decode(Path.of("../data/artifacts/dev/od.bin").readBytes())
                origins.forEach { origin ->
                    assertTrue(od.indexOfOrigin(StationCode.parse(origin.text("code"))) >= 0, origin.text("code"))
                }
                val candidates: CandidateList =
                    RegistryCodec.parseCandidates(Path.of("../data/registry/candidates.json").readText())
                // D1 adopted 30 more candidates; every pre-D1 candidate code must still be on the axis.
                val previous = stable.getValue("candidates").jsonArray.map { it.jsonPrimitive.content }
                assertTrue(candidates.candidates.containsAll(previous), "a pre-D1 candidate was dropped")
                previous.forEach { assertTrue(od.indexOfCandidate(StationCode.parse(it)) >= 0, it) }
            }
            it("are never reissued by a rebuild that adds stations") {
                val rules = NetworkRules(parseObject(Path.of("../data/config/network-rules.json").readText()))
                val added =
                    RegistryBuilder(registry, emptyList(), rules, CodeSource { error("no new code expected") }).build()
                assertEquals(registry.stations.map { it.code }, added.stations.map { it.code })
                assertEquals(registry, Registry(1, registry.registryVersion, added.stations))
            }
        }
    })
