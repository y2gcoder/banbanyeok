package app.banbanyeok.pipeline

import kotlin.test.Test
import kotlin.test.assertTrue

class MainTest {
    @Test
    fun greetingMentionsCodeSpace() {
        assertTrue(greeting(arrayOf("build")).contains("32768"))
    }
}
