package com.aionui.notifier.data

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class)
class PairingCodeTest {
    private val now = 1_800_000_000_000L

    private fun code(expiresAt: Long = now + 60_000, id: String = "a".repeat(43)) =
        """{"v":1,"type":"aionui_pairing","projectId":"aion-personal","pairingId":"$id","expiresAt":$expiresAt}"""

    @Test
    fun parsesTheDesktopPairingContract() {
        val pairing = PairingCode.parse(code(), now)!!
        assertEquals("aion-personal", pairing.projectId)
        assertEquals(now + 60_000, pairing.expiresAt)
    }

    @Test
    fun rejectsExpiredCodesAndGuessableIds() {
        assertNull(PairingCode.parse(code(now), now))
        assertNull(PairingCode.parse(code(id = "123456"), now))
        assertNull(PairingCode.parse(code(now + 600_001), now))
    }

    @Test
    fun rejectsOtherQrTypesAndMalformedJson() {
        listOf(
                "not json",
                "https://example.com",
                code().replace("aionui_pairing", "other"),
                "x".repeat(2049),
            )
            .forEach { assertNull(PairingCode.parse(it, now)) }
    }
}
