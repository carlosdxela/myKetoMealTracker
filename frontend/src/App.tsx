import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { configError } from './config';
import { createApi } from './api';
import MealBuilder, { BuilderSeed } from './components/MealBuilder';
import DayLog from './components/DayLog';
import Templates from './components/Templates';
import SettingsView from './components/SettingsView';

type Tab = 'builder' | 'log' | 'templates' | 'settings';

function SignInForm() {
  const { signIn, signUp, confirmSignUp, resendCode } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup' | 'confirm'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void | boolean>, next?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      next?.();
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="card">
        <h1>Keto Meal Tracker</h1>
        {mode === 'signin' && (
          <>
            <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button disabled={busy} onClick={() => run(() => signIn(email, password))}>
              Sign in
            </button>
            <p className="muted">
              No account?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup'); }}>
                Sign up
              </a>
            </p>
          </>
        )}
        {mode === 'signup' && (
          <>
            <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input
              placeholder="Password (8+ chars)"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const confirmed = await signUp(email, password);
                  if (!confirmed) setMode('confirm');
                })
              }
            >
              Create account
            </button>
            <p className="muted">
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('signin'); }}>
                Back to sign in
              </a>
            </p>
          </>
        )}
        {mode === 'confirm' && (
          <>
            <p>Enter the confirmation code sent to {email}.</p>
            <input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
            <button disabled={busy} onClick={() => run(() => confirmSignUp(email, code), () => setMode('signin'))}>
              Confirm
            </button>
            <p className="muted">
              <a href="#" onClick={(e) => { e.preventDefault(); run(() => resendCode(email)); }}>
                Resend code
              </a>
            </p>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

export default function App() {
  const { email, authLoading, signOut, getToken } = useAuth();
  const api = useMemo(() => createApi(getToken), [getToken]);
  const [tab, setTab] = useState<Tab>('builder');
  const [targetRatio, setTargetRatio] = useState(3);
  const [seed, setSeed] = useState<BuilderSeed | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!email) return;
    api.getSettings().then((s) => setTargetRatio(s.ratioTarget)).catch(() => {});
  }, [email, api, refreshTick]);

  const cfgErr = configError();
  if (cfgErr)
    return (
      <div className="center">
        <p className="error">{cfgErr}</p>
      </div>
    );
  if (authLoading)
    return (
      <div className="center">
        <p className="muted">Loading…</p>
      </div>
    );
  if (!email) return <SignInForm />;

  return (
    <div className="app">
      <header>
        <h1>Keto Tracker</h1>
        <span className="muted">{email}</span>
        <button className="link" onClick={signOut}>
          Sign out
        </button>
      </header>
      <nav>
        {(['builder', 'log', 'templates', 'settings'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'builder' ? 'Builder' : t === 'log' ? 'Day log' : t === 'templates' ? 'Templates' : 'Settings'}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'builder' && (
          <MealBuilder
            api={api}
            targetRatio={targetRatio}
            seed={seed}
            onSeedConsumed={() => setSeed(null)}
            onSaved={() => setRefreshTick((x) => x + 1)}
          />
        )}
        {tab === 'log' && <DayLog api={api} targetRatio={targetRatio} />}
        {tab === 'templates' && (
          <Templates
            api={api}
            onUseInBuilder={(s) => {
              setSeed(s);
              setTab('builder');
            }}
          />
        )}
        {tab === 'settings' && (
          <SettingsView api={api} targetRatio={targetRatio} onSaved={setTargetRatio} />
        )}
      </main>
    </div>
  );
}
