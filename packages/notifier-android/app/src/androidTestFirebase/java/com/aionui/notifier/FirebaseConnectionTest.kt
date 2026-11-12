package com.aionui.notifier

import android.Manifest
import android.util.Base64
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import com.aionui.notifier.data.PairingCode
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Live pairing uses temporary documents created and removed by the companion script. */
class FirebaseConnectionTest {
    @get:Rule
    val permission: GrantPermissionRule =
        GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS)
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun pairsWithFirebaseAndReceivesARealPush() {
        val encoded = InstrumentationRegistry.getArguments().getString("pairingCodeBase64")
        assumeTrue(encoded != null)
        val app = compose.activity.application as NotifierApplication
        val raw = String(Base64.decode(encoded, Base64.URL_SAFE or Base64.NO_WRAP), Charsets.UTF_8)
        val pairing = PairingCode.parse(raw)!!
        val expectedNotice =
            InstrumentationRegistry.getArguments().getString("expectedNoticeId")
                ?: "firebase-live-test"
        compose.activityRule.scenario.onActivity { app.store.setEnabled(true) }
        try {
            runBlocking { app.backend.pair(pairing) }
            val uid = FirebaseAuth.getInstance().currentUser!!.uid
            val db = FirebaseFirestore.getInstance()
            assertTrue(
                Tasks.await(db.collection("devices").document(uid).get(), 15, TimeUnit.SECONDS)
                    .exists()
            )
            denied(db.collection("devices").document("another-device").get())
            denied(db.collection("devices").limit(1).get())
            denied(db.collection("devices").document(uid).update("sourceId", "forged-source"))
            compose.waitUntil(120_000) {
                app.store.notices.value.any { it.noticeId == expectedNotice }
            }
            assertTrue(app.store.connected.value != null)
        } finally {
            app.store.setEnabled(false)
            app.notifications.cancelAll()
        }
    }

    private fun denied(task: Task<*>) {
        try {
            Tasks.await(task, 15, TimeUnit.SECONDS)
            fail("허용되지 않은 기기 정보 접근")
        } catch (error: ExecutionException) {
            assertEquals(
                FirebaseFirestoreException.Code.PERMISSION_DENIED,
                (error.cause as FirebaseFirestoreException).code,
            )
        }
    }
}
