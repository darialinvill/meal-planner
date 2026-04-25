import { useState } from 'react';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await signup(email, password, displayName);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 400, marginTop: 48 }}>
      <h1>Nourish</h1>
      <p className="subtitle">{mode === 'login' ? 'Sign in to your household' : 'Create your account'}</p>
      {error && <div className="error">{error}</div>}
      <form onSubmit={submit} className="card">
        {mode === 'signup' && (
          <div className="field">
            <label>Display name</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
        )}
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
        <button type="submit" className="primary" disabled={busy} style={{ width: '100%' }}>
          {busy ? '...' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <p style={{ textAlign: 'center', marginTop: 12 }}>
        {mode === 'login' ? (
          <>
            New here?{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), setMode('signup'))}>
              Create an account
            </a>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), setMode('login'))}>
              Sign in
            </a>
          </>
        )}
      </p>
    </div>
  );
}
