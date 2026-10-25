package com.aionui.notifier.data

import org.junit.Assert.*
import org.junit.Test

class PushNoticeTest {
    private val now = 1_800_000_000_000L

    private fun payload() =
        mapOf(
            "v" to "1",
            "type" to "user_choice",
            "sourceId" to "pc-1",
            "noticeId" to "notice-1",
            "createdAt" to "$now",
            "expiresAt" to "${now + 60_000}",
            "markerIndex" to "1",
        )

    @Test
    fun acceptsVersionedNoticeAndItsAnchor() {
        val notice =
            PushNotice.fromData(
                payload() + mapOf("conversationId" to "chat", "messageId" to "message"),
                now,
            )!!
        assertEquals("pc-1:notice-1", notice.key)
        assertEquals("message", notice.messageId)
        assertEquals(1, notice.markerIndex)
    }

    @Test
    fun preservesLongBodiesAndUpdateMetadata() {
        val body = "완성된 질문과 선택지입니다. ".repeat(100)
        val notice =
            PushNotice.fromData(
                payload() +
                    mapOf(
                        "body" to body,
                        "revision" to "2",
                        "silent" to "true",
                        "updatedAt" to "${now + 10}",
                    ),
                now,
            )!!
        assertEquals(body, notice.body)
        assertEquals(2L, notice.revision)
        assertTrue(notice.silent)
    }

    @Test
    fun rejectsExpiredAndMalformedMessages() {
        val invalid =
            listOf(
                payload() - "noticeId",
                payload() + ("v" to "2"),
                payload() + ("sourceId" to ""),
                payload() + ("expiresAt" to "$now"),
                payload() + ("createdAt" to "later"),
                payload() + ("markerIndex" to "-1"),
                payload() - "expiresAt",
                payload() + ("sourceId" to "pc:other"),
            )
        invalid.forEach { assertNull(PushNotice.fromData(it, now)) }
    }

    @Test
    fun disallowsCredentialAndExecutableLinks() {
        listOf(
                "javascript:alert(1)",
                "file:///secret",
                "intent://app",
                "https://name:secret@example.com",
                "http://example.com",
            )
            .forEach { assertNull(PushNotice.safeWebUrl(it)) }
        assertEquals(
            "https://aion.example/#/conversation/chat",
            PushNotice.safeWebUrl("https://aion.example/#/conversation/chat"),
        )
    }
}
