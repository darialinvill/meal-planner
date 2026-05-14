import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import MealCard from '../components/MealCard.jsx';

export default function Week() {
  const { user } = useAuth();
  const [week, setWeek] = useState(null);
  const [exists, setExists] = useState(true);
  const [weekStart, setWeekStart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [locking, setLocking] = useState(false);
  const [lockMsg, setLockMsg] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .get('/api/meals/current')
      .then((data) => {
        if (data.exists) {
          setWeek(data);
          setExists(true);
        } else {
          setExists(false);
          setWeekStart(data.week_start);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const generate = async ({ force = false } = {}) => {
    setError(null);
    setGenerating(true);
    try {
      await api.post('/api/meals/generate', { force });
      load();
    } catch (e) {
      setError(`Generation failed: ${e.message}${e.detail ? ` (${e.detail})` : ''}`);
    } finally {
      setGenerating(false);
    }
  };

  const lock = async () => {
    setError(null);
    setLockMsg(null);
    setLocking(true);
    try {
      const result = await api.post('/api/meals/lock', {});
      if (result.ready_to_finalize) {
        setLockMsg(
          `Locked in. Both of you are done — ${result.approved_count} meal${result.approved_count === 1 ? '' : 's'} approved` +
            (result.generated_count > 0
              ? ` · ${result.generated_count} new recipe${result.generated_count === 1 ? '' : 's'} written`
              : '') +
            (result.emailed ? ' · menu emailed.' : '.'),
        );
      } else {
        setLockMsg('Locked in. Waiting for your partner to lock in too.');
      }
      load();
    } catch (e) {
      setError(`Lock failed: ${e.message}${e.detail ? ` (${e.detail})` : ''}`);
    } finally {
      setLocking(false);
    }
  };

  const unlock = async () => {
    setError(null);
    setLockMsg(null);
    setLocking(true);
    try {
      await api.post('/api/meals/unlock', {});
      load();
    } catch (e) {
      setError(`Unlock failed: ${e.message}`);
    } finally {
      setLocking(false);
    }
  };

  const vote = async (mealId, value) => {
    const prevWeek = week;
    // Optimistically: update the vote, and clear my own lock (the server will too).
    setWeek((prev) => ({
      ...prev,
      locks: (prev.locks || []).map((l) =>
        l.user_id === user.id ? { ...l, locked_at: null } : l,
      ),
      meals: prev.meals.map((m) => {
        if (m.id !== mealId) return m;
        const others = m.votes.filter((v) => v.user_id !== user.id);
        if (value === null) return { ...m, votes: others };
        return {
          ...m,
          votes: [...others, { user_id: user.id, vote: value, display_name: user.display_name }],
        };
      }),
    }));
    try {
      await api.post(`/api/meals/${mealId}/vote`, { vote: value });
    } catch (e) {
      setWeek(prevWeek);
      setError(`Vote failed: ${e.message}`);
    }
  };

  if (loading) return <div className="container">Loading…</div>;
  if (error) return <div className="container"><div className="error">{error}</div></div>;

  if (!exists) {
    return (
      <div className="container">
        <h1>This week</h1>
        <p className="subtitle">No meals generated for the week of {weekStart} yet.</p>
        <button className="primary" onClick={generate} disabled={generating}>
          {generating ? 'Generating with Claude…' : 'Generate this week'}
        </button>
        <p className="subtitle" style={{ marginTop: 12, fontSize: 13 }}>
          This calls the Anthropic API and can take ~30–90 seconds.
        </p>
      </div>
    );
  }

  const lunches = week.meals.filter((m) => m.meal_type === 'lunch');
  const dinners = week.meals.filter((m) => m.meal_type === 'dinner');

  const locks = week.locks || [];
  const myLock = locks.find((l) => l.user_id === user.id);
  const otherLocks = locks.filter((l) => l.user_id !== user.id);
  const iAmLocked = !!myLock?.locked_at;
  const finalizedDate = week.finalized_at ? new Date(week.finalized_at) : null;

  return (
    <div className="container">
      <h1>Week of {week.week_start}</h1>
      {week.weekly_theme && <p className="subtitle">{week.weekly_theme}</p>}

      <h2>Lunches</h2>
      {lunches.map((m) => (
        <MealCard key={m.id} meal={m} onVote={vote} />
      ))}

      <h2>Dinners</h2>
      {dinners.map((m) => (
        <MealCard key={m.id} meal={m} onVote={vote} />
      ))}

      <div
        style={{
          background: '#f1f3f7',
          border: '1px solid #dde1ea',
          borderRadius: 10,
          padding: 18,
          margin: '32px 0 12px',
        }}
      >
        <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>Ready to lock in?</h3>
        <div style={{ fontSize: 14, color: '#444', marginBottom: 12, lineHeight: 1.5 }}>
          Vote yes / no on the meals as you go. When you're done, lock in your picks. Once both of you have locked in,
          we'll generate recipes for any meal where you both said yes, and email both of you the finalized menu.
        </div>

        <div style={{ fontSize: 13, marginBottom: 12 }}>
          <div style={{ marginBottom: 4 }}>
            <strong>You ({user.display_name}):</strong>{' '}
            {iAmLocked ? (
              <span style={{ color: '#1f8a3e' }}>✓ Locked in {new Date(myLock.locked_at).toLocaleString()}</span>
            ) : (
              <span style={{ color: '#a05a00' }}>Still voting</span>
            )}
          </div>
          {otherLocks.map((l) => (
            <div key={l.user_id}>
              <strong>{l.display_name}:</strong>{' '}
              {l.locked_at ? (
                <span style={{ color: '#1f8a3e' }}>✓ Locked in {new Date(l.locked_at).toLocaleString()}</span>
              ) : (
                <span style={{ color: '#a05a00' }}>Still voting</span>
              )}
            </div>
          ))}
        </div>

        {iAmLocked ? (
          <button onClick={unlock} disabled={locking}>
            {locking ? 'Unlocking…' : 'Unlock and keep voting'}
          </button>
        ) : (
          <button className="primary" onClick={lock} disabled={locking}>
            {locking ? 'Locking in…' : 'Lock in my picks'}
          </button>
        )}

        {lockMsg && (
          <div style={{ marginTop: 10, color: '#1f6feb', fontSize: 13 }}>{lockMsg}</div>
        )}
        {finalizedDate && (
          <div style={{ marginTop: 10, color: '#555', fontSize: 12 }}>
            Menu last finalized {finalizedDate.toLocaleString()}.
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <button
          onClick={() => {
            if (confirm("Replace this week's meals with a fresh generation? Existing votes will be cleared.")) {
              generate({ force: true });
            }
          }}
          disabled={generating}
        >
          {generating ? 'Regenerating…' : 'Regenerate week'}
        </button>
      </div>
    </div>
  );
}
