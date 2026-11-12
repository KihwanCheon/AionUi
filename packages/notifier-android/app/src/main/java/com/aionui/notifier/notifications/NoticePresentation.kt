package com.aionui.notifier.notifications

import android.content.Context
import com.aionui.notifier.R
import com.aionui.notifier.data.PushNotice

/** Source styling is shared by system notifications and the in-app history. */
fun PushNotice.displayTitle(context: Context): String =
    if (origin == "mnp")
        context.getString(
            R.string.mnp_title_format,
            title.ifBlank { context.getString(kindResource()) },
        )
    else title.ifBlank { context.getString(R.string.choice_title) }

fun PushNotice.displayBody(context: Context): String =
    body.ifBlank { context.getString(if (origin == "mnp") R.string.mnp_body else R.string.choice_body) }

fun PushNotice.sourceBadge(context: Context): String =
    context.getString(
        R.string.mnp_badge_format,
        context.getString(kindResource()),
    )

private fun PushNotice.kindResource(): Int =
    when (kind) {
        "choice" -> R.string.mnp_kind_choice
        "failure" -> R.string.mnp_kind_failure
        else -> R.string.mnp_kind_info
    }
