import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { Calendar, Plus } from 'lucide-react';

const STATUS_STYLE = {
  scheduled: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  completed: 'bg-green-500/10 text-green-400 border-green-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
  no_show: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
};

export default function BookingsPage() {
  const [bookings, setBookings] = useState([]);
  const [filter, setFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ lead_id: '', booking_date: '', source: 'manual' });

  const load = useCallback(async () => {
    const params = filter ? `meeting_status=${filter}` : '';
    const data = await api.getBookings(params);
    setBookings(data.bookings || []);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    await api.createBooking({ ...form, booking_date: new Date(form.booking_date).toISOString(), meeting_status: 'scheduled' });
    setShowCreate(false);
    setForm({ lead_id: '', booking_date: '', source: 'manual' });
    load();
  };

  const updateStatus = async (id, meeting_status) => {
    await api.updateBooking(id, { meeting_status });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-heading font-bold text-2xl tracking-tight">Bookings</h1>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-accent text-white hover:bg-accent-hover rounded-md px-3 py-2 text-sm font-medium"><Plus size={16} /> New Booking</button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['', 'scheduled', 'completed', 'cancelled'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filter === f ? 'bg-accent text-white border-accent' : 'bg-white/5 text-white/60 border-white/10 hover:text-white'}`}>
            {f || 'All'}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {bookings.map(b => (
          <div key={b.id} className="bg-surface border border-white/10 rounded-lg px-4 py-3 flex items-center gap-4">
            <Calendar size={18} className="text-accent shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{new Date(b.booking_date).toLocaleString()}</div>
              <div className="text-xs text-white/40 mt-0.5">Lead: {b.lead_id?.slice(0, 8)}... &middot; Source: {b.source || b.booking_source || '—'}</div>
              {b.notes && <div className="text-xs text-white/50 mt-1">{b.notes}</div>}
            </div>
            <select value={b.meeting_status} onChange={e => updateStatus(b.id, e.target.value)}
              className="bg-[#121214] border border-white/10 rounded-md px-2 py-1 text-xs text-white">
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="no_show">No Show</option>
            </select>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[b.meeting_status] || STATUS_STYLE.scheduled}`}>{b.meeting_status}</span>
          </div>
        ))}
        {bookings.length === 0 && <div className="text-center text-white/40 text-sm py-8">No bookings found</div>}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} onClick={e => e.stopPropagation()} className="bg-surface border border-white/10 rounded-lg p-6 w-full max-w-md space-y-3">
            <h2 className="font-heading font-semibold text-lg">New Booking</h2>
            <input value={form.lead_id} onChange={e => setForm({ ...form, lead_id: e.target.value })} placeholder="Lead ID" required
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white" />
            <input type="datetime-local" value={form.booking_date} onChange={e => setForm({ ...form, booking_date: e.target.value })} required
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white" />
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
