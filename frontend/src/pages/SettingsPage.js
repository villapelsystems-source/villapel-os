import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';

export default function SettingsPage() {
  const { user } = useAuth();
  const [statuses, setStatuses] = useState([]);

  useEffect(() => {
    api.getStatuses().then(d => setStatuses(d.statuses || [])).catch(() => {});
  }, []);

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="font-heading font-bold text-2xl tracking-tight">Settings</h1>

      <div className="bg-surface border border-white/10 rounded-lg p-5">
        <h3 className="font-heading font-semibold text-sm mb-4">User Profile</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-white/60">Name</div>
            <div className="text-sm mt-1">{user?.name || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-white/60">Email</div>
            <div className="text-sm mt-1">{user?.email || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-white/60">Role</div>
            <div className="text-sm mt-1 capitalize">{user?.role || '—'}</div>
          </div>
        </div>
      </div>

      <div className="bg-surface border border-white/10 rounded-lg p-5">
        <h3 className="font-heading font-semibold text-sm mb-4">Lead Status Configuration</h3>
        <div className="flex flex-wrap gap-2">
          {statuses.map(s => (
            <span key={s} className="px-3 py-1 rounded-full text-xs font-medium bg-accent/10 text-accent border border-accent/20">{s}</span>
          ))}
          {statuses.length === 0 && <span className="text-xs text-white/40">Loading statuses...</span>}
        </div>
      </div>
    </div>
  );
}
