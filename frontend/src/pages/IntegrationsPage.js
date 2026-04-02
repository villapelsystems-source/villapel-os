import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Key, Plus, Trash2, Copy, RefreshCw, AlertTriangle } from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

const ENDPOINTS = [
  { method: 'POST', path: '/api/leads/intake', desc: 'Create or update lead (dedup by phone/instagram/facebook)' },
  { method: 'GET', path: '/api/leads/search', desc: 'Search lead by phone, instagram_handle, or facebook_page' },
  { method: 'PATCH', path: '/api/leads/{lead_id}', desc: 'Update lead fields' },
  { method: 'POST', path: '/api/tasks/create', desc: 'Create follow-up task' },
  { method: 'POST', path: '/api/bookings/create-or-update', desc: 'Create or update booking' },
];

function Tab({ active, onClick, label }) {
  return (
    <button onClick={onClick} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${active ? 'border-accent text-white' : 'border-transparent text-white/40 hover:text-white/60'}`}>
      {label}
    </button>
  );
}

export default function IntegrationsPage() {
  const [tab, setTab] = useState('keys');
  const [keys, setKeys] = useState([]);
  const [logs, setLogs] = useState([]);
  const [newKey, setNewKey] = useState(null);
  const [keyName, setKeyName] = useState('');
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    api.getApiKeys().then(d => setKeys(d.api_keys || [])).catch(() => {});
    api.getIntegrationLogs().then(d => setLogs(d.logs || [])).catch(() => {});
  }, []);

  const createKey = async () => {
    if (!keyName.trim()) return;
    const data = await api.createApiKey({ name: keyName });
    setNewKey(data);
    setKeyName('');
    api.getApiKeys().then(d => setKeys(d.api_keys || []));
  };

  const revokeKey = async (id) => {
    if (!window.confirm('Revoke this API key?')) return;
    await api.revokeApiKey(id);
    api.getApiKeys().then(d => setKeys(d.api_keys || []));
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
      <h1 className="font-heading font-bold text-2xl tracking-tight">Integrations</h1>

      <div className="flex border-b border-white/10">
        <Tab active={tab === 'keys'} onClick={() => setTab('keys')} label="API Keys" />
        <Tab active={tab === 'endpoints'} onClick={() => setTab('endpoints')} label="Webhook Endpoints" />
        <Tab active={tab === 'logs'} onClick={() => setTab('logs')} label="Integration Logs" />
      </div>

      {tab === 'keys' && (
        <div className="space-y-4">
          {newKey && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
              <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium mb-2"><AlertTriangle size={16} /> Save this key now - it won't be shown again!</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-black/30 rounded px-3 py-2 text-sm text-green-400 font-mono break-all">{newKey.key}</code>
                <button onClick={() => copyText('new', newKey.key)} className="p-2 rounded hover:bg-white/10 text-white/60"><Copy size={16} /></button>
              </div>
              {copied === 'new' && <div className="text-xs text-green-400 mt-1">Copied!</div>}
              <button onClick={() => setNewKey(null)} className="text-xs text-white/40 hover:text-white mt-2">Dismiss</button>
            </div>
          )}

          <div className="flex gap-2">
            <input value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="Key name (e.g., Make.com)"
              className="flex-1 bg-surface border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/40" />
            <button onClick={createKey} className="flex items-center gap-2 bg-accent text-white hover:bg-accent-hover rounded-md px-3 py-2 text-sm font-medium"><Plus size={16} /> Create Key</button>
          </div>

          <div className="space-y-2">
            {keys.map(k => (
              <div key={k.id} className="bg-surface border border-white/10 rounded-lg px-4 py-3 flex items-center gap-3">
                <Key size={16} className="text-accent shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{k.name}</div>
                  <div className="text-xs text-white/40">{k.key_preview} &middot; {k.is_active ? 'Active' : 'Revoked'} &middot; Perms: {k.permissions?.join(', ')}</div>
                  {k.last_used_at && <div className="text-xs text-white/30">Last used: {new Date(k.last_used_at).toLocaleString()}</div>}
                </div>
                {k.is_active && (
                  <button onClick={() => revokeKey(k.id)} className="p-2 rounded hover:bg-red-500/10 text-red-400"><Trash2 size={16} /></button>
                )}
              </div>
            ))}
            {keys.length === 0 && <div className="text-center text-white/40 text-sm py-4">No API keys created yet</div>}
          </div>
        </div>
      )}

      {tab === 'endpoints' && (
        <div className="space-y-3">
          <p className="text-xs text-white/40">These are the webhook endpoints your Make.com automations should call. All require the <code className="bg-white/10 px-1 rounded">x-api-key</code> header.</p>
          {ENDPOINTS.map((ep) => (
            <div key={ep.path} className="bg-surface border border-white/10 rounded-lg px-4 py-3 flex items-center gap-3">
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${ep.method === 'GET' ? 'bg-green-500/10 text-green-400' : ep.method === 'PATCH' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-blue-500/10 text-blue-400'}`}>{ep.method}</span>
              <div className="flex-1">
                <code className="text-sm text-white/80">{API_URL}{ep.path}</code>
                <div className="text-xs text-white/40 mt-0.5">{ep.desc}</div>
              </div>
              <button onClick={() => copyText(ep.path, `${API_URL}${ep.path}`)} className="p-2 rounded hover:bg-white/10 text-white/40 hover:text-white">
                <Copy size={14} />
              </button>
              {copied === ep.path && <span className="text-xs text-green-400">Copied!</span>}
            </div>
          ))}
        </div>
      )}

      {tab === 'logs' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={refreshLogs} className="flex items-center gap-2 text-xs text-white/40 hover:text-white"><RefreshCw size={14} /> Refresh</button>
          </div>
          <div className="w-full overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full">
              <thead className="bg-surface border-b border-white/10">
                <tr>
                  {['Time', 'Endpoint', 'Source', 'Status', 'Summary'].map(h => (
                    <th key={h} className="px-3 py-2 text-xs uppercase tracking-wider text-white/60 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} className="border-b border-white/5">
                    <td className="px-3 py-2 text-xs text-white/40 whitespace-nowrap">{new Date(l.timestamp).toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs font-mono text-white/60">{l.endpoint}</td>
                    <td className="px-3 py-2 text-xs text-white/60">{l.source}</td>
                    <td className="px-3 py-2"><span className={`text-xs ${l.success ? 'text-green-400' : 'text-red-400'}`}>{l.response_code}</span></td>
                    <td className="px-3 py-2 text-xs text-white/50 max-w-[300px] truncate">{l.summary}</td>
                  </tr>
                ))}
                {logs.length === 0 && <tr><td colSpan={5} className="text-center text-white/40 text-sm py-4">No logs yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
