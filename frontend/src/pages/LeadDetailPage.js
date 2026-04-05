import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { leadStatusLabel } from '../lib/i18n';
import { useLanguage } from '../lib/LanguageContext';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import DeleteIconButton from '../components/DeleteIconButton';
import { useToast } from '../lib/ToastContext';

const STATUSES = [
  'New Lead',
  'Contacted',
  'Replied',
  'Interested',
  'Qualified',
  'Booked',
  'No Response',
  'Not Interested',
  'Closed Won',
  'Closed Lost',
];

const DETAIL_FIELDS = [
  'company_name',
  'contact_name',
  'phone',
  'email',
  'city',
  'state',
  'website',
  'instagram_handle',
  'facebook_page',
  'source_platform',
  'priority',
  'assigned_to',
];

export default function LeadDetailPage() {
  const { t } = useLanguage();
  const { id } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [note, setNote] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await api.getLead(id);
      setLead(data);
      setForm(data);
    } catch {
      navigate('/leads');
    }
  }, [id, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    try {
      await api.updateLead(id, form);
      setEditing(false);
      load();
    } catch {}
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteLead(id);
      showToast(t('leadDetail.deletedOk'));
      navigate('/leads');
    } catch (e) {
      showToast(e.message || t('leadDetail.deleteErr'), 'error');
    } finally {
      setDeleting(false);
      setShowDelete(false);
    }
  };

  const handleNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    await api.addNote(id, { content: note });
    setNote('');
    load();
  };

  if (!lead) return <div className="text-white/40">{t('leadDetail.loading')}</div>;

  const Field = ({ field, type = 'text' }) => (
    <div>
      <label className="text-xs text-white/60">{t(`leadDetail.field.${field}`)}</label>
      {editing ? (
        <input
          type={type}
          value={form[field] || ''}
          onChange={(e) => setForm({ ...form, [field]: e.target.value })}
          className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white mt-1"
        />
      ) : (
        <div className="text-sm text-white/80 mt-1">{lead[field] || '—'}</div>
      )}
    </div>
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="group flex items-center gap-3">
        <button type="button" onClick={() => navigate('/leads')} className="p-1 rounded hover:bg-white/10">
          <ArrowLeft size={20} />
        </button>
        <h1 className="font-heading font-bold text-2xl tracking-tight flex-1 min-w-0 truncate">{lead.company_name}</h1>
        <DeleteIconButton label={t('leadDetail.deleteLabel')} onClick={() => setShowDelete(true)} />
      </div>

      <ConfirmModal
        open={showDelete}
        title={t('leadDetail.deleteTitle')}
        message={t('leadDetail.deleteMsg', { name: lead.company_name || '—' })}
        confirmLabel={t('common.delete')}
        loading={deleting}
        onCancel={() => !deleting && setShowDelete(false)}
        onConfirm={handleDelete}
      />

      <div className="flex items-center gap-3">
        <label className="text-xs text-white/60">{t('leadDetail.statusLbl')}:</label>
        <select
          value={form.status || lead.status}
          onChange={async (e) => {
            setForm({ ...form, status: e.target.value });
            await api.updateLead(id, { status: e.target.value });
            load();
          }}
          className="bg-surface border border-white/10 rounded-md px-3 py-1 text-sm text-white"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {leadStatusLabel(t, s)}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-surface border border-white/10 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-semibold text-sm">{t('leadDetail.detailsTitle')}</h3>
          {editing ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setForm(lead);
                }}
                className="text-xs px-3 py-1 rounded bg-white/5 border border-white/10 text-white/60"
              >
                {t('common.cancel')}
              </button>
              <button type="button" onClick={handleSave} className="text-xs px-3 py-1 rounded bg-accent text-white">
                {t('common.save')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs px-3 py-1 rounded bg-white/5 border border-white/10 text-white/60 hover:text-white"
            >
              {t('common.edit')}
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {DETAIL_FIELDS.map((f) => (
            <Field key={f} field={f} type={f === 'email' ? 'email' : 'text'} />
          ))}
        </div>
      </div>

      <div className="bg-surface border border-white/10 rounded-lg p-5">
        <h3 className="font-heading font-semibold text-sm mb-3">{t('leadDetail.notesTitle')}</h3>
        {lead.notes && (
          <pre className="text-sm text-white/70 whitespace-pre-wrap mb-4 font-body">{lead.notes}</pre>
        )}
        <form onSubmit={handleNote} className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('leadDetail.notesPh')}
            className="flex-1 bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder:text-white/40"
          />
          <button type="submit" className="p-2 rounded bg-accent text-white hover:bg-accent-hover">
            <Send size={16} />
          </button>
        </form>
        {lead.notes_history?.length > 0 && (
          <div className="mt-4 space-y-2">
            {lead.notes_history.map((n) => (
              <div key={n.id} className="text-xs text-white/50 border-l-2 border-white/10 pl-3 py-1">
                <span className="text-white/70">{n.content}</span>
                <div className="text-white/30 mt-0.5">
                  {n.created_by} &middot; {new Date(n.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {lead.activity?.length > 0 && (
        <div className="bg-surface border border-white/10 rounded-lg p-5">
          <h3 className="font-heading font-semibold text-sm mb-3">{t('leadDetail.activityTitle')}</h3>
          <div className="space-y-2">
            {lead.activity
              .slice()
              .reverse()
              .map((a) => (
                <div key={a.id} className="text-xs text-white/50 border-l-2 border-accent/30 pl-3 py-1">
                  <span className="text-white/70">{a.action}</span>
                  {a.details && <span className="text-white/40"> — {a.details}</span>}
                  <div className="text-white/30 mt-0.5">{new Date(a.timestamp).toLocaleString()}</div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
