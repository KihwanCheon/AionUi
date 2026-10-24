package com.aionui.notifier

import android.app.Application
import com.aionui.notifier.backend.createBackend
import com.aionui.notifier.data.NotifierStore
import com.aionui.notifier.notifications.NoticeNotifications

class NotifierApplication : Application() {
    val store by lazy { NotifierStore(this) }
    val backend by lazy { createBackend(this) }
    val notifications by lazy { NoticeNotifications(this) }

    override fun onCreate() {
        super.onCreate()
        notifications.createChannel()
    }
}
