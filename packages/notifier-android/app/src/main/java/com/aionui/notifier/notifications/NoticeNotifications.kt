package com.aionui.notifier.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.aionui.notifier.MainActivity
import com.aionui.notifier.R
import com.aionui.notifier.data.PushNotice

class NoticeNotifications(private val context: Context) {
    fun createChannel() {
        context
            .getSystemService(NotificationManager::class.java)
            .createNotificationChannel(
                NotificationChannel(
                        CHANNEL_ID,
                        context.getString(R.string.channel_name),
                        NotificationManager.IMPORTANCE_HIGH,
                    )
                    .apply { description = context.getString(R.string.channel_description) }
            )
        context
            .getSystemService(NotificationManager::class.java)
            .createNotificationChannel(
                NotificationChannel(
                        MNP_CHANNEL_ID,
                        context.getString(R.string.mnp_channel_name),
                        NotificationManager.IMPORTANCE_HIGH,
                    )
                    .apply { description = context.getString(R.string.mnp_channel_description) }
            )
    }

    fun permitted(channelId: String? = null): Boolean {
        if (
            Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) != PackageManager.PERMISSION_GRANTED
        )
            return false
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
        val manager = context.getSystemService(NotificationManager::class.java)
        return (if (channelId == null) listOf(CHANNEL_ID, MNP_CHANNEL_ID) else listOf(channelId))
            .any { id ->
                val channel = manager.getNotificationChannel(id)
                channel != null && channel.importance != NotificationManager.IMPORTANCE_NONE
            }
    }

    fun show(notice: PushNotice, updateExisting: Boolean = false) {
        val mnp = notice.origin == "mnp"
        val channelId = if (mnp) MNP_CHANNEL_ID else CHANNEL_ID
        if (!permitted(channelId) || notice.opened) return
        if (
            updateExisting &&
                context.getSystemService(NotificationManager::class.java).activeNotifications.none {
                    it.tag == notice.key
                }
        )
            return
        val intent =
            Intent(context, MainActivity::class.java).apply {
                action = "com.aionui.notifier.OPEN_NOTICE"
                data =
                    android.net.Uri.Builder()
                        .scheme("aion-notifier")
                        .authority("notice")
                        .appendPath(notice.origin)
                        .appendPath(notice.sourceId)
                        .appendPath(notice.noticeId)
                        .build()
                putExtra("noticeKey", notice.key)
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
        val pending =
            PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val notification =
            NotificationCompat.Builder(context, channelId)
                .setSmallIcon(if (mnp) R.drawable.ic_mnp else R.drawable.ic_notifier)
                .setColor(
                    ContextCompat.getColor(
                        context,
                        if (mnp) R.color.mnp_accent else R.color.launcher_background,
                    )
                )
                .setContentTitle(notice.displayTitle(context))
                .setContentText(notice.displayBody(context))
                .setStyle(
                    NotificationCompat.BigTextStyle()
                        .bigText(notice.displayBody(context))
                )
                .setContentIntent(pending)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setSilent(notice.silent || updateExisting)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .build()
        try {
            NotificationManagerCompat.from(context).notify(notice.key, 0, notification)
        } catch (_: SecurityException) {
            // Permission may be revoked between the check and notify().
        }
    }

    fun cancelAll() = NotificationManagerCompat.from(context).cancelAll()

    companion object {
        const val CHANNEL_ID = "aion_user_choice"
        const val MNP_CHANNEL_ID = "mnp_work_notifications"
    }
}
