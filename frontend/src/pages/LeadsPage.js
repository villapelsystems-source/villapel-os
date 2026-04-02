import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

const STATUS_COLORS = {
  'New Lead': 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'Contacted': 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  'Replied': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'Interested': 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  'Qualified': 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  'Booked': 'bg-green-500/10 text-green-400 border-green-500/20',
  'No Response': 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  'Not Interested': 'bg-red-500/10 text-red-400 border-red-500/20',
  'Closed Won': 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  'Closed Lost': 'bg-red-500/10 text-red-300 border-red-500/20',
};

function Badge({ status }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[status] || 'bg-white/5 text-white/60 border-white/10'}`}>{status}</span>;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ company_name: '', contact_name: '', phone: '', email: '', city: '', state: '', source_platform: 'Instagram', status: 'New Lead', priority: 'medium' });
  const navigate = useNavigate();
  const limit = 25;

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (platformFilter) params.set('source_platform', platformFilter);
    params.set('skip', page * limit);
    params.set('limit', limit);
    try {
      const data = await api.getLeads(params.toString());
      setLeads(data.leads || []);
      setTotal(data.total || 0);
    } catch {}
  }, [search, statusFilter, platformFilter, page]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.createLead(form);
      setShowCreate(false);
      setForm({ company_name: '', contact_name: '', phone: '', email: '', city: '', state: '', source_platform: 'Instagram', status: 'New Lead', priority: 'medium' });
      load();
    } catch {}
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-heading font-bold text-2xl tracking-tight">CRM / Leads</h1>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-accent text-white hover:bg-accent-hover rounded-md px-3 py-2 text-sm font-medium transition-all">
          <Plus size={16} /> Add Lead
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search leads..."
            className="w-full bg-surface border border-white/10 rounded-md pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-accent focus:ring-1 focus:ring-accent transition-colors" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="bg-surface border border-white/10 rounded-md px-3 py-2 text-sm text-white/80">
          <option value="">All Statuses</option>
          {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={platformFilter} onChange={(e) => { setPlatformFilter(e.target.value); setPage(0); }}
          className="bg-surface border border-white/10 rounded-md px-3 py-2 text-sm text-white/80">
          <option value="">All Platforms</option>
          <option value="Instagram">Instagram</option>
          <option value="Facebook Groups">Facebook Groups</option>
          <option value="Phone">Phone</option>
          <option value="Website">Website</option>
          <option value="Referral">Referral</option>
        </select>
      </div>

      {/* Table */}
      <div className="w-full overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full">
          <thead className="bg-surface border-b border-white/10">
            <tr>
              {['Company', 'Contact', 'Phone', 'Platform', 'Status', 'Priority', 'City'].map(h => (
                <th key={h} className="px-4 py-3 text-xs uppercase tracking-wider text-white/60 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} onClick={() => navigate(`/leads/${l.id}`)} className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer">
                <td className="px-4 py-3 text-sm font-medium">{l.company_name}</td>
                <td className="px-4 py-3 text-sm text-white/80">{l.contact_name || '—'}</td>
                <td className="px-4 py-3 text-sm text-white/60">{l.phone || '—'}</td>
                <td className="px-4 py-3 text-sm text-white/60">{l.source_platform}</td>
                <td className="px-4 py-3"><Badge status={l.status} /></td>
                <td className="px-4 py-3 text-sm text-white/60 capitalize">{l.priority}</td>
                <td className="px-4 py-3 text-sm text-white/60">{l.city ? `${l.city}, ${l.state || ''}` : '—'}</td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-white/40 text-sm">No leads found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-white/60">
        <span>{total} lead{total !== 1 ? 's' : ''}</span>
        <div className="flex gap-2">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-1 rounded hover:bg-white/10 disabled:opacity-30"><ChevronLeft size={18} /></button>
          <span className="px-2 py-1">Page {page + 1} of {Math.max(1, Math.ceil(total / limit))}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * limit >= total} className="p-1 rounded hover:bg-white/10 disabled:opacity-30"><ChevronRight size={18} /></button>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} onClick={e => e.stopPropagation()} className="bg-surface border border-white/10 rounded-lg p-6 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto">
            <h2 className="font-heading font-semibold text-lg">New Lead</h2>
            {['company_name', 'contact_name', 'phone', 'email', 'city', 'state'].map(f => (
              <div key={f}>
                <label className="text-xs text-white/60 capitalize">{f.replace('_', ' ')}</label>
                <input value={form[f]} onChange={e => setForm({ ...form, [f]: e.target.value })} required={f === 'company_name'}
                  className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white mt-1" />
              </div>
            ))}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="flex-1 bg-white/5 border border-white/10 text-white rounded-md px-4 py-2 text-sm">Cancel</button>
              <button type="submit" className="flex-1 bg-accent text-white hover:bg-accent-hover rounded-md px-4 py-2 text-sm font-medium">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
