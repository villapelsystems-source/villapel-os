import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';
import { api } from '../lib/api';
import { leadStatusLabel } from '../lib/i18n';

export default function SettingsPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [statuses, setStatuses] = useState([]);

  useEffect(() => {
    api.getStatuses().then((d) => setStatuses(d.statuses || [])).catch(() => {});
  }, []);

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="font-heading font-bold text-2xl tracking-tight">{t('settings.title')}</h1>

      <div className="bg-surface border border-white/10 rounded-lg p-5">
        <h3 className="font-heading font-semibold text-sm mb-4">{t('settings.profile')}</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-white/60">{t('settings.name')}</div>
            <div className="text-sm mt-1">{user?.name || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-white/60">{t('settings.email')}</div>
            <div className="text-sm mt-1">{user?.email || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-white/60">{t('settings.role')}</div>
            <div className="text-sm mt-1 capitalize">{user?.role || '—'}</div>
          </div>
        </div>
      </div>

      <div className="bg-surface border border-white/10 rounded-lg p-5">
        <h3 className="font-heading font-semibold text-sm mb-4">{t('settings.leadStatuses')}</h3>
        <div className="flex flex-wrap gap-2">
          {statuses.map((s) => (
            <span key={s} className="px-3 py-1 rounded-full text-xs font-medium bg-accent/10 text-accent border border-accent/20">
              {leadStatusLabel(t, s)}
            </span>
          ))}
          {statuses.length === 0 && <span className="text-xs text-white/40">{t('settings.loadingStatuses')}</span>}
        </div>
      </div>
    </div>
  );
}
