import { useState } from 'react';
import { api } from '../services/api';
import { User } from '../types';

interface LoginPageProps {
  onLogin: (token: string, user: User) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api.post('/auth/login', { email, password });
      onLogin(data.token, data.user);
    } catch (err: any) {
      setError(err.error || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-hero-gradient flex items-center justify-center px-4 relative overflow-hidden">
      {/* Animated background accents */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-brand-600/15 blur-3xl animate-float" />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-brand-500/10 blur-3xl animate-float" style={{ animationDelay: '3s' }} />
        <div className="absolute top-1/3 left-1/4 w-72 h-72 rounded-full bg-brand-400/8 blur-3xl animate-float" style={{ animationDelay: '5s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-navy-700/30 blur-3xl" />
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      </div>

      <div className="w-full max-w-md relative z-10 animate-fade-in-up">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="inline-block mb-5 animate-float">
            <img
              src="/chc-logo.png"
              alt="CHC Paint & Body Shop Supplies"
              className="h-24 sm:h-28 mx-auto drop-shadow-[0_4px_24px_rgba(230,57,70,0.3)]"
            />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Customer Relationship Manager</h1>
          <p className="text-navy-300 mt-2 tracking-widest text-xs uppercase font-medium">Enterprise Sales Platform</p>
        </div>

        {/* Login form — glass card */}
        <div className="glass-card-login rounded-3xl p-8">
          <h2 className="text-xl font-bold text-navy-900 mb-6">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl border border-red-200 animate-fade-in-down flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-navy-700">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="you@chcpaint.com"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-navy-700">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                placeholder="Enter your password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-base glossy-hover"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-navy-100/60">
            <p className="text-xs text-navy-400 text-center">
              Contact your administrator for access
            </p>
          </div>
        </div>

        <p className="text-xs text-navy-500 text-center mt-6">
          Powered by <span className="text-brand-400 font-semibold">Refinish AI</span>
        </p>
      </div>
    </div>
  );
}
