package com.aionui.notifier.backend

import android.content.Context
import com.aionui.notifier.data.PairingCode
import com.aionui.notifier.data.PushBackend

fun createBackend(context: Context): PushBackend =
    object : PushBackend {
        override val available = false

        override suspend fun setEnabled(enabled: Boolean) = Unit

        override suspend fun pair(code: PairingCode): String =
            error("Firebase configuration is required")

        override suspend fun disconnect() = Unit
    }
