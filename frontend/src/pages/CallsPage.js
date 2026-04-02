import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { Phone } from 'lucide-react';

const OUTCOME_STYLE = {
  answered: 'text-green-400',
  booked: 'text-accent',
  voicemail: 'text-yellow-400',
  no_answer: 'text-white/40',
  callback_requested: 'text-purple-400',
};

export default function CallsPage() {
  const [calls, setCalls] = useState([]);
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [scoreFilter, setScoreFilter] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (outcomeFilter) params.set('outcome', outcomeFilter);
    if (scoreFilter) params.set('score', scoreFilter);
    params.set('limit', '100');
    const data = await api.getCalls(params.toString());
    setCalls(data.calls || []);
  }, [outcomeFilter, scoreFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="font-heading font-bold text-2xl tracking-tight">Calls</h1>

      <div className="flex gap-3 flex-wrap">
        <select value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)}
          className="bg-surface border border-white/10 rounded-md px-3 py-2 text-sm text-white/80">
          <option value="">All Outcomes</option>
          {['answered', 'voicemail', 'no_answer', 'callback_requested', 'booked'].map(o => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
        </select>
        <select value={scoreFilter} onChange={e => setScoreFilter(e.target.value)}
          className="bg-surface border border-white/10 rounded-md px-3 py-2 text-sm text-white/80">
          <option value="">All Scores</option>
          {['good', 'average', 'bad'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="space-y-2">
        {calls.map(c => (
          <div key={c.id} className="bg-surface border border-white/10 rounded-lg px-4 py-3 flex items-center gap-4">
            <Phone size={18} className="text-accent shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{c.company_name || c.caller_phone}</div>
              <div className="text-xs text-white/40 mt-0.5">
                {c.caller_phone} &middot; {new Date(c.call_date).toLocaleString()} &middot; {Math.floor(c.duration_seconds / 60)}m {c.duration_seconds % 60}s
              </div>
              {c.transcript_summary && <div className="text-xs text-white/50 mt-1 line-clamp-2">{c.transcript_summary}</div>}
            </div>
            <span className={`text-xs font-medium capitalize ${OUTCOME_STYLE[c.outcome] || 'text-white/40'}`}>{c.outcome?.replace('_', ' ')}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs border ${c.score === 'good' ? 'text-green-400 border-green-500/20 bg-green-500/10' : c.score === 'bad' ? 'text-red-400 border-red-500/20 bg-red-500/10' : 'text-white/40 border-white/10 bg-white/5'}`}>{c.score}</span>
          </div>
        ))}
        {calls.length === 0 && <div className="text-center text-white/40 text-sm py-8">No calls found</div>}
      </div>
    </div>
  );
}
