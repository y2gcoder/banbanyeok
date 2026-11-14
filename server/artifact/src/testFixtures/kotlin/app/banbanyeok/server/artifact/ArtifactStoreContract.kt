package app.banbanyeok.server.artifact

import io.kotest.assertions.throwables.shouldThrow
import io.kotest.core.spec.style.describeSpec
import io.kotest.core.spec.style.scopes.DescribeSpecRootScope
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.collections.shouldContainExactly
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import java.util.UUID

/**
 * ArtifactStore 구현이 모두 통과해야 하는 계약. 로컬 파일 구현과 GCS 에뮬레이터 구현이 같은 테스트를 돈다.
 * 각 테스트는 고유한 접두사 아래에서만 읽고 써서 공유 저장소(에뮬레이터)에서도 서로 간섭하지 않는다.
 */
fun artifactStoreContract(newStore: () -> ArtifactStore) =
    describeSpec {
        readingAndWriting(newStore)
        conditionalWrites(newStore)
        listing(newStore)
        keys()
    }

private fun scope() = "contract-${UUID.randomUUID()}"

private fun DescribeSpecRootScope.readingAndWriting(newStore: () -> ArtifactStore) {
    describe("get and put") {
        it("returns null for a missing key") {
            newStore().get(ArtifactKey("${scope()}/missing.json")).shouldBeNull()
        }

        it("round-trips binary content and returns the same version from put and get") {
            val store = newStore()
            val key = ArtifactKey("${scope()}/od.bin")
            val content = ByteArray(256) { it.toByte() }
            val version = store.put(key, content)
            val stored = store.get(key).shouldNotBeNull()
            stored.content.toList() shouldBe content.toList()
            stored.version shouldBe version
            stored.key shouldBe key
        }

        it("changes the version when the content changes") {
            val store = newStore()
            val key = ArtifactKey("${scope()}/manifest.json")
            val first = store.put(key, "one".toByteArray())
            val second = store.put(key, "two".toByteArray())
            second shouldNotBe first
            store
                .get(key)
                .shouldNotBeNull()
                .content
                .decodeToString() shouldBe "two"
        }
    }
}

private fun DescribeSpecRootScope.conditionalWrites(newStore: () -> ArtifactStore) {
    describe("conditional put with ifMatch") {
        it("creates only when absent with ABSENT") {
            val store = newStore()
            val key = ArtifactKey("${scope()}/manifest.json")
            store.put(key, "first".toByteArray(), ifMatch = ArtifactVersion.ABSENT)
            shouldThrow<PreconditionFailedException> {
                store.put(key, "second".toByteArray(), ifMatch = ArtifactVersion.ABSENT)
            }
            store
                .get(key)
                .shouldNotBeNull()
                .content
                .decodeToString() shouldBe "first"
        }

        it("writes when the version matches and refuses a stale version") {
            val store = newStore()
            val key = ArtifactKey("${scope()}/manifest.json")
            val v1 = store.put(key, "v1".toByteArray())
            val v2 = store.put(key, "v2".toByteArray(), ifMatch = v1)
            shouldThrow<PreconditionFailedException> { store.put(key, "v3".toByteArray(), ifMatch = v1) }
            val current = store.get(key).shouldNotBeNull()
            current.content.decodeToString() shouldBe "v2"
            current.version shouldBe v2
        }

        it("refuses a version condition on a missing object") {
            val store = newStore()
            val key = ArtifactKey("${scope()}/missing.json")
            shouldThrow<PreconditionFailedException> {
                store.put(key, "x".toByteArray(), ifMatch = ArtifactVersion("123"))
            }
            store.get(key).shouldBeNull()
        }

        it("lets exactly one of several concurrent writers win") {
            val store = newStore()
            val key = ArtifactKey("${scope()}/manifest.json")
            val base = store.put(key, "base".toByteArray())
            val outcomes =
                coroutineScope {
                    (1..8)
                        .map { n ->
                            async { runCatching { store.put(key, "writer-$n".toByteArray(), ifMatch = base) } }
                        }.awaitAll()
                }
            outcomes.count { it.isSuccess } shouldBe 1
            outcomes.filter { it.isFailure }.forEach {
                (it.exceptionOrNull() is PreconditionFailedException) shouldBe
                    true
            }
        }
    }
}

private fun DescribeSpecRootScope.listing(newStore: () -> ArtifactStore) {
    describe("list") {
        it("returns keys under a prefix in lexicographic order, including nested keys") {
            val store = newStore()
            val base = scope()
            val names = listOf("b.json", "a.json", "versions/1/od.bin", "versions/1/stations.json")
            names.forEach { store.put(ArtifactKey("$base/$it"), it.toByteArray()) }
            store.put(ArtifactKey("${base}x/other.json"), "other".toByteArray())
            store.list("$base/").map { it.value } shouldContainExactly
                listOf("a.json", "b.json", "versions/1/od.bin", "versions/1/stations.json").map { "$base/$it" }
            store.list("$base/versions/").map { it.value } shouldContainExactly
                listOf("$base/versions/1/od.bin", "$base/versions/1/stations.json")
        }

        it("returns nothing for an unknown prefix") {
            newStore().list("${scope()}/").shouldBeEmpty()
        }
    }
}

private fun DescribeSpecRootScope.keys() {
    describe("keys") {
        it("rejects keys that could escape the store or are not neutral") {
            listOf("", "/abs", "../x", "a/../b", "a//b", ".hidden", "a b", "a\\b").forEach {
                shouldThrow<IllegalArgumentException> { ArtifactKey(it) }
            }
        }
    }
}
