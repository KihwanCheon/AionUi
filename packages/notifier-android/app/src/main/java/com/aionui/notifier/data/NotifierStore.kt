package com.aionui.notifier.data

import android.annotation.SuppressLint
import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

class NotifierStore(context: Context) {
    private val preferences = context.getSharedPreferences("notifier", Context.MODE_PRIVATE)
    private val mutableNotices = MutableStateFlow(load())
    val notices = mutableNotices.asStateFlow()
    val enabled = MutableStateFlow(preferences.getBoolean("enabled", false))
    val connected = MutableStateFlow(preferences.getString("sourceName", null))

    @Synchronized
    fun setEnabled(value: Boolean) {
        preferences.edit { putBoolean("enabled", value) }
        enabled.value = value
    }

    @Synchronized
    fun setConnection(sourceName: String?) {
        preferences.edit { putString("sourceName", sourceName) }
        connected.value = sourceName
    }

    @Synchronized
    fun accept(notice: PushNotice): Boolean {
        if (!enabled.value) return false
        val previous = mutableNotices.value.find { it.key == notice.key }
        if (previous != null) {
            if (notice.revision <= previous.revision) return false
            val updated = notice.copy(opened = previous.opened, createdAt = previous.createdAt)
            save(mutableNotices.value.map { if (it.key == notice.key) updated else it })
            return previous.title != updated.title || previous.body != updated.body
        }
        save((listOf(notice) + mutableNotices.value).take(100))
        return true
    }

    @Synchronized
    fun open(key: String) {
        save(mutableNotices.value.map { if (it.key == key) it.copy(opened = true) else it })
    }

    // Persist deduplication before a short-lived FCM service posts the notification.
    @SuppressLint("ApplySharedPref")
    private fun save(items: List<PushNotice>) {
        val json = JSONArray()
        items.forEach { notice ->
            json.put(
                JSONObject().apply {
                    put("sourceId", notice.sourceId)
                    put("noticeId", notice.noticeId)
                    put("title", notice.title)
                    put("body", notice.body)
                    put("createdAt", notice.createdAt)
                    put("conversationId", notice.conversationId)
                    put("messageId", notice.messageId)
                    put("markerIndex", notice.markerIndex)
                    put("webUrl", notice.webUrl)
                    put("opened", notice.opened)
                    put("revision", notice.revision)
                    put("updatedAt", notice.updatedAt)
                    put("silent", notice.silent)
                }
            )
        }
        preferences.edit(commit = true) { putString("notices", json.toString()) }
        mutableNotices.value = items
    }

    private fun load(): List<PushNotice> =
        runCatching {
                val array = JSONArray(preferences.getString("notices", "[]"))
                (0 until minOf(array.length(), 100)).map { index ->
                    val item = array.getJSONObject(index)
                    PushNotice(
                        item.getString("sourceId"),
                        item.getString("noticeId"),
                        item.getString("title"),
                        item.getString("body"),
                        item.getLong("createdAt"),
                        item.optString("conversationId"),
                        item.optString("messageId"),
                        item.optInt("markerIndex"),
                        PushNotice.safeWebUrl(item.optString("webUrl")),
                        item.optBoolean("opened"),
                        item.optLong("revision", 0),
                        item.optLong("updatedAt", item.getLong("createdAt")),
                        item.optBoolean("silent", false),
                    )
                }
            }
            .getOrDefault(emptyList())
}
