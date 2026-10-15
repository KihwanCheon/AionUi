import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './SectionActivityIndicator.module.css';

/** Show aggregate activity without changing the size of a sidebar section header. */
export default function SectionActivityIndicator() {
  const { t } = useTranslation();
  return (
    <span
      role='img'
      aria-label={t('common.processing')}
      title={t('common.processing')}
      className={`${styles.indicator} ms-6px text-t-tertiary sider-section-title group-hover/label:text-t-primary transition-colors`}
    >
      <span className={styles.dot} aria-hidden='true' />
      <span className={styles.dot} aria-hidden='true' />
      <span className={styles.dot} aria-hidden='true' />
    </span>
  );
}
