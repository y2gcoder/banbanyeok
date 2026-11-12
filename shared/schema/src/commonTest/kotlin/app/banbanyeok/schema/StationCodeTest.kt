package app.banbanyeok.schema

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class StationCodeTest {
    @Test
    fun valueAndTextRoundTrip() {
        assertEquals("000", StationCode.ofValue(0).toString())
        assertEquals("zzz", StationCode.ofValue(32767).toString())
        assertEquals(123, StationCode.parse("03v").value)
        for (value in listOf(0, 1, 31, 32, 1023, 1024, 12345, 32767)) {
            assertEquals(value, StationCode.parse(StationCode.ofValue(value).toString()).value)
        }
    }

    @Test
    fun textOrderEqualsValueOrder() {
        val values = (0 until StationCode.CAPACITY step 37).toList()
        val byText = values.map { StationCode.ofValue(it).toString() }.sorted()
        assertEquals(values.map { StationCode.ofValue(it).toString() }, byText)
    }

    @Test
    fun rejectsNonCanonicalCodes() {
        for (bad in listOf("", "ab", "abcd", "ABC", "a-c", "iii", "l00", "o00", "u00", "가나다")) {
            assertNull(StationCode.parseOrNull(bad), bad)
            assertFailsWith<SchemaException>(bad) { StationCode.parse(bad) }
        }
        assertFailsWith<SchemaException> { StationCode.ofValue(-1) }
        assertFailsWith<SchemaException> { StationCode.ofValue(StationCode.CAPACITY) }
    }
}
