package app.banbanyeok.schema

/** 계약 형식(레지스트리, od.bin, manifest) 위반. reader는 조용히 고치지 않고 이 예외로 거부한다. */
public class SchemaException(
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

internal fun schemaFail(message: String): Nothing = throw SchemaException(message)

internal inline fun schemaCheck(
    condition: Boolean,
    message: () -> String,
) {
    if (!condition) schemaFail(message())
}
