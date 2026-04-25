import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Staples() {
  const [data, setData] = useState(null);
  const [exists, setExists] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .get('/api/staples/current')
      .then((d) => {
        setExists(d.exists);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const toggle = async (staple, needed) => {
    setData((d) => ({
      ...d,
      staples: d.staples.map((s) => (s.name === staple ? { ...s, needed } : s)),
    }));
    await api.post('/api/staples/check', { week_id: data.week_id, staple, needed });
  };

  if (loading) return <div className="container">Loading…</div>;
  if (error) return <div className="container"><div className="error">{error}</div></div>;
  if (!exists) {
    return (
      <div className="container">
        <h1>Staples</h1>
        <div className="empty">No week generated yet.</div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Staples for this week</h1>
      <p className="subtitle">Pantry items the week's meals call for. Check what you actually need to buy.</p>

      {data.staples.length === 0 && <div className="empty">No staples listed for this week.</div>}

      {data.staples.map((s) => (
        <label key={s.name} className="staple-row">
          <input type="checkbox" checked={s.needed} onChange={(e) => toggle(s.name, e.target.checked)} />
          <span style={{ textDecoration: s.needed ? 'none' : 'none' }}>
            {s.name}
            {s.needed && <span style={{ color: '#1f6feb', marginLeft: 8, fontSize: 13 }}>need to buy</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
