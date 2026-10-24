package com.aionui.notifier.backend

import android.content.Context
import android.os.Build
import com.aionui.notifier.NotifierApplication
import com.aionui.notifier.data.PairingCode
import com.aionui.notifier.data.PushBackend
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await

fun createBackend(context: Context): PushBackend =
    FirebaseBackend(context.applicationContext as NotifierApplication)

private class FirebaseBackend(private val app: NotifierApplication) : PushBackend {
    override val available: Boolean
        get() = FirebaseApp.getApps(app).isNotEmpty()

    override suspend fun setEnabled(enabled: Boolean) {
        if (!available) return
        val deliverable = enabled && app.notifications.permitted()
        val messaging = FirebaseMessaging.getInstance()
        messaging.isAutoInitEnabled = deliverable
        val user = FirebaseAuth.getInstance().currentUser ?: return
        if (app.store.connected.value == null) return
        val updates =
            mutableMapOf<String, Any>(
                "enabled" to deliverable,
                "updatedAt" to FieldValue.serverTimestamp(),
            )
        if (deliverable) updates["fcmToken"] = messaging.token.await()
        FirebaseFirestore.getInstance()
            .collection("devices")
            .document(user.uid)
            .update(updates)
            .await()
    }

    override suspend fun pair(code: PairingCode): String {
        check(
            app.store.enabled.value && code.projectId == FirebaseApp.getInstance().options.projectId
        )
        val auth = FirebaseAuth.getInstance()
        val user =
            auth.currentUser
                ?: auth.signInAnonymously().await().user
                ?: error("Authentication failed")
        val db = FirebaseFirestore.getInstance()
        val pairingRef = db.collection("pairings").document(code.pairingId)
        val pairing =
            db.runTransaction { transaction ->
                    val snapshot = transaction.get(pairingRef)
                    check(snapshot.exists())
                    val claimedBy = snapshot.getString("claimedBy")
                    check(claimedBy == null || claimedBy == user.uid)
                    if (claimedBy == null) {
                        check(
                            (snapshot.getTimestamp("expiresAt")?.toDate()?.time ?: 0) >
                                System.currentTimeMillis()
                        )
                        transaction.update(
                            pairingRef,
                            mapOf(
                                "claimedBy" to user.uid,
                                "claimedAt" to FieldValue.serverTimestamp(),
                            ),
                        )
                    }
                    val sourceId = snapshot.getString("sourceId") ?: error("Missing source")
                    sourceId to (snapshot.getString("sourceName") ?: sourceId)
                }
                .await()
        val token = FirebaseMessaging.getInstance().token.await()
        db.collection("devices")
            .document(user.uid)
            .set(
                mapOf(
                    "pairingId" to code.pairingId,
                    "sourceId" to pairing.first,
                    "deviceName" to Build.MODEL,
                    "fcmToken" to token,
                    "enabled" to (app.store.enabled.value && app.notifications.permitted()),
                    "updatedAt" to FieldValue.serverTimestamp(),
                )
            )
            .await()
        app.store.setConnection(pairing.second)
        return pairing.second
    }

    override suspend fun disconnect() {
        FirebaseMessaging.getInstance().isAutoInitEnabled = false
        val auth = FirebaseAuth.getInstance()
        auth.currentUser?.let { user ->
            FirebaseFirestore.getInstance()
                .collection("devices")
                .document(user.uid)
                .delete()
                .await()
        }
        FirebaseMessaging.getInstance().deleteToken().await()
        auth.signOut()
        app.store.setConnection(null)
    }
}
