package com.aionui.notifier.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aionui.notifier.R
import com.aionui.notifier.data.NotifierStore
import com.aionui.notifier.data.PushNotice
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotifierScreen(
    store: NotifierStore,
    cloudAvailable: Boolean,
    permitted: Boolean,
    busy: Boolean,
    message: Int?,
    selectedKey: String?,
    onEnable: (Boolean) -> Unit,
    onPermission: () -> Unit,
    onSettings: () -> Unit,
    onTest: () -> Unit,
    onScan: () -> Unit,
    onPair: (String) -> Unit,
    onDisconnect: () -> Unit,
    onSelect: (String) -> Unit,
    onBack: () -> Unit,
    onOpenWeb: (String) -> Unit,
) {
    val enabled by store.enabled.collectAsStateWithLifecycle()
    val connection by store.connected.collectAsStateWithLifecycle()
    val notices by store.notices.collectAsStateWithLifecycle()
    var showPairDialog by remember { mutableStateOf(false) }
    val selected = notices.find { it.key == selectedKey }
    BackHandler(enabled = selected != null, onBack = onBack)
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(stringResource(R.string.app_name), fontWeight = FontWeight.Bold)
                        Text(
                            stringResource(R.string.subtitle),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                navigationIcon = {
                    if (selected != null)
                        IconButton(onClick = onBack) {
                            Icon(
                                Icons.AutoMirrored.Outlined.ArrowBack,
                                stringResource(R.string.back),
                            )
                        }
                },
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).testTag("notifier-home"),
            contentPadding = PaddingValues(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (selected != null) {
                item { Detail(selected, onOpenWeb) }
            } else {
                item {
                    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            Modifier.padding(20.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Icon(
                                Icons.Outlined.NotificationsActive,
                                null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(32.dp),
                            )
                            Text(
                                stringResource(R.string.choice_title),
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                stringResource(R.string.intro),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    stringResource(R.string.receive_enabled),
                                    modifier = Modifier.weight(1f),
                                )
                                Switch(
                                    checked = enabled,
                                    onCheckedChange = onEnable,
                                    modifier = Modifier.testTag("receive-switch"),
                                )
                            }
                            Text(
                                stringResource(
                                    if (permitted) R.string.permission_granted
                                    else R.string.permission_required
                                ),
                                color =
                                    if (permitted) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.tertiary,
                            )
                            if (!permitted)
                                OutlinedButton(onClick = onPermission) {
                                    Text(stringResource(R.string.allow_notifications))
                                }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(
                                    onClick = onTest,
                                    enabled = enabled && !busy,
                                    modifier = Modifier.testTag("test-notification"),
                                ) {
                                    Text(stringResource(R.string.test_notification))
                                }
                                TextButton(onClick = onSettings) {
                                    Text(stringResource(R.string.notification_settings))
                                }
                            }
                        }
                    }
                }
                item {
                    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            Modifier.padding(20.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Text(
                                stringResource(R.string.pc_connection),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                connection
                                    ?: stringResource(
                                        if (cloudAvailable) R.string.not_connected
                                        else R.string.firebase_pending
                                    ),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                stringResource(R.string.connect_help),
                                style = MaterialTheme.typography.bodySmall,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(
                                    onClick = onScan,
                                    enabled = !busy && connection == null,
                                ) {
                                    Icon(Icons.Outlined.QrCodeScanner, null)
                                    Spacer(Modifier.width(8.dp))
                                    Text(stringResource(R.string.scan_qr))
                                }
                                TextButton(
                                    onClick = { showPairDialog = true },
                                    enabled = !busy && connection == null,
                                ) {
                                    Text(stringResource(R.string.enter_code))
                                }
                            }
                            if (connection != null)
                                TextButton(onClick = onDisconnect, enabled = !busy) {
                                    Text(stringResource(R.string.disconnect))
                                }
                        }
                    }
                }
                if (busy) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
                if (message != null)
                    item {
                        Text(stringResource(message), color = MaterialTheme.colorScheme.tertiary)
                    }
                item {
                    Text(
                        stringResource(R.string.received_notices),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
                if (notices.isEmpty())
                    item {
                        Text(
                            stringResource(R.string.empty_notices),
                            modifier = Modifier.padding(vertical = 12.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                items(notices, key = { it.key }) { notice ->
                    OutlinedCard(
                        Modifier.fillMaxWidth()
                            .clickable { onSelect(notice.key) }
                            .testTag("notice-row")
                    ) {
                        Column(
                            Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text(
                                notice.title.ifBlank { stringResource(R.string.choice_title) },
                                fontWeight =
                                    if (notice.opened) FontWeight.Normal else FontWeight.Bold,
                            )
                            Text(
                                notice.body.ifBlank { stringResource(R.string.choice_body) },
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                                    .format(Date(notice.createdAt)),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                item {
                    Text(
                        stringResource(R.string.dismiss_help),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
    if (showPairDialog) {
        var raw by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showPairDialog = false },
            title = { Text(stringResource(R.string.enter_code)) },
            text = {
                OutlinedTextField(
                    value = raw,
                    onValueChange = { if (it.length <= 2048) raw = it },
                    label = { Text(stringResource(R.string.pairing_code)) },
                    maxLines = 5,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onPair(raw)
                        raw = ""
                        showPairDialog = false
                    },
                    enabled = raw.isNotBlank(),
                ) {
                    Text(stringResource(R.string.connect))
                }
            },
            dismissButton = {
                TextButton(onClick = { showPairDialog = false }) {
                    Text(stringResource(R.string.cancel))
                }
            },
        )
    }
}

@Composable
private fun Detail(notice: PushNotice, onOpenWeb: (String) -> Unit) {
    ElevatedCard(Modifier.fillMaxWidth().testTag("notice-detail")) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(
                notice.title.ifBlank { stringResource(R.string.choice_title) },
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(notice.body.ifBlank { stringResource(R.string.choice_body) })
            Text(
                stringResource(R.string.dismiss_help),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            notice.webUrl?.let { url ->
                Button(onClick = { onOpenWeb(url) }) {
                    Text(stringResource(R.string.open_conversation))
                }
            }
        }
    }
}
