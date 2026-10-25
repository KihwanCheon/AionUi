package com.aionui.notifier.data

import java.net.URI

/** Versioned payload shared by the desktop sender and Android receiver. */
data class PushNotice(
    val sourceId: String,
    val noticeId: String,
    val title: String,
    val body: String,
    val createdAt: Long,
    val conversationId: String = "",
    val messageId: String = "",
    val markerIndex: Int = 0,
    val webUrl: String? = null,
    val opened: Boolean = false,
    val revision: Long = 0,
    val updatedAt: Long = createdAt,
    val silent: Boolean = false,
) {
    val key: String
        get() = "$sourceId:$noticeId"

    companion object {
        fun fromData(
            data: Map<String, String>,
            now: Long = System.currentTimeMillis(),
        ): PushNotice? {
            if (data["v"] != "1" || data["type"] != "user_choice") return null
            val sourceId = data["sourceId"]?.takeIf { it.length in 1..160 } ?: return null
            if (!Regex("[A-Za-z0-9_-]+").matches(sourceId)) return null
            val noticeId = data["noticeId"]?.takeIf { it.length in 1..512 } ?: return null
            val timestamp =
                data["createdAt"]?.toLongOrNull()?.takeIf { it in 1..now + 300_000 } ?: return null
            val expiresAt = data["expiresAt"]?.toLongOrNull() ?: return null
            if (expiresAt <= now || expiresAt < timestamp) return null
            val markerIndex = data["markerIndex"]?.toIntOrNull() ?: 0
            if (markerIndex < 0) return null
            val revision = data["revision"]?.toLongOrNull() ?: 0
            if (revision < 0) return null
            return PushNotice(
                sourceId,
                noticeId,
                data["title"].orEmpty().take(160),
                data["body"].orEmpty().take(4096),
                timestamp,
                data["conversationId"].orEmpty().take(160),
                data["messageId"].orEmpty().take(160),
                markerIndex,
                safeWebUrl(data["webUrl"]),
                revision = revision,
                updatedAt = data["updatedAt"]?.toLongOrNull() ?: timestamp,
                silent = data["silent"] == "true",
            )
        }

        fun safeWebUrl(value: String?): String? =
            runCatching {
                    val uri = URI(value ?: return null)
                    value.takeIf {
                        uri.scheme == "https" &&
                            !uri.host.isNullOrBlank() &&
                            uri.userInfo == null &&
                            value.length <= 2048
                    }
                }
                .getOrNull()
    }
}
