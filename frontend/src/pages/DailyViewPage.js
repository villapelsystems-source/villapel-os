import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useLanguage } from '../lib/LanguageContext';
import { useToast } from '../lib/ToastContext';
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Search,
  LayoutList,
  ArrowUpRight,
} from 'lucide-react';

function toLocalYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDay(ymd, delta) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return toLocalYMD(dt);
}

const KIND_BADGE = {
  lead: 'bg-blue-500/12 text-blue-300 border-blue-500/25',
  call: 'bg-violet-500/12 text-violet-300 border-violet-500/25',
  booking: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25',
  task: 'bg-amber-500/12 text-amber-300 border-amber-500/25',
};

export default function DailyViewPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [selectedDate, setSelectedDate] = useState(() => toLocalYMD(new Date()));
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getDayActivity(selectedDate);
      setItems(data.items || []);
    } catch (e) {
      const msg = e.message || t('daily.loadErr');
      setError(msg);
      setItems([]);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, showToast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const kindLabel = useCallback((kind) => t(`daily.kind.${kind}`) || kind, [t]);

  const kindSubLabel = useCallback((item) => {
    if (item.kind !== 'lead') return '';
    const sub = item.activity_subtype;
    if (sub === 'created') return t('daily.subtype.created');
    if (sub === 'updated') return t('daily.subtype.updated');
    return sub || '';
  }, [t]);

  const filtered = useMemo(() => {
    let list = items;
    if (tab !== 'all') list = list.filter((i) => i.kind === tab);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((i) => {
        const blob = [i.contact_label, i.summary, i.platform, i.status, kindLabel(i.kind), kindSubLabel(i)].join(' ').toLowerCase();
        return blob.includes(q);
      });
    }
    return list;
  }, [items, tab, search, kindLabel, kindSubLabel]);

  function KindBadge({ kind }) {
    const label = kindLabel(kind);
    const cls = KIND_BADGE[kind] || 'bg-white/5 text-white/60 border-white/10';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide border ${cls}`}>
        {label}
      </span>
    );
  }

  const isToday = selectedDate === toLocalYMD(new Date());

  const headerDate = useMemo(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }, [selectedDate]);

  const goDetail = (row) => {
    navigate(row.detail_route || '/');
  };

  const tabs = useMemo(
    () => [
      { id: 'all', label: t('daily.tab.all') },
      { id: 'lead', label: t('daily.tab.lead') },
      { id: 'call', label: t('daily.tab.call') },
      { id: 'booking', label: t('daily.tab.booking') },
      { id: 'task', label: t('daily.tab.task') },
    ],
    [t]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 border border-accent/25">
            <LayoutList size={20} className="text-accent" strokeWidth={2} />
          </div>
          <div>
            <h1 className="font-heading font-bold text-2xl tracking-tight text-white">{t('daily.title')}</h1>
            <p className="text-sm text-white/45 mt-0.5">{t('daily.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Premium date navigation */}
      <div className="rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.07] via-white/[0.02] to-transparent p-[1px] shadow-xl shadow-black/40">
        <div className="rounded-[11px] bg-[#0e0e11] border border-white/[0.06] px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
            <div className="flex items-center justify-center gap-2 sm:gap-3 sm:flex-1">
              <button
                type="button"
                onClick={() => setSelectedDate((d) => shiftDay(d, -1))}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.05] text-white/75 hover:text-white hover:bg-white/[0.1] hover:border-white/20 active:scale-[0.96] transition-all duration-200"
                aria-label={t('daily.prev')}
              >
                <ChevronLeft className="w-5 h-5" strokeWidth={2.25} />
              </button>

              <div className="flex-1 min-w-0 text-center px-2">
                <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.22em] text-white/38 font-semibold">
                  {t('daily.selectedDate')}
                </p>
                <p className="font-heading text-lg sm:text-2xl font-bold text-white mt-1 capitalize tracking-tight leading-snug">
                  {headerDate}
                </p>
                <p className="text-xs text-white/30 font-mono mt-1 tabular-nums">{selectedDate}</p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedDate((d) => shiftDay(d, 1))}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.05] text-white/75 hover:text-white hover:bg-white/[0.1] hover:border-white/20 active:scale-[0.96] transition-all duration-200"
                aria-label={t('daily.next')}
              >
                <ChevronRight className="w-5 h-5" strokeWidth={2.25} />
              </button>
            </div>

            <div className="hidden sm:block w-px h-12 bg-white/10 shrink-0 mx-1" aria-hidden />

            <div className="flex justify-center sm:justify-end sm:shrink-0">
              <button
                type="button"
                onClick={() => setSelectedDate(toLocalYMD(new Date()))}
                disabled={isToday}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/50 hover:bg-accent-hover disabled:opacity-35 disabled:shadow-none disabled:pointer-events-none transition-all duration-200 w-full sm:w-auto min-h-[44px]"
              >
                <CalendarDays size={18} strokeWidth={2} className="opacity-95" />
                {t('daily.today')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/10 w-fit max-w-full">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => setTab(tabItem.id)}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              tab === tabItem.id
                ? 'bg-white/[0.12] text-white shadow-sm border border-white/10'
                : 'text-white/45 hover:text-white/75 border border-transparent'
            }`}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" strokeWidth={2} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('daily.searchPh')}
          className="w-full bg-surface border border-white/10 rounded-xl pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-accent/80 focus:ring-1 focus:ring-accent/50 transition-colors"
        />
      </div>

      {error && !loading && (
        <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="rounded-xl border border-white/10 bg-surface py-16 text-center">
          <div className="inline-block h-8 w-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          <p className="text-sm text-white/45 mt-4">{t('daily.loading')}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/12 bg-surface/80 px-6 py-16 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.05] border border-white/10 mb-4">
            <CalendarDays className="text-white/25" size={28} strokeWidth={1.5} />
          </div>
          <p className="text-white/80 font-heading font-semibold">{t('daily.emptyTitle')}</p>
          <p className="text-sm text-white/40 mt-2 max-w-md mx-auto leading-relaxed">{t('daily.emptyHint')}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-surface overflow-hidden shadow-lg shadow-black/30">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left border-collapse">
              <thead>
                <tr className="bg-[#0a0a0c] border-b border-white/10">
                  {[
                    { k: t('daily.col.time'), w: '' },
                    { k: t('daily.col.type'), w: '' },
                    { k: t('daily.col.contact'), w: '' },
                    { k: t('daily.col.platform'), w: '' },
                    { k: t('daily.col.status'), w: '' },
                    { k: t('daily.col.summary'), w: '' },
                    { k: '', w: 'w-px' },
                  ].map((col) => (
                    <th
                      key={col.k || 'go'}
                      className={`px-4 py-3.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40 ${col.w}`}
                    >
                      {col.k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => (
                  <tr
                    key={row.id}
                    tabIndex={0}
                    role="button"
                    onClick={() => goDetail(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        goDetail(row);
                      }
                    }}
                    className={`
                      group/row border-b border-white/[0.06] cursor-pointer transition-colors duration-150
                      ${idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'}
                      hover:bg-white/[0.06]
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60
                    `}
                  >
                    <td className="px-4 py-3.5 align-top whitespace-nowrap">
                      <span className="font-mono text-sm tabular-nums text-accent/90 font-medium">
                        {row.at
                          ? new Date(row.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-1.5 items-start">
                        <KindBadge kind={row.kind} />
                        {kindSubLabel(row) && (
                          <span className="text-[11px] text-white/45 font-medium leading-tight">{kindSubLabel(row)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 align-top max-w-[220px]">
                      <span className="text-sm font-semibold text-white/95 leading-snug line-clamp-2" title={row.contact_label}>
                        {row.contact_label || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 align-top">
                      <span className="text-xs text-white/45">{row.platform || '—'}</span>
                    </td>
                    <td className="px-4 py-3.5 align-top">
                      <span className="inline-flex text-xs font-medium text-white/65 capitalize max-w-[140px] truncate" title={row.status}>
                        {row.status || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 align-top max-w-[280px]">
                      <span className="text-sm text-white/50 leading-relaxed line-clamp-2">{row.summary || '—'}</span>
                    </td>
                    <td className="px-4 py-3.5 align-middle text-right">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent/70 group-hover/row:text-accent transition-colors">
                        <span className="hidden sm:inline">{t('daily.openDetail')}</span>
                        <span className="sm:hidden">{t('daily.openShort')}</span>
                        <ArrowUpRight size={16} strokeWidth={2.25} className="opacity-80 group-hover/row:translate-x-0.5 group-hover/row:-translate-y-0.5 transition-transform" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <p className="text-xs text-white/30 font-medium">
          {t('daily.footer', { count: filtered.length })}
        </p>
      )}
    </div>
  );
}
