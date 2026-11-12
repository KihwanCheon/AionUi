package com.aionui.notifier.notifications

import android.app.Application
import android.app.NotificationManager
import android.content.Context
import com.aionui.notifier.data.PushNotice
import com.aionui.notifier.R
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [32], application = Application::class)
class NoticeNotificationsTest {
    private val context
        get() = RuntimeEnvironment.getApplication() as Context

    @Test
    fun notificationTapKeepsTheExactRequestIdentity() {
        val notifications = NoticeNotifications(context)
        notifications.createChannel()
        notifications.show(PushNotice("pc-one", "first", "제목", "본문", 100))
        notifications.show(PushNotice("pc-two", "second", "제목", "본문", 100))
        val active = context.getSystemService(NotificationManager::class.java).activeNotifications
        assertEquals(2, active.size)
        val keys =
            active
                .map {
                    shadowOf(it.notification.contentIntent).savedIntent.getStringExtra("noticeKey")
                }
                .toSet()
        assertEquals(setOf("pc-one:first", "pc-two:second"), keys)
    }

    @Test
    fun mnpUsesItsOwnChannelIconAndExactTapIdentity() {
        val notifications = NoticeNotifications(context)
        notifications.createChannel()
        notifications.show(PushNotice("pc", "same", "검토 요청", "본문", 100))
        notifications.show(PushNotice("pc", "same", "검토 요청", "본문", 100, origin = "mnp"))
        val active = context.getSystemService(NotificationManager::class.java).activeNotifications
        assertEquals(2, active.size)
        val mnp = active.first { it.tag == "mnp:pc:same" }.notification
        assertEquals(NoticeNotifications.MNP_CHANNEL_ID, mnp.channelId)
        assertEquals(R.drawable.ic_mnp, mnp.smallIcon.resId)
        assertTrue(mnp.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString().startsWith("[MnP]"))
    }

    @Test
    fun blockedMnpChannelDoesNotBlockTheAionChannel() {
        val notifications = NoticeNotifications(context)
        notifications.createChannel()
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.deleteNotificationChannel(NoticeNotifications.MNP_CHANNEL_ID)
        manager.createNotificationChannel(android.app.NotificationChannel(NoticeNotifications.MNP_CHANNEL_ID, "MnP", NotificationManager.IMPORTANCE_NONE))
        assertFalse(notifications.permitted(NoticeNotifications.MNP_CHANNEL_ID))
        assertTrue(notifications.permitted())
    }

    @Test
    fun blockedChannelPreventsNotificationDisplay() {
        val notifications = NoticeNotifications(context)
        notifications.createChannel()
        shadowOf(context.getSystemService(NotificationManager::class.java))
            .setNotificationsEnabled(false)
        notifications.show(PushNotice("pc", "request", "", "", 100))
        assertTrue(
            context.getSystemService(NotificationManager::class.java).activeNotifications.isEmpty()
        )
    }

    @Test
    fun replacesAnActiveNotificationSilentlyWithoutCreatingAnother() {
        val notifications = NoticeNotifications(context)
        notifications.createChannel()
        val original = PushNotice("pc", "request", "제목", "작성 중", 100, revision = 1)
        notifications.show(original)
        notifications.show(
            original.copy(body = "완성된 질문", revision = 2, silent = true),
            updateExisting = true,
        )
        val active = context.getSystemService(NotificationManager::class.java).activeNotifications
        assertEquals(1, active.size)
        assertEquals(
            "완성된 질문",
            active
                .single()
                .notification
                .extras
                .getCharSequence(android.app.Notification.EXTRA_BIG_TEXT),
        )
        assertTrue(
            active.single().notification.flags and android.app.Notification.FLAG_ONLY_ALERT_ONCE !=
                0
        )
    }

    @Test
    fun updatesDoNotRecreateDismissedOrOpenedNotifications() {
        val notifications = NoticeNotifications(context)
        notifications.createChannel()
        val notice = PushNotice("pc", "request", "제목", "본문", 100)
        notifications.show(notice)
        notifications.cancelAll()
        notifications.show(notice.copy(revision = 2, silent = true), updateExisting = true)
        notifications.show(notice.copy(opened = true))
        assertTrue(
            context.getSystemService(NotificationManager::class.java).activeNotifications.isEmpty()
        )
    }
}
