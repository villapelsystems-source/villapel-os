import React, { useMemo, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';
import {
  LayoutDashboard, Users, CheckSquare, Calendar, Phone, Send,
  MessageSquare, Zap, Settings, LogOut, Menu, X, CalendarDays,
} from 'lucide-react';

const NAV_DEF = [
  { to: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { to: '/daily', icon: CalendarDays, labelKey: 'nav.daily' },
  { to: '/leads', icon: Users, labelKey: 'nav.crm' },
  { to: '/tasks', icon: CheckSquare, labelKey: 'nav.tasks' },
  { to: '/bookings', icon: Calendar, labelKey: 'nav.bookings' },
  { to: '/calls', icon: Phone, labelKey: 'nav.calls' },
  { to: '/outreach', icon: Send, labelKey: 'nav.outreach' },
  { to: '/templates', icon: MessageSquare, labelKey: 'nav.templates' },
  { to: '/integrations', icon: Zap, labelKey: 'nav.integrations' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const nav = useMemo(() => NAV_DEF.map((n) => ({ ...n, label: t(n.labelKey) })), [t]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive ? 'bg-accent text-white' : 'text-white/60 hover:text-white hover:bg-white/5'
    }`;

  return (
    <div className="flex h-screen bg-[#09090B]">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-60 bg-[#09090B] border-r border-white/10 flex flex-col transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between h-14 px-4 border-b border-white/10">
          <span className="font-heading font-extrabold text-lg tracking-tight">{t('app.brand')}</span>
          <button onClick={() => setOpen(false)} className="lg:hidden text-white/60 hover:text-white"><X size={20} /></button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={linkClass}
              onClick={() => setOpen(false)}
              data-testid={`sidebar-nav-${n.to === '/' ? 'home' : n.to.slice(1).replace(/\//g, '-')}`}
            >
              <n.icon size={18} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          <div className="px-3 mb-2 flex items-center gap-2 text-xs text-white/50">
            <span>{t('lang.label')}</span>
            <button
              type="button"
              onClick={() => setLang('es')}
              className={`rounded px-2 py-0.5 font-medium ${lang === 'es' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white'}`}
            >
              ES
            </button>
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`rounded px-2 py-0.5 font-medium ${lang === 'en' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white'}`}
            >
              EN
            </button>
          </div>
          <div className="text-xs text-white/40 mb-2 px-3">{user?.email}</div>
          <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-white/60 hover:text-white hover:bg-white/5 w-full" data-testid="logout-button">
            <LogOut size={18} /> {t('nav.logout')}
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 lg:ml-60 flex flex-col min-h-screen">
        <header className="sticky top-0 z-20 h-14 bg-[#09090B]/80 backdrop-blur-xl border-b border-white/10 flex items-center px-4 lg:px-6">
          <button onClick={() => setOpen(true)} className="lg:hidden mr-3 text-white/60 hover:text-white"><Menu size={20} /></button>
          <span className="font-heading font-semibold text-sm text-white/80">{t('app.brand')}</span>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
