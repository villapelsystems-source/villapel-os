import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/LanguageContext';
import { Instagram, Users } from 'lucide-react';

function Tab({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active ? 'border-accent text-white' : 'border-transparent text-white/40 hover:text-white/60'
      }`}
    >
      <Icon size={16} /> {label}
    </button>
  );
}

export default function OutreachPage() {
  const { t } = useLanguage();
  const [tab, setTab] = useState('instagram');
  const [igRecords, setIgRecords] = useState([]);
  const [fbRecords, setFbRecords] = useState([]);

  useEffect(() => {
    api.getInstagram('limit=100').then((d) => setIgRecords(d.records || [])).catch(() => {});
    api.getFacebookGroups('limit=100').then((d) => setFbRecords(d.records || [])).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="font-heading font-bold text-2xl tracking-tight">{t('outreach.title')}</h1>

      <div className="flex border-b border-white/10">
        <Tab active={tab === 'instagram'} onClick={() => setTab('instagram')} icon={Instagram} label={t('outreach.tab.ig')} />
        <Tab active={tab === 'facebook'} onClick={() => setTab('facebook')} icon={Users} label={t('outreach.tab.fb')} />
      </div>

      {tab === 'instagram' && (
        <div className="space-y-2">
          {igRecords.map((r) => (
            <div key={r.id} className="bg-surface border border-white/10 rounded-lg px-4 py-3">
              <div className="flex items-center gap-3">
                <Instagram size={16} className="text-pink-400 shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    {t('outreach.ig.lead')}: {r.lead_id?.slice(0, 8)}...
                  </div>
                  <div className="text-xs text-white/40">
                    {t('outreach.ig.meta')}: {r.account_used} &middot; {t('outreach.ig.follow')}: {r.follow_status} &middot;{' '}
                    {t('outreach.ig.conv')}: {r.conversation_status?.replace('_', ' ')}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs border ${
                    r.conversation_status === 'replied'
                      ? 'text-green-400 border-green-500/20 bg-green-500/10'
                      : 'text-white/40 border-white/10 bg-white/5'
                  }`}
                >
                  {r.conversation_status?.replace('_', ' ')}
                </span>
              </div>
              {r.first_dm_sent && (
                <div className="text-xs text-white/50 mt-2 pl-7">
                  {t('outreach.ig.dm')}: {r.first_dm_sent}
                </div>
              )}
            </div>
          ))}
          {igRecords.length === 0 && <div className="text-center text-white/40 text-sm py-8">{t('outreach.ig.empty')}</div>}
        </div>
      )}

      {tab === 'facebook' && (
        <div className="space-y-2">
          {fbRecords.map((r) => (
            <div key={r.id} className="bg-surface border border-white/10 rounded-lg px-4 py-3">
              <div className="flex items-center gap-3">
                <Users size={16} className="text-blue-400 shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{r.group_name}</div>
                  <div className="text-xs text-white/40">
                    {t('outreach.fb.type')}: {r.post_type} &middot; {t('outreach.fb.engaged')}: {r.people_engaged?.length || 0}{' '}
                    &middot; {t('outreach.fb.captured')}: {r.lead_captured ? t('outreach.fb.yes') : t('outreach.fb.no')}
                  </div>
                </div>
              </div>
              {r.comment_made && <div className="text-xs text-white/50 mt-2 pl-7">{r.comment_made}</div>}
            </div>
          ))}
          {fbRecords.length === 0 && <div className="text-center text-white/40 text-sm py-8">{t('outreach.fb.empty')}</div>}
        </div>
      )}
    </div>
  );
}
