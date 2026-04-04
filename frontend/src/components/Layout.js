import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import {
  LayoutDashboard, Users, CheckSquare, Calendar, Phone, Send,
  MessageSquare, Zap, Settings, LogOut, Menu, X, CalendarDays,
} from 'lucide-react';

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/daily', icon: CalendarDays, label: 'Daily' },
  { to: '/leads', icon: Users, label: 'CRM' },
  { to: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { to: '/bookings', icon: Calendar, label: 'Bookings' },
  { to: '/calls', icon: Phone, label: 'Calls' },
  { to: '/outreach', icon: Send, label: 'Outreach' },
  { to: '/templates', icon: MessageSquare, label: 'Templates' },
  { to: '/integrations', icon: Zap, label: 'Integrations' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

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
          <span className="font-heading font-extrabold text-lg tracking-tight">Villapel OS</span>
          <button onClick={() => setOpen(false)} className="lg:hidden text-white/60 hover:text-white"><X size={20} /></button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={linkClass} onClick={() => setOpen(false)} data-testid={`sidebar-nav-${n.label.toLowerCase()}`}>
              <n.icon size={18} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          <div className="text-xs text-white/40 mb-2 px-3">{user?.email}</div>
          <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-white/60 hover:text-white hover:bg-white/5 w-full" data-testid="logout-button">
            <LogOut size={18} /> Logout
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 lg:ml-60 flex flex-col min-h-screen">
        <header className="sticky top-0 z-20 h-14 bg-[#09090B]/80 backdrop-blur-xl border-b border-white/10 flex items-center px-4 lg:px-6">
          <button onClick={() => setOpen(true)} className="lg:hidden mr-3 text-white/60 hover:text-white"><Menu size={20} /></button>
          <span className="font-heading font-semibold text-sm text-white/80">Villapel OS</span>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
