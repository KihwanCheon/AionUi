package com.aionui.notifier.backend

import com.aionui.notifier.NotifierApplication
import com.aionui.notifier.data.PushNotice
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class AionMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val app = application as NotifierApplication
        val notice = PushNotice.fromData(message.data) ?: return
        val existed = app.store.notices.value.any { it.key == notice.key }
        if (app.store.accept(notice)) {
            val saved = app.store.notices.value.first { it.key == notice.key }
            app.notifications.show(saved, updateExisting = existed)
        }
    }

    override fun onNewToken(token: String) {
        RegistrationWorker.enqueue(this)
    }
}
