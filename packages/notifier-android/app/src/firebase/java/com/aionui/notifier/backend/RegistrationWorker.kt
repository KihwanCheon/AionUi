package com.aionui.notifier.backend

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.aionui.notifier.NotifierApplication
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException

class RegistrationWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {
    override suspend fun doWork(): Result =
        try {
            val app = applicationContext as NotifierApplication
            app.backend.setEnabled(app.store.enabled.value)
            Result.success()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            if (runAttemptCount < 5) Result.retry() else Result.failure()
        }

    companion object {
        fun enqueue(context: Context) {
            val request =
                OneTimeWorkRequestBuilder<RegistrationWorker>()
                    .setConstraints(
                        Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
                    )
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                    .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork("fcm-registration", ExistingWorkPolicy.REPLACE, request)
        }
    }
}
