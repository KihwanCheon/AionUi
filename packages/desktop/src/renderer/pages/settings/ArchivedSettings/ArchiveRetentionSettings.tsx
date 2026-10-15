import { ipcBridge } from '@/common';
import type { ArchiveRetentionResponse, ArchiveRetentionSettings as RetentionSettings } from '@/common/types/sidebar';
import { Button, Form, InputNumber, Message, Modal, Spin, Switch, TimePicker } from '@arco-design/web-react';
import { DeleteOne } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Configure the backend's daily archive cleanup without deleting anything on save. */
export default function ArchiveRetentionSettings() {
  const { t, i18n } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState<ArchiveRetentionResponse | null>(null);
  const [draft, setDraft] = useState<RetentionSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoaded(null);
    setDraft(null);
    setLoadFailed(false);
    void ipcBridge.sidebar.getArchiveRetention.invoke().then(
      (response) => {
        if (cancelled) return;
        setLoaded(response);
        setDraft(response.settings);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [visible, reload]);

  const valid =
    draft &&
    Number.isInteger(draft.retention_days) &&
    draft.retention_days >= 1 &&
    draft.retention_days <= 3650 &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.run_at);
  const save = async () => {
    if (!draft || !valid || saving) return;
    setSaving(true);
    try {
      await ipcBridge.sidebar.saveArchiveRetention.invoke(draft);
      Message.success(t('settings.archived.retention.saved'));
      setVisible(false);
    } catch {
      Message.error(t('settings.archived.retention.saveFailed'));
    } finally {
      setSaving(false);
    }
  };
  const formatTime = (at: number) =>
    new Intl.DateTimeFormat(i18n.language, {
      timeZone: loaded?.settings.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);

  return (
    <>
      <Button type='secondary' icon={<DeleteOne theme='outline' size='16' />} onClick={() => setVisible(true)}>
        {t('settings.archived.retention.title')}
      </Button>
      <Modal
        title={t('settings.archived.retention.title')}
        visible={visible}
        onCancel={() => {
          if (!saving) setVisible(false);
        }}
        onOk={() => void save()}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={saving}
        okButtonProps={{ disabled: !valid }}
        cancelButtonProps={{ disabled: saving }}
        maskClosable={!saving}
        closable={!saving}
        style={{ width: 'min(520px, calc(100vw - 32px))' }}
        alignCenter
        unmountOnExit
      >
        {loadFailed ? (
          <div className='flex flex-col items-start gap-12px'>
            <span className='text-t-secondary'>{t('settings.archived.retention.loadFailed')}</span>
            <Button onClick={() => setReload((value) => value + 1)}>{t('common.retry')}</Button>
          </div>
        ) : !draft ? (
          <div className='flex-center py-24px'>
            <Spin />
          </div>
        ) : (
          <div className='flex flex-col gap-16px'>
            <p className='m-0 text-13px text-t-secondary leading-relaxed'>
              {t('settings.archived.retention.description')}
            </p>
            <Form layout='vertical' disabled={saving}>
              <Form.Item label={t('settings.archived.retention.enabled')}>
                <Switch
                  aria-label={t('settings.archived.retention.enabled')}
                  checked={draft.enabled}
                  onChange={(enabled) => setDraft({ ...draft, enabled })}
                />
              </Form.Item>
              <Form.Item label={t('settings.archived.retention.days')}>
                <InputNumber
                  aria-label={t('settings.archived.retention.days')}
                  disabled={saving || !draft.enabled}
                  min={1}
                  max={3650}
                  precision={0}
                  value={draft.retention_days}
                  onChange={(retention_days) => setDraft({ ...draft, retention_days })}
                />
              </Form.Item>
              <Form.Item label={t('settings.archived.retention.time')}>
                <TimePicker
                  aria-label={t('settings.archived.retention.time')}
                  disabled={saving || !draft.enabled}
                  format='HH:mm'
                  value={draft.run_at}
                  disableConfirm
                  onChange={(run_at) => setDraft({ ...draft, run_at })}
                />
              </Form.Item>
              <div className='text-12px text-t-secondary'>
                {t('settings.archived.retention.timezone', { timezone: draft.timezone })}
              </div>
            </Form>
            <p className='m-0 text-12px text-t-secondary leading-relaxed'>{t('settings.archived.retention.runtime')}</p>
            {loaded?.next_run_at != null && (
              <div className='text-12px text-t-secondary'>
                {t('settings.archived.retention.nextRun', { time: formatTime(loaded.next_run_at) })}
              </div>
            )}
            {loaded?.last_run_at != null && (
              <div className='text-12px text-t-secondary'>
                {t('settings.archived.retention.lastRun', {
                  time: formatTime(loaded.last_run_at),
                  deleted: loaded.last_deleted,
                  failed: loaded.last_failed,
                })}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
