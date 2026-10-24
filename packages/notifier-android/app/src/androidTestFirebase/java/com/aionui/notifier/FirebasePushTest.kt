package com.aionui.notifier

import android.Manifest
import android.app.NotificationManager
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.lifecycle.Lifecycle
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Live FCM test. Registration tokens are only exported to this test app's private files. */
class FirebasePushTest {
    @get:Rule
    val permission: GrantPermissionRule =
        GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS)
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun receivesForegroundAndBackgroundPushes() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("liveFcm") == "true")
        val app = compose.activity.application as NotifierApplication
        val fixture = File(app.filesDir, "firebase-smoke-token.json")
        val sourceId = "smoke-${UUID.randomUUID()}"
        try {
            app.store.setEnabled(true)
            FirebaseMessaging.getInstance().isAutoInitEnabled = true
            val token = Tasks.await(FirebaseMessaging.getInstance().token, 45, TimeUnit.SECONDS)
            fun ready(phase: String) {
                fixture.writeText(
                    JSONObject()
                        .put("token", token)
                        .put("sourceId", sourceId)
                        .put("phase", phase)
                        .toString()
                )
            }
            ready("foreground")
            compose.waitUntil(120_000) {
                app.store.notices.value.any {
                    it.sourceId == sourceId && it.noticeId == "firebase-foreground-test"
                }
            }
            compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
            ready("background")
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(120)
            while (
                System.nanoTime() < deadline &&
                    app.store.notices.value.none {
                        it.sourceId == sourceId && it.noticeId == "firebase-background-test"
                    }
            ) Thread.sleep(200)
            val notice =
                app.store.notices.value.find {
                    it.sourceId == sourceId && it.noticeId == "firebase-background-test"
                }
            assertTrue("백그라운드 푸시 수신", notice != null)
            val posted =
                app.getSystemService(NotificationManager::class.java).activeNotifications.find {
                    it.tag == notice!!.key
                }
            assertTrue("Android 알림 표시", posted != null)
            posted!!.notification.contentIntent.send()
            compose.waitForIdle()
            compose.onNodeWithTag("notice-detail").assertIsDisplayed()
        } finally {
            fixture.delete()
            app.store.setEnabled(false)
            app.notifications.cancelAll()
            FirebaseMessaging.getInstance().isAutoInitEnabled = false
        }
    }
}
