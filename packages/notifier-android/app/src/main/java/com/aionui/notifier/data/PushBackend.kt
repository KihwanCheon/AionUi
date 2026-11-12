package com.aionui.notifier.data

/** Both preview and Firebase variants implement this boundary. */
interface PushBackend {
    val available: Boolean

    suspend fun setEnabled(enabled: Boolean)

    suspend fun pair(code: PairingCode): String

    suspend fun disconnect()
}
