import React from 'react';
import { Alert, Button, Descriptions, Modal, Spin, Table } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { isElectronDesktop } from '@renderer/utils/platform';
import SettingsPageWrapper from '../../components/SettingsPageWrapper';
import SettingsPageHeader from '../../components/SettingsPageHeader';
import { formatDatabaseBytes as bytes, useDatabaseMaintenance } from './useDatabaseMaintenance';

const ERROR_KEYS: Record<string, string> = {
  database_in_use: 'busy',
  insufficient_space: 'space',
  database_missing: 'missing',
  backend_update_required: 'update',
  backend_unavailable: 'unavailable',
  restart_failed: 'restart',
  restart_required: 'restart',
  nothing_to_reclaim: 'nothing',
};

const DatabaseMaintenance: React.FC = () => {
  const { t } = useTranslation();
  const [confirmVisible, setConfirmVisible] = React.useState(false);
  const desktop = isElectronDesktop();
  const { status, pending, error, start } = useDatabaseMaintenance(desktop);
  const usage = status?.usage;
  const busy = pending || Boolean(status?.busy);
  const needsRestart = Boolean(status?.restartRequired);
  const insufficientSpace = Boolean(usage && usage.available_bytes < usage.required_free_bytes);
  const compactDisabled = busy || needsRestart || !usage || usage.free_bytes === 0 || insufficientSpace;
  const result = status?.result;

  return (
    <SettingsPageWrapper>
      <Modal
        visible={confirmVisible}
        title={t('settings.databaseMaintenance.confirmTitle')}
        okText={t('settings.databaseMaintenance.compact')}
        cancelText={t('common.cancel')}
        okButtonProps={{ disabled: compactDisabled }}
        onCancel={() => setConfirmVisible(false)}
        onOk={() => {
          setConfirmVisible(false);
          void start('compact');
        }}
      >
        {t('settings.databaseMaintenance.confirmBody')}
      </Modal>
      <SettingsPageHeader
        title={t('settings.databaseMaintenance.title')}
        description={t('settings.databaseMaintenance.description')}
        actions={
          desktop ? (
            <>
              <Button disabled={busy || needsRestart || !status} onClick={() => void start('inspect')}>
                {t('settings.databaseMaintenance.inspect')}
              </Button>
              <Button type='primary' disabled={compactDisabled} onClick={() => setConfirmVisible(true)}>
                {t('settings.databaseMaintenance.compact')}
              </Button>
            </>
          ) : undefined
        }
      />
      <div className='flex flex-col gap-16px mt-20px'>
        {!desktop ? (
          <Alert content={t('settings.databaseMaintenance.desktopOnly')} />
        ) : (
          <>
            <Alert content={t('settings.databaseMaintenance.retentionNote')} />
            {busy && status && (
              <div role='status' aria-live='polite' className='flex items-center gap-12px text-t-primary'>
                <Spin size={18} />
                <span>{t(`settings.databaseMaintenance.phases.${status.phase}`)}</span>
                {status.startedAt && (
                  <span className='text-t-secondary'>
                    {t('settings.databaseMaintenance.elapsed', {
                      seconds: Math.max(0, Math.floor((Date.now() - status.startedAt) / 1000)),
                    })}
                  </span>
                )}
              </div>
            )}
            {error && (
              <Alert
                type='error'
                content={t(`settings.databaseMaintenance.errors.${ERROR_KEYS[error] ?? 'generic'}`)}
              />
            )}
            {needsRestart && !busy && (
              <Button onClick={() => void start('restart')}>{t('settings.databaseMaintenance.restart')}</Button>
            )}
            {result && !busy && !needsRestart && (
              <Alert
                type='success'
                content={t('settings.databaseMaintenance.result', {
                  before: bytes(result.before_bytes),
                  after: bytes(result.after_bytes),
                  reclaimed: bytes(result.reclaimed_bytes),
                })}
              />
            )}
            {!usage && !busy && !error && (
              <div className='text-t-secondary'>{t('settings.databaseMaintenance.empty')}</div>
            )}
            {usage && (
              <>
                <div className='rounded-12px bg-fill-1 p-20px'>
                  <Descriptions
                    column={2}
                    data={[
                      { label: t('settings.databaseMaintenance.databaseSize'), value: bytes(usage.database_bytes) },
                      { label: t('settings.databaseMaintenance.walSize'), value: bytes(usage.wal_bytes) },
                      { label: t('settings.databaseMaintenance.reclaimable'), value: bytes(usage.free_bytes) },
                      {
                        label: t('settings.databaseMaintenance.conversations'),
                        value: usage.conversation_count.toLocaleString(),
                      },
                      { label: t('settings.databaseMaintenance.available'), value: bytes(usage.available_bytes) },
                      { label: t('settings.databaseMaintenance.required'), value: bytes(usage.required_free_bytes) },
                    ]}
                  />
                  <p className='mb-0 text-12px text-t-secondary'>{t('settings.databaseMaintenance.estimateNote')}</p>
                </div>
                {insufficientSpace && <Alert type='warning' content={t('settings.databaseMaintenance.errors.space')} />}
                {usage.free_bytes === 0 && <Alert content={t('settings.databaseMaintenance.errors.nothing')} />}
                <div>
                  <h2 className='text-16px text-t-primary'>{t('settings.databaseMaintenance.breakdown')}</h2>
                  <p className='text-13px text-t-secondary'>{t('settings.databaseMaintenance.logicalNote')}</p>
                  <Table
                    rowKey='message_type'
                    pagination={false}
                    data={usage.messages}
                    columns={[
                      { title: t('settings.databaseMaintenance.messageType'), dataIndex: 'message_type' },
                      {
                        title: t('settings.databaseMaintenance.count'),
                        dataIndex: 'count',
                        render: (value: number) => value.toLocaleString(),
                      },
                      {
                        title: t('settings.databaseMaintenance.contentSize'),
                        dataIndex: 'content_bytes',
                        render: bytes,
                      },
                    ]}
                  />
                </div>
                {status?.inspectedAt && (
                  <div className='text-12px text-t-secondary'>
                    {t('settings.databaseMaintenance.inspectedAt', {
                      time: new Date(status.inspectedAt).toLocaleString(),
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </SettingsPageWrapper>
  );
};

export default DatabaseMaintenance;
