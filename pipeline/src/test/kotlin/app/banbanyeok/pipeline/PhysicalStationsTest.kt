package app.banbanyeok.pipeline

import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.Station
import app.banbanyeok.schema.StationStatus
import io.kotest.core.spec.style.DescribeSpec
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

private fun physicalFixture() =
    PhysicalStations(
        parseObject(
            """{"scope":{"minLat":36.7,"maxLat":38.3,"minLng":126.3,"maxLng":128.0},
        "nearKm":0.85,"distinctPairs":[{"codes":["001","002"],"basis":"different stations"}],
        "samePairs":[{"codes":["005","006"],"basis":"source coordinates disagree"}]}""",
        ),
    )

private fun physicalStation(
    code: String,
    name: String = "환승",
): Station =
    Station(
        code,
        name,
        StationStatus.ACTIVE,
        37.5,
        127.0,
        listOf("1호선"),
        emptyList(),
        emptyMap(),
        1,
    )

class PhysicalStationsTest :
    DescribeSpec({
        it("rejects nearby active duplicates even without shared operator transfer IDs") {
            val rules = physicalFixture()
            val registry = Registry(1, 1, listOf(physicalStation("003"), physicalStation("004")))
            assertTrue(registryGate(registry, rules, { it }).any { it.contains("Duplicate physical station") })
        }
        it("keeps explicit distinct stations and distant same names separate") {
            val rules = physicalFixture()
            assertTrue(!rules.same(physicalStation("001"), physicalStation("002"), { it }))
            assertTrue(!rules.same(physicalStation("003"), physicalStation("004").copy(lng = 127.5), { it }))
            assertTrue(rules.same(physicalStation("005"), physicalStation("006").copy(lng = 127.011), { it }))
            assertTrue(
                !rules.same(physicalStation("003").copy(lat = 35.0), physicalStation("004").copy(lat = 35.0), { it }),
            )
        }
        it("merges cross-operator identities without reallocating codes and is idempotent") {
            val rules =
                NetworkRules(
                    parseObject(
                        """{"aliases":{},"predecessors":{},"oneWay":{},"services":{},
            "sourceLineOverrides":{},"physicalStations":{
            "scope":{"minLat":36.7,"maxLat":38.3,"minLng":126.3,"maxLng":128.0},"nearKm":0.85,
            "preferredSourcePrefix":"kric:서울교통공사:","distinctPairs":[],"samePairs":[]}}""",
                    ),
                )
            val a =
                physicalStation(
                    "001",
                ).copy(sources = mapOf("kric:한국철도공사:경의중앙선" to "rail"), lines = listOf("경의중앙선"), aliases = listOf("옛환승"))
            val b = physicalStation("002").copy(sources = mapOf("kric:서울교통공사:1호선" to "metro"))
            val previous = Registry(1, 1, listOf(a, b))
            val records =
                listOf(
                    Record("rail", "환승", "경의중앙선", 37.5, 127.0, "한국철도공사", "환승", "rail-line", emptySet()),
                    Record("metro", "환승", "1호선", 37.5, 127.0, "서울교통공사", "환승", "metro-line", emptySet()),
                )
            val noAllocation = CodeSource { error("Must preserve existing codes") }
            val merged = RegistryBuilder(previous, records, rules, noAllocation).build()
            assertEquals(listOf("001", "002"), merged.stations.map { it.code })
            assertEquals("002", merged.stations.first().replacedBy)
            assertEquals(listOf("옛환승"), merged.stations.last().aliases)
            assertEquals(
                setOf("rail", "metro"),
                merged.stations
                    .last()
                    .sources.values
                    .toSet(),
            )
            assertEquals(1, merged.stations.first().addedIn)
            assertEquals(2, merged.registryVersion)
            assertEquals(merged, RegistryBuilder(merged, records, rules, noAllocation).build())
        }
        it("accepts transitive replacements ending active and rejects loops or dead ends") {
            val a = physicalStation("001").copy(status = StationStatus.DEPRECATED, deprecatedIn = 1, replacedBy = "002")
            val b = a.copy(code = "002", replacedBy = "003")
            val c = physicalStation("003")
            assertEquals("003", resolveReplacement(Registry(1, 1, listOf(a, b, c)), "001"))
            assertFailsWith<IllegalArgumentException> {
                resolveReplacement(Registry(1, 1, listOf(a, b.copy(replacedBy = "001"), c)), "001")
            }
            assertFailsWith<IllegalArgumentException> {
                resolveReplacement(Registry(1, 1, listOf(a, b.copy(replacedBy = null), c)), "001")
            }
            assertFailsWith<IllegalArgumentException> {
                resolveReplacement(Registry(1, 1, listOf(a.copy(replacedBy = "004"), b, c)), "001")
            }
        }
    })
