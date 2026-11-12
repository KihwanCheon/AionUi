package com.aionui.notifier

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.lifecycle.lifecycleScope
import com.aionui.notifier.data.PairingCode
import com.aionui.notifier.data.PushNotice
import com.aionui.notifier.ui.NotifierScreen
import com.aionui.notifier.ui.NotifierTheme
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout

class MainActivity : ComponentActivity() {
    private val app
        get() = application as NotifierApplication

    private var permitted by mutableStateOf(false)
    private var busy by mutableStateOf(false)
    private var message by mutableStateOf<Int?>(null)
    private var selectedKey by mutableStateOf<String?>(null)
    private val backendMutex = Mutex()
    private var pendingOperations = 0
    private val permission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            permitted = app.notifications.permitted()
            if (!granted) message = R.string.permission_required
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        selectedKey = savedInstanceState?.getString("selectedKey")
        if (savedInstanceState == null) handleIntent(intent)
        setContent {
            NotifierTheme {
                NotifierScreen(
                    store = app.store,
                    cloudAvailable = app.backend.available,
                    permitted = permitted,
                    busy = busy,
                    message = message,
                    selectedKey = selectedKey,
                    onEnable = ::setEnabled,
                    onPermission = ::requestPermission,
                    onSettings = {
                        startActivity(
                            Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                                .putExtra(
                                    Settings.EXTRA_CHANNEL_ID,
                                    com.aionui.notifier.notifications.NoticeNotifications.CHANNEL_ID,
                                )
                        )
                    },
                    onTest = ::sendTest,
                    onScan = ::scan,
                    onPair = ::pair,
                    onDisconnect = ::disconnect,
                    onSelect = {
                        selectedKey = it
                        app.store.open(it)
                    },
                    onBack = { selectedKey = null },
                    onOpenWeb = { url ->
                        PushNotice.safeWebUrl(url)?.let { safe ->
                            runCatching { startActivity(Intent(Intent.ACTION_VIEW, safe.toUri())) }
                                .onFailure { message = R.string.web_unavailable }
                        }
                    },
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        permitted = app.notifications.permitted()
        if (app.backend.available) runBackend { app.backend.setEnabled(app.store.enabled.value) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("selectedKey", selectedKey)
        super.onSaveInstanceState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent) {
        val key = intent.getStringExtra("noticeKey") ?: return
        if (app.store.notices.value.any { it.key == key }) {
            selectedKey = key
            app.store.open(key)
        }
    }

    private fun requestPermission() {
        if (
            Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
        ) {
            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            startActivity(
                Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                    .putExtra(
                        Settings.EXTRA_CHANNEL_ID,
                        com.aionui.notifier.notifications.NoticeNotifications.CHANNEL_ID,
                    )
            )
        }
    }

    private fun setEnabled(enabled: Boolean) {
        app.store.setEnabled(enabled)
        if (enabled && !permitted) requestPermission()
        if (!enabled) app.notifications.cancelAll()
        runBackend { app.backend.setEnabled(app.store.enabled.value) }
    }

    private fun sendTest() {
        if (!app.store.enabled.value) {
            message = R.string.enable_first
            return
        }
        if (!app.notifications.permitted()) {
            requestPermission()
            return
        }
        val notice =
            PushNotice(
                "local-test",
                UUID.randomUUID().toString(),
                getString(R.string.test_title),
                getString(R.string.test_body),
                System.currentTimeMillis(),
            )
        if (app.store.accept(notice)) app.notifications.show(notice)
    }

    private fun scan() {
        val options =
            GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .enableAutoZoom()
                .build()
        GmsBarcodeScanning.getClient(this, options)
            .startScan()
            .addOnSuccessListener { result -> result.rawValue?.let(::pair) }
            .addOnFailureListener { message = R.string.scan_failed }
    }

    private fun pair(raw: String) {
        val code = PairingCode.parse(raw)
        if (code == null) {
            message = R.string.invalid_code
            return
        }
        if (!app.backend.available) {
            message = R.string.firebase_pending
            return
        }
        if (!app.store.enabled.value) {
            message = R.string.enable_first
            return
        }
        runBackend {
            app.backend.pair(code)
            message = R.string.pair_success
        }
    }

    private fun disconnect() {
        app.store.setEnabled(false)
        app.notifications.cancelAll()
        runBackend {
            app.backend.disconnect()
            app.store.setConnection(null)
            message = R.string.disconnect_success
        }
    }

    private fun runBackend(block: suspend () -> Unit) {
        pendingOperations++
        busy = true
        lifecycleScope.launch {
            try {
                backendMutex.withLock { withTimeout(15_000) { block() } }
            } catch (_: TimeoutCancellationException) {
                message = R.string.connection_failed
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                message = R.string.connection_failed
            } finally {
                pendingOperations--
                busy = pendingOperations > 0
            }
        }
    }
}
