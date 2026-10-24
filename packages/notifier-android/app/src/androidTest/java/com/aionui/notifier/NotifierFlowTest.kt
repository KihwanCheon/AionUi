package com.aionui.notifier

import android.Manifest
import android.app.NotificationManager
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.rule.GrantPermissionRule
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotifierFlowTest {
    @get:Rule
    val permission: GrantPermissionRule =
        GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS)
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Before
    fun disableInitially() {
        compose.activityRule.scenario.onActivity { activity ->
            val app = activity.application as NotifierApplication
            app.store.setEnabled(false)
            app.notifications.cancelAll()
        }
    }

    @Test
    fun receivingIsOptIn() {
        compose.onNodeWithTag("receive-switch").assertIsOff()
        compose.onNodeWithTag("test-notification").assertIsNotEnabled()
    }

    @Test
    fun localTestAppearsInHistoryAndNotificationTapOpensThatRequest() {
        compose.onNodeWithTag("receive-switch").performClick()
        compose.onNodeWithTag("test-notification").assertIsEnabled().performClick()
        compose.onAllNodesWithTag("notice-row").onFirst().performScrollTo().assertIsDisplayed()
        compose.activityRule.scenario.onActivity { activity ->
            val notifications =
                activity.getSystemService(NotificationManager::class.java).activeNotifications
            assertEquals(1, notifications.size)
            notifications.single().notification.contentIntent.send()
        }
        compose.waitForIdle()
        compose.onNodeWithTag("notice-detail").assertIsDisplayed()
    }
}
