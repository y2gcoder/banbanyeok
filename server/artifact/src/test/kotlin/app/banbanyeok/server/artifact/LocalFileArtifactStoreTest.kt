package app.banbanyeok.server.artifact

import io.kotest.core.spec.style.DescribeSpec
import java.nio.file.Files
import java.nio.file.Path

class LocalFileArtifactStoreTest :
    DescribeSpec({
        val root: Path = Files.createTempDirectory("artifact-store-test")
        afterSpec { root.toFile().deleteRecursively() }
        include("local file store", artifactStoreContract { LocalFileArtifactStore(root) })
    })
