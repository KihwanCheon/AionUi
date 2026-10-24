package com.aionui.notifier.data

import android.app.Application
import android.content.Context
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class NotifierStoreTest {
    private val context
        get() = RuntimeEnvironment.getApplication() as Context

    private fun notice(id: String = "request") = PushNotice("pc-1", id, "제목", "본문", 100)

    @Before
    fun reset() {
        context.getSharedPreferences("notifier", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun startsDisabledAndIgnoresIncomingPush() {
        val store = NotifierStore(context)
        assertFalse(store.enabled.value)
        assertFalse(store.accept(notice()))
        assertTrue(store.notices.value.isEmpty())
    }

    @Test
    fun suppressesDuplicatesAcrossProcessRestarts() {
        NotifierStore(context).apply {
            setEnabled(true)
            assertTrue(accept(notice()))
        }
        val restarted = NotifierStore(context)
        assertFalse(restarted.accept(notice()))
        assertEquals(1, restarted.notices.value.size)
    }

    @Test
    fun doesNotMergeDifferentPcsWithTheSameNoticeId() {
        val store = NotifierStore(context).apply { setEnabled(true) }
        store.accept(notice())
        assertTrue(store.accept(notice().copy(sourceId = "pc-2")))
        assertEquals(2, store.notices.value.size)
    }

    @Test
    fun openingARequestKeepsItInHistoryAndPersistsReadState() {
        val store =
            NotifierStore(context).apply {
                setEnabled(true)
                accept(notice())
            }
        store.open(notice().key)
        val saved = NotifierStore(context).notices.value.single()
        assertEquals(notice().key, saved.key)
        assertTrue(saved.opened)
    }

    @Test
    fun boundsHistoryAndStopsReceivingWhenDisabled() {
        val store = NotifierStore(context).apply { setEnabled(true) }
        repeat(110) { store.accept(notice("request-$it")) }
        assertEquals(100, store.notices.value.size)
        store.setEnabled(false)
        assertFalse(store.accept(notice("disabled")))
    }
}
