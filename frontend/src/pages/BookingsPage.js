import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/LanguageContext';
import { Calendar, Plus } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import DeleteIconButton from '../components/DeleteIconButton';
import { useToast } from '../lib/ToastContext';

const STATUS_STYLE = {
  scheduled: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  completed: 'bg-green-500/10 text-green-400 border-green-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
  no_show: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
};

const FILTERS = ['', 'scheduled', 'completed', 'cancelled'];

export default function BookingsPage() {
  const { t } = useLanguage();
  const [bookings, setBookings] = useState([]);
  const [filter, setFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ lead_id: '', booking_date: '', source: 'manual' });
  const [confirmBooking, setConfirmBooking] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    const params = filter ? `meeting_status=${filter}` : '';
    const data = await api.getBookings(params);
    setBookings(data.bookings || []);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    await api.createBooking({
      ...form,
      booking_date: new Date(form.booking_date).toISOString(),
      meeting_status: 'scheduled',
    });
    setShowCreate(false);
    setForm({ lead_id: '', booking_date: '', source: 'manual' });
    load();
  };

  const updateStatus = async (id, meeting_status) => {
    await api.updateBooking(id, { meeting_status });
    load();
  };

  const confirmDeleteBooking = async () => {
    if (!confirmBooking) return;
    setDeleting(true);
    try {
      await api.deleteBooking(confirmBooking.id);
      setBookings((prev) => prev.filter((b) => b.id !== confirmBooking.id));
      setConfirmBooking(null);
      showToast(t('bookings.deletedOk'));
    } catch (e) {
      showToast(e.message || t('bookings.deleteErr'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-heading font-bold text-2xl tracking-tight">{t('bookings.title')}</h1>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-accent text-white hover:bg-accent-hover rounded-md px-3 py-2 text-sm font-medium"
        >
          <Plus size={16} /> {t('bookings.new')}
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f || 'all'}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              filter === f ? 'bg-accent text-white border-accent' : 'bg-white/5 text-white/60 border-white/10 hover:text-white'
            }`}
          >
            {f ? t(`bookings.filter.${f}`) : t('bookings.filter.all')}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {bookings.map((b) => (
          <div key={b.id} className="group bg-surface border border-white/10 rounded-lg px-4 py-3 flex items-center gap-4">
            <Calendar size={18} className="text-accent shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{new Date(b.booking_date).toLocaleString()}</div>
              <div className="text-xs text-white/40 mt-0.5">
                {t('bookings.leadLine')}: {b.lead_id?.slice(0, 8)}... &middot; {t('bookings.source')}:{' '}
                {b.source || b.booking_source || '—'}
              </div>
              {b.notes && <div className="text-xs text-white/50 mt-1">{b.notes}</div>}
            </div>
            <select
              value={b.meeting_status}
              onChange={(e) => updateStatus(b.id, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#121214] border border-white/10 rounded-md px-2 py-1 text-xs text-white"
            >
              <option value="scheduled">{t('bookings.status.scheduled')}</option>
              <option value="completed">{t('bookings.status.completed')}</option>
              <option value="cancelled">{t('bookings.status.cancelled')}</option>
              <option value="no_show">{t('bookings.status.no_show')}</option>
            </select>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[b.meeting_status] || STATUS_STYLE.scheduled}`}
            >
              {t(`bookings.status.${b.meeting_status}`) || b.meeting_status}
            </span>
            <DeleteIconButton label={t('bookings.deleteLabel')} onClick={() => setConfirmBooking(b)} />
          </div>
        ))}
        {bookings.length === 0 && <div className="text-center text-white/40 text-sm py-8">{t('bookings.empty')}</div>}
      </div>

      <ConfirmModal
        open={!!confirmBooking}
        title={t('bookings.deleteTitle')}
        message={
          confirmBooking ? t('bookings.deleteMsg', { date: new Date(confirmBooking.booking_date).toLocaleString() }) : ''
        }
        confirmLabel={t('common.delete')}
        loading={deleting}
        onCancel={() => !deleting && setConfirmBooking(null)}
        onConfirm={confirmDeleteBooking}
      />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <form
            onSubmit={handleCreate}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface border border-white/10 rounded-lg p-6 w-full max-w-md space-y-3"
          >
            <h2 className="font-heading font-semibold text-lg">{t('bookings.modalTitle')}</h2>
            <input
              value={form.lead_id}
              onChange={(e) => setForm({ ...form, lead_id: e.target.value })}
              placeholder={t('bookings.ph.leadId')}
              required
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white"
            />
            <input
              type="datetime-local"
              value={form.booking_date}
              onChange={(e) => setForm({ ...form, booking_date: e.target.value })}
              required
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white"
            />
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="flex-1 bg-white/5 border border-white/10 text-white rounded-md px-4 py-2 text-sm"
              >
                {t('common.cancel')}
              </button>
              <button type="submit" className="flex-1 bg-accent text-white hover:bg-accent-hover rounded-md px-4 py-2 text-sm font-medium">
                {t('common.create')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
