package app.banbanyeok.pipeline

import app.banbanyeok.schema.StationCode

/** Kotlin CLI 자리표시. 실제 단계(sources -> graph -> build -> validate -> publish)는 P2가 채운다. */
fun main(args: Array<String>) {
    println(greeting(args))
}

internal fun greeting(args: Array<String>): String =
    "banbanyeok pipeline: hello (args=${args.joinToString(",")}, 코드 공간 ${StationCode.CAPACITY}개)"
