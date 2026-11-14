package app.banbanyeok.pipeline
import app.banbanyeok.schema.Registry
import app.banbanyeok.schema.RegistryCodec
import app.banbanyeok.schema.RegistryCompatibility
import java.nio.file.Path

/** HEAD is the committed baseline; the local registry is also checked during generation. */
internal fun baselineViolations(
    root: Path,
    next: Registry,
): List<String> {
    val process =
        ProcessBuilder(
            "git",
            "show",
            "HEAD:data/registry/stations.json",
        ).directory(root.toFile()).redirectError(ProcessBuilder.Redirect.DISCARD).start()
    val text = process.inputStream.bufferedReader().readText()
    require(process.waitFor() == 0) { "Cannot read committed registry baseline" }
    return RegistryCompatibility.checkAppendOnly(RegistryCodec.parse(text), next)
}
