package com.aionui.notifier.backend

import com.aionui.notifier.NotifierApplication
import com.aionui.notifier.data.PushNotice
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class AionMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val app = application as NotifierApplication
        val notice = PushNotice.fromData(message.data) ?: return
        if (app.store.accept(notice)) app.notifications.show(notice)
    }

    override fun onNewToken(token: String) {
        RegistrationWorker.enqueue(this)
    }
}
