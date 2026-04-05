import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/LanguageContext';
import { Key, Plus, Trash2, Copy, RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const ENDPOINT_DEFS = [
  { method: 'POST', path: '/api/external/leads/intake', descKey: 'integrations.ep.leadsIntake' },
  { method: 'PATCH', path: '/api/external/leads/update', descKey: 'integrations.ep.leadsUpdate' },
  { method: 'POST', path: '/api/external/tasks/create', descKey: 'integrations.ep.tasksCreate' },
  { method: 'POST', path: '/api/external/bookings/create-or-update', descKey: 'integrations.ep.bookings' },
  { method: 'POST', path: '/api/external/calls/log', descKey: 'integrations.ep.callsLog' },
];

function Tab({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${active ? 'border-accent text-white' : 'border-transparent text-white/40 hover:text-white/60'}`}
    >
      {label}
    </button>
  );
}

const VAPI_FIELD_KEYS = [
  'integrations.vapi.field.phone',
  'integrations.vapi.field.vapi_call_id',
  'integrations.vapi.field.direction',
  'integrations.vapi.field.call_date',
  'integrations.vapi.field.duration',
  'integrations.vapi.field.transcript',
  'integrations.vapi.field.recording',
  'integrations.vapi.field.qualified',
];

export default function IntegrationsPage() {
  const { t } = useLanguage();
  const [tab, setTab] = useState('keys');
  const [keys, setKeys] = useState([]);
  const [logs, setLogs] = useState([]);
  const [newKey, setNewKey] = useState(null);
  const [keyName, setKeyName] = useState('');
  const [copied, setCopied] = useState(null);

  const endpoints = useMemo(
    () => ENDPOINT_DEFS.map((ep) => ({ ...ep, desc: t(ep.descKey) })),
    [t]
  );

  useEffect(() => {
    api.getApiKeys().then((d) => setKeys(d.api_keys || [])).catch(() => {});
    api.getIntegrationLogs().then((d) => setLogs(d.logs || [])).catch(() => {});
  }, []);

  const createKey = async () => {
    if (!keyName.trim()) return;
    const data = await api.createApiKey({ name: keyName });
    setNewKey(data);
    setKeyName('');
    api.getApiKeys().then((d) => setKeys(d.api_keys || []));
  };

  const revokeKey = async (id) => {
    if (!window.confirm(t('integrations.revokeConfirm'))) return;
    await api.revokeApiKey(id);
    api.getApiKeys().then((d) => setKeys(d.api_keys || []));
  };

  const copyText = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const refreshLogs = async () => {
    const d = await api.getIntegrationLogs();
    setLogs(d.logs || []);
  };

  return (
    <div className="space-y-4">
      <h1 className="font-heading font-bold text-2xl tracking-tight">{t('integrations.title')}</h1>

      <div className="flex flex-wrap border-b border-white/10 gap-1">
        <Tab active={tab === 'keys'} onClick={() => setTab('keys')} label={t('integrations.tab.keys')} />
        <Tab active={tab === 'vapi'} onClick={() => setTab('vapi')} label={t('integrations.tab.vapi')} />
        <Tab active={tab === 'endpoints'} onClick={() => setTab('endpoints')} label={t('integrations.tab.endpoints')} />
        <Tab active={tab === 'logs'} onClick={() => setTab('logs')} label={t('integrations.tab.logs')} />
      </div>

      {tab === 'keys' && (
        <div className="space-y-4">
          {newKey && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium mb-2">
                <AlertTriangle size={16} /> {t('integrations.keySave')}
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-black/30 rounded px-3 py-2 text-sm text-green-400 font-mono break-all">{newKey.key}</code>
                <button type="button" onClick={() => copyText('new', newKey.key)} className="p-2 rounded hover:bg-white/10 text-white/60">
                  <Copy size={16} />
                </button>
              </div>
              {copied === 'new' && <div className="text-xs text-green-400 mt-1">{t('integrations.copied')}</div>}
              <button type="button" onClick={() => setNewKey(null)} className="text-xs text-white/40 hover:text-white mt-2">
                {t('integrations.dismiss')}
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder={t('integrations.keyPlaceholder')}
              className="flex-1 bg-surface border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/40"
            />
            <button
              type="button"
              onClick={createKey}
              className="flex items-center gap-2 bg-accent text-white hover:bg-accent-hover rounded-md px-3 py-2 text-sm font-medium"
            >
              <Plus size={16} /> {t('integrations.createKey')}
            </button>
          </div>

          <div className="space-y-2">
            {keys.map((k) => (
              <div key={k.id} className="bg-surface border border-white/10 rounded-lg px-4 py-3 flex items-center gap-3">
                <Key size={16} className="text-accent shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{k.name}</div>
                  <div className="text-xs text-white/40">
                    {k.key_preview} &middot; {k.is_active ? t('integrations.active') : t('integrations.revoked')} &middot; {t('integrations.perms')}:{' '}
                    {k.permissions?.join(', ')}
                  </div>
                  {k.last_used_at && (
                    <div className="text-xs text-white/30">
                      {t('integrations.lastUsed')}: {new Date(k.last_used_at).toLocaleString()}
                    </div>
                  )}
                </div>
                {k.is_active && (
                  <button type="button" onClick={() => revokeKey(k.id)} className="p-2 rounded hover:bg-red-500/10 text-red-400">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
            {keys.length === 0 && <div className="text-center text-white/40 text-sm py-4">{t('integrations.noKeys')}</div>}
          </div>
        </div>
      )}

      {tab === 'vapi' && (
        <div className="space-y-4">
          <div className="bg-surface border border-white/10 rounded-lg p-5 space-y-4">
            <h2 className="font-heading font-semibold text-lg text-white">{t('integrations.vapi.title')}</h2>
            <p className="text-sm text-white/70 leading-relaxed">{t('integrations.vapi.intro')}</p>
            <a
              href="https://vapi.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-accent hover:text-accent-hover text-sm font-medium"
            >
              {t('integrations.vapi.linkCta')}
              <ExternalLink size={14} />
            </a>
            <div className="border-t border-white/10 pt-4 space-y-2">
              <h3 className="text-sm font-semibold text-white">{t('integrations.vapi.callsHeading')}</h3>
              <p className="text-xs text-white/50 leading-relaxed">{t('integrations.vapi.callsBody')}</p>
              <p className="text-xs font-medium text-white/60 pt-2">{t('integrations.vapi.fields')}</p>
              <ul className="text-xs text-white/45 list-disc pl-5 space-y-1">
                {VAPI_FIELD_KEYS.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {tab === 'endpoints' && (
        <div className="space-y-3">
          <p className="text-xs text-white/40">
            {t('integrations.webhookIntro')} <code className="bg-white/10 px-1 rounded">x-api-key</code>.
          </p>
          {endpoints.map((ep) => (
            <div key={ep.path} className="bg-surface border border-white/10 rounded-lg px-4 py-3 flex items-center gap-3">
              <span
                className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                  ep.method === 'GET' ? 'bg-green-500/10 text-green-400' : ep.method === 'PATCH' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-blue-500/10 text-blue-400'
                }`}
              >
                {ep.method}
              </span>
              <div className="flex-1 min-w-0">
                <code className="text-sm text-white/80 break-all">{API_URL}
                  {ep.path}
                </code>
                <div className="text-xs text-white/40 mt-0.5">{ep.desc}</div>
              </div>
              <button
                type="button"
                onClick={() => copyText(ep.path, `${API_URL}${ep.path}`)}
                className="p-2 rounded hover:bg-white/10 text-white/40 hover:text-white shrink-0"
              >
                <Copy size={14} />
              </button>
              {copied === ep.path && <span className="text-xs text-green-400 shrink-0">{t('integrations.copied')}</span>}
            </div>
          ))}
        </div>
      )}

      {tab === 'logs' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button type="button" onClick={refreshLogs} className="flex items-center gap-2 text-xs text-white/40 hover:text-white">
              <RefreshCw size={14} /> {t('integrations.logs.refresh')}
            </button>
          </div>
          <div className="w-full overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full">
              <thead className="bg-surface border-b border-white/10">
                <tr>
                  {[t('integrations.logs.colTime'), t('integrations.logs.colEndpoint'), t('integrations.logs.colSource'), t('integrations.logs.colStatus'), t('integrations.logs.colSummary')].map((h, i) => (
                    <th key={i} className="px-3 py-2 text-xs uppercase tracking-wider text-white/60 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-white/5">
                    <td className="px-3 py-2 text-xs text-white/40 whitespace-nowrap">{new Date(l.timestamp).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs font-mono text-white/60">{l.endpoint}</td>
                    <td className="px-3 py-2 text-xs text-white/60">{l.source}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs ${l.success ? 'text-green-400' : 'text-red-400'}`}>{l.response_code}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-white/50 max-w-[300px] truncate">{l.summary}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-white/40 text-sm py-4">
                      {t('integrations.logs.empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
