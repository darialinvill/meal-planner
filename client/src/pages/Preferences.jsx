import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Preferences() {
  const [prefs, setPrefs] = useState(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get('/api/preferences')
      .then((d) => {
        setPrefs(d.data);
        setText(JSON.stringify(d.data, null, 2));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setError(null);
    setSaved(false);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('Invalid JSON');
      return;
    }
    try {
      await api.put('/api/preferences', { data: parsed });
      setPrefs(parsed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    }
  };

  if (loading) return <div className="container">Loading…</div>;

  return (
    <div className="container">
      <h1>Household preferences</h1>
      <p className="subtitle">
        These feed every weekly generation. Cached on the Anthropic side for an hour, so first request after a change is a cache miss.
      </p>
      {error && <div className="error">{error}</div>}
      {saved && <div className="notice">Saved.</div>}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ minHeight: 480, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
      />
      <div style={{ marginTop: 12 }}>
        <button className="primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
