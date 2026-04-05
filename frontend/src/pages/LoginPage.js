import React, { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useLanguage } from '../lib/LanguageContext';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const { login } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message || t('login.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090B] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-end gap-2 mb-4 text-xs">
          <button
            type="button"
            onClick={() => setLang('es')}
            className={`rounded px-2 py-1 font-medium ${lang === 'es' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white'}`}
          >
            ES
          </button>
          <button
            type="button"
            onClick={() => setLang('en')}
            className={`rounded px-2 py-1 font-medium ${lang === 'en' ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white'}`}
          >
            EN
          </button>
        </div>
        <h1 className="font-heading font-extrabold text-3xl tracking-tight text-center mb-8">{t('app.brand')}</h1>
        <form onSubmit={handleSubmit} className="bg-surface border border-white/10 rounded-lg p-6 space-y-4">
          <h2 className="font-heading font-semibold text-lg">{t('login.title')}</h2>
          {error && <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-md px-3 py-2">{error}</div>}
          <div>
            <label className="block text-xs text-white/60 mb-1">{t('login.email')}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-white placeholder:text-white/40 focus:border-accent focus:ring-1 focus:ring-accent transition-colors text-sm"
              placeholder="admin@villapel.com" data-testid="login-email" />
          </div>
          <div>
            <label className="block text-xs text-white/60 mb-1">{t('login.password')}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full bg-[#121214] border border-white/10 rounded-md px-3 py-2 text-white placeholder:text-white/40 focus:border-accent focus:ring-1 focus:ring-accent transition-colors text-sm"
              placeholder={t('login.placeholderPassword')} data-testid="login-password" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-accent text-white hover:bg-accent-hover rounded-md px-4 py-2 font-medium tracking-wide transition-all disabled:opacity-50 text-sm"
            data-testid="login-button">
            {loading ? t('login.submitting') : t('login.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
