import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/LanguageContext';
import { Plus, Check, Circle } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import DeleteIconButton from '../components/DeleteIconButton';
import { useToast } from '../lib/ToastContext';

const FILTERS = ['all', 'overdue', 'today', 'upcoming', 'completed', 'pending'];

export default function TasksPage() {
  const { t } = useLanguage();
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    lead_id: '',
    task_type: 'send_follow_up',
    title: '',
    description: '',
    due_date: '',
    priority: 'medium',
  });
  const [confirmTask, setConfirmTask] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter === 'completed') params.set('completed', 'true');
    else if (filter === 'pending') params.set('completed', 'false');
    params.set('limit', '100');
    const data = await api.getTasks(params.toString());
    setTasks(data.tasks || []);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (row) => {
    await api.updateTask(row.id, { completed: !row.completed });
    load();
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    await api.createTask({
      ...form,
      due_date: form.due_date ? new Date(form.due_date).toISOString() : new Date(Date.now() + 86400000).toISOString(),
    });
    setShowCreate(false);
    setForm({
      lead_id: '',
      task_type: 'send_follow_up',
      title: '',
      description: '',
      due_date: '',
      priority: 'medium',
    });
    load();
  };

  const confirmDeleteTask = async () => {
    if (!confirmTask) return;
    setDeleting(true);
    try {
      await api.deleteTask(confirmTask.id);
      setTasks((prev) => prev.filter((x) => x.id !== confirmTask.id));
      setConfirmTask(null);
      showToast(t('tasks.deletedOk'));
    } catch (e) {
      showToast(e.message || t('tasks.deleteErr'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const now = new Date();
  const categorize = (row) => {
    if (row.completed) return 'completed';
    const due = new Date(row.due_date);
    if (due < now && due.toDateString() !== now.toDateString()) return 'overdue';
    if (due.toDateString() === now.toDateString()) return 'today';
    return 'upcoming';
  };

  const filtered =
    filter === 'all'
      ? tasks
      : tasks.filter((row) => {
          if (filter === 'completed') return row.completed;
          if (filter === 'pending') return !row.completed;
          return categorize(row) === filter;
        });

  const priorityColor = { high: 'text-red-400', medium: 'text-yellow-400', low: 'text-green-400' };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-heading font-bold text-2xl tracking-tight">{t('tasks.title')}</h1>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-accent text-white hover:bg-accent-hover rounded-md px-3 py-2 text-sm font-medium"
        >
          <Plus size={16} /> {t('tasks.new')}
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              filter === f ? 'bg-accent text-white border-accent' : 'bg-white/5 text-white/60 border-white/10 hover:text-white'
            }`}
          >
            {t(`tasks.filter.${f}`)}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((row) => (
          <div
            key={row.id}
            className="group bg-surface border border-white/10 rounded-lg px-4 py-3 flex items-start gap-3 hover:bg-white/5 transition-colors"
          >
            <button type="button" onClick={() => toggle(row)} className="mt-0.5">
              {row.completed ? <Check size={18} className="text-green-400" /> : <Circle size={18} className="text-white/30" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-medium ${row.completed ? 'line-through text-white/40' : ''}`}>{row.title}</div>
              {row.description && <div className="text-xs text-white/40 mt-0.5">{row.description}</div>}
              <div className="flex gap-3 mt-1 text-xs text-white/40">
                <span className={priorityColor[row.priority]}>{row.priority}</span>
                <span>{row.task_type?.replace(/_/g, ' ')}</span>
                <span>
                  {t('tasks.due')}: {new Date(row.due_date).toLocaleDateString()}
                </span>
                {row.auto_generated && <span className="text-accent">{t('tasks.auto')}</span>}
              </div>
            </div>
            <DeleteIconButton label={t('tasks.deleteLabel')} className="mt-0.5" onClick={() => setConfirmTask(row)} />
          </div>
        ))}
        {filtered.length === 0 && <div className="text-center text-white/40 text-sm py-8">{t('tasks.empty')}</div>}
      </div>

      <ConfirmModal
        open={!!confirmTask}
        title={t('tasks.deleteTitle')}
        message={confirmTask ? t('tasks.deleteMsg', { title: confirmTask.title }) : ''}
        confirmLabel={t('common.delete')}
        loading={deleting}
        onCancel={() => !deleting && setConfirmTask(null)}
        onConfirm={confirmDeleteTask}
      />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <form
            onSubmit={handleCreate}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface border border-white/10 rounded-lg p-6 w-full max-w-md space-y-3"
          >
            <h2 className="font-heading font-semibold text-lg">{t('tasks.modalTitle')}</h2>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t('tasks.ph.title')}
              required
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white"
            />
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t('tasks.ph.description')}
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white"
            />
            <input
              value={form.lead_id}
              onChange={(e) => setForm({ ...form, lead_id: e.target.value })}
              placeholder={t('tasks.ph.leadId')}
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white"
            />
            <input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white"
            />
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white"
            >
              <option value="low">{t('tasks.prio.low')}</option>
              <option value="medium">{t('tasks.prio.medium')}</option>
              <option value="high">{t('tasks.prio.high')}</option>
            </select>
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
