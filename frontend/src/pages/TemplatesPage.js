import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Copy, Plus, Trash2 } from 'lucide-react';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [catFilter, setCatFilter] = useState('');
  const [platFilter, setPlatFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'first_contact', platform: 'Instagram', content: '', variables: [] });
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (catFilter) params.set('category', catFilter);
    if (platFilter) params.set('platform', platFilter);
    api.getTemplates(params.toString()).then(d => setTemplates(d.templates || [])).catch(() => {});
  }, [catFilter, platFilter]);

  const copyText = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    await api.createTemplate(form);
    setShowCreate(false);
    setForm({ name: '', category: 'first_contact', platform: 'Instagram', content: '', variables: [] });
    const data = await api.getTemplates('');
    setTemplates(data.templates || []);
  };

  const handleDelete = async (id) => {
    await api.deleteTemplate(id);
    setTemplates(t => t.filter(x => x.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-heading font-bold text-2xl tracking-tight">Message Templates</h1>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-accent text-white hover:bg-accent-hover rounded-md px-3 py-2 text-sm font-medium"><Plus size={16} /> New Template</button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="bg-surface border border-white/10 rounded-md px-3 py-2 text-sm text-white/80">
          <option value="">All Categories</option>
          {['first_contact', 'follow_up', 'interested_lead', 'booked_lead', 'reactivation'].map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
        <select value={platFilter} onChange={e => setPlatFilter(e.target.value)} className="bg-surface border border-white/10 rounded-md px-3 py-2 text-sm text-white/80">
          <option value="">All Platforms</option>
          <option value="Instagram">Instagram</option>
          <option value="Facebook Groups">Facebook Groups</option>
        </select>
      </div>

      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
        {templates.map(t => (
          <div key={t.id} className="bg-surface border border-white/10 rounded-lg p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-white/40 mt-0.5">{t.category?.replace('_', ' ')} &middot; {t.platform}</div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => copyText(t.id, t.content)} className="p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white" title="Copy">
                  <Copy size={14} />
                </button>
                <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded hover:bg-red-500/10 text-white/40 hover:text-red-400" title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="text-xs text-white/60 mt-2 whitespace-pre-wrap">{t.content}</div>
            {copied === t.id && <div className="text-xs text-green-400 mt-1">Copied!</div>}
          </div>
        ))}
        {templates.length === 0 && <div className="col-span-2 text-center text-white/40 text-sm py-8">No templates found</div>}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} onClick={e => e.stopPropagation()} className="bg-surface border border-white/10 rounded-lg p-6 w-full max-w-md space-y-3">
            <h2 className="font-heading font-semibold text-lg">New Template</h2>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Template name" required
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white" />
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white">
              {['first_contact', 'follow_up', 'interested_lead', 'booked_lead', 'reactivation'].map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </select>
            <select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white">
              <option value="Instagram">Instagram</option>
              <option value="Facebook Groups">Facebook Groups</option>
            </select>
            <textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} placeholder="Message content" required rows={4}
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-sm text-white resize-none" />
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
