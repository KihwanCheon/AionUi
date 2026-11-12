package com.aionui.notifier.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** App semantic palette; surfaces and emphasis are consumed through MaterialTheme. */
@Composable
fun NotifierTheme(content: @Composable () -> Unit) {
    val palette =
        if (isSystemInDarkTheme())
            darkColorScheme(
                primary = Color(0xFF9AB6FF),
                background = Color(0xFF10131C),
                surface = Color(0xFF181C29),
                secondaryContainer = Color(0xFF2A3551),
                tertiary = Color(0xFFFFC27A),
                tertiaryContainer = Color(0xFF133C36),
                onTertiaryContainer = Color(0xFF9AE6D9),
            )
        else
            lightColorScheme(
                primary = Color(0xFF315DC1),
                background = Color(0xFFF6F7FC),
                surface = Color(0xFFFFFFFF),
                secondaryContainer = Color(0xFFE6ECFF),
                tertiary = Color(0xFF8A5100),
                tertiaryContainer = Color(0xFFE0F3EE),
                onTertiaryContainer = Color(0xFF005449),
            )
    MaterialTheme(colorScheme = palette, content = content)
}
