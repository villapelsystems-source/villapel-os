import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { Plus, Check, Circle } from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import DeleteIconButton from '../components/DeleteIconButton';
import { useToast } from '../lib/ToastContext';

export default function TasksPage() {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ lead_id: '', task_type: 'send_follow_up', title: '', description: '', due_date: '', priority: 'medium' });
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

  useEffect(() => { load(); }, [load]);

  const toggle = async (t) => {
    await api.updateTask(t.id, { completed: !t.completed });
    load();
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    await api.createTask({ ...form, due_date: form.due_date ? new Date(form.due_date).toISOString() : new Date(Date.now() + 86400000).toISOString() });
    setShowCreate(false);
    setForm({ lead_id: '', task_type: 'send_follow_up', title: '', description: '', due_date: '', priority: 'medium' });
    load();
  };

  const confirmDeleteTask = async () => {
    if (!confirmTask) return;
    setDeleting(true);
    try {
      await api.deleteTask(confirmTask.id);
      setTasks((prev) => prev.filter((x) => x.id !== confirmTask.id));
      setConfirmTask(null);
      showToast('Tarea eliminada');
    } catch (e) {
      showToast(e.message || 'No se pudo eliminar la tarea', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const now = new Date();
  const categorize = (t) => {
    if (t.completed) return 'completed';
    const due = new Date(t.due_date);
    if (due < now && due.toDateString() !== now.toDateString()) return 'overdue';
    if (due.toDateString() === now.toDateString()) return 'today';
    return 'upcoming';
  };

  const filtered = filter === 'all' ? tasks : tasks.filter(t => {
    if (filter === 'completed') return t.completed;
    if (filter === 'pending') return !t.completed;
    return categorize(t) === filter;
  });

  const priorityColor = { high: 'text-red-400', medium: 'text-yellow-400', low: 'text-green-400' };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-heading font-bold text-2xl tracking-tight">Tasks</h1>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-accent text-white hover:bg-accent-hover rounded-md px-3 py-2 text-sm font-medium"><Plus size={16} /> New Task</button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['all', 'overdue', 'today', 'upcoming', 'completed'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filter === f ? 'bg-accent text-white border-accent' : 'bg-white/5 text-white/60 border-white/10 hover:text-white'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map(t => (
          <div key={t.id} className="group bg-surface border border-white/10 rounded-lg px-4 py-3 flex items-start gap-3 hover:bg-white/5 transition-colors">
            <button type="button" onClick={() => toggle(t)} className="mt-0.5">
              {t.completed ? <Check size={18} className="text-green-400" /> : <Circle size={18} className="text-white/30" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-medium ${t.completed ? 'line-through text-white/40' : ''}`}>{t.title}</div>
              {t.description && <div className="text-xs text-white/40 mt-0.5">{t.description}</div>}
              <div className="flex gap-3 mt-1 text-xs text-white/40">
                <span className={priorityColor[t.priority]}>{t.priority}</span>
                <span>{t.task_type?.replace(/_/g, ' ')}</span>
                <span>Due: {new Date(t.due_date).toLocaleDateString()}</span>
                {t.auto_generated && <span className="text-accent">auto</span>}
              </div>
            </div>
            <DeleteIconButton label="Eliminar tarea" className="mt-0.5" onClick={() => setConfirmTask(t)} />
          </div>
        ))}
        {filtered.length === 0 && <div className="text-center text-white/40 text-sm py-8">No tasks found</div>}
      </div>

      <ConfirmModal
        open={!!confirmTask}
        title="Eliminar tarea"
        message={confirmTask ? `Se eliminará la tarea «${confirmTask.title}». Esta acción no se puede deshacer.` : ''}
        confirmLabel="Eliminar"
        loading={deleting}
        onCancel={() => !deleting && setConfirmTask(null)}
        onConfirm={confirmDeleteTask}
      />

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} onClick={e => e.stopPropagation()} className="bg-surface border border-white/10 rounded-lg p-6 w-full max-w-md space-y-3">
            <h2 className="font-heading font-semibold text-lg">New Task</h2>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Task title" required
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white" />
            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description"
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white" />
            <input value={form.lead_id} onChange={e => setForm({ ...form, lead_id: e.target.value })} placeholder="Lead ID (paste from CRM)"
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white" />
            <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white" />
            <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white">
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
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
