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

  const vote = async (mealId, value) => {
    const prevWeek = week;
    setWeek((prev) => ({
      ...prev,
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

      <div style={{ marginTop: 24 }}>
        <button
          onClick={() => {
            if (confirm('Replace this week\'s meals with a fresh generation? Existing votes will be cleared.')) {
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
