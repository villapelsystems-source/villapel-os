import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Users, MessageSquare, Calendar, Trophy, Phone, AlertTriangle } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#84CC16'];

function KPI({ icon: Icon, label, value, sub, testId }) {
  return (
    <div className="bg-surface border border-white/10 rounded-lg p-5" data-testid={testId}>
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-md bg-accent/10"><Icon size={18} className="text-accent" /></div>
        <span className="text-xs text-white/60 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-2xl font-heading font-bold">{value}</div>
      {sub && <div className="text-xs text-white/40 mt-1">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const [m, setM] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.metrics().then(setM).catch(e => setErr(e.message));
  }, []);

  if (err) return <div className="text-red-400">{err}</div>;
  if (!m) return <div className="text-white/40">Loading dashboard...</div>;

  const statusData = Object.entries(m.status_counts || {}).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  const platformData = Object.entries(m.platform_breakdown || {}).filter(([, v]) => v > 0).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1).replace('_', ' '), value }));

  return (
    <div className="space-y-6">
      <h1 className="font-heading font-bold text-2xl tracking-tight">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <KPI icon={Users} label="Total Leads" value={m.leads?.total || 0} sub={`${m.leads?.new_today || 0} new today`} testId="metric-card-leads" />
        <KPI icon={MessageSquare} label="Replied" value={m.leads?.replied || 0} testId="metric-card-replied" />
        <KPI icon={Calendar} label="Booked Demos" value={m.leads?.booked || 0} testId="metric-card-booked" />
        <KPI icon={Trophy} label="Closed Won" value={m.leads?.closed_won || 0} testId="metric-card-won" />
        <KPI icon={Phone} label="Calls Made" value={m.calls?.total || 0} testId="metric-card-calls" />
        <KPI icon={AlertTriangle} label="Tasks Overdue" value={m.tasks?.overdue || 0} sub={`${m.tasks?.due_today || 0} due today`} testId="metric-card-overdue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Status Distribution */}
        <div className="lg:col-span-2 bg-surface border border-white/10 rounded-lg p-5">
          <h3 className="font-heading font-semibold text-sm mb-4">Lead Status Distribution</h3>
          {statusData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={statusData}>
                <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} angle={-30} textAnchor="end" height={80} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#121214', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' }} />
                <Bar dataKey="value" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="text-white/40 text-sm">No data</div>}
        </div>

        {/* Platform Breakdown */}
        <div className="bg-surface border border-white/10 rounded-lg p-5">
          <h3 className="font-heading font-semibold text-sm mb-4">Platform Breakdown</h3>
          {platformData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={platformData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {platformData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#121214', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="text-white/40 text-sm">No data</div>}
        </div>
      </div>

      {/* Conversion Rates */}
      <div className="bg-surface border border-white/10 rounded-lg p-5">
        <h3 className="font-heading font-semibold text-sm mb-4">Conversion Rates</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Contacted → Replied', val: m.conversion_rates?.contacted_to_replied },
            { label: 'Replied → Interested', val: m.conversion_rates?.replied_to_interested },
            { label: 'Interested → Booked', val: m.conversion_rates?.interested_to_booked },
            { label: 'Booked → Closed', val: m.conversion_rates?.booked_to_closed },
          ].map((r) => (
            <div key={r.label} className="text-center">
              <div className="text-xl font-heading font-bold text-accent">{r.val ?? 0}%</div>
              <div className="text-xs text-white/40 mt-1">{r.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
