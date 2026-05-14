import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../auth.jsx';

export default function MealCard({ meal, onVote }) {
  const { user } = useAuth();
  const [recipeOpen, setRecipeOpen] = useState(false);
  const myVote = meal.votes.find((v) => v.user_id === user.id)?.vote;
  const total = meal.prep_minutes + meal.cook_minutes;

  return (
    <div className="meal-card">
      <div className="meal-card-head">
        <div>
          <div className="meal-name">{meal.name}</div>
          <div className="meal-meta">
            {meal.cuisine} · {total} min ({meal.prep_minutes}p / {meal.cook_minutes}c)
          </div>
        </div>
      </div>
      <p className="meal-desc">{meal.description}</p>
      {meal.main_ingredients?.length > 0 && (
        <div className="tag-list">
          {meal.main_ingredients.map((ing) => (
            <span key={ing} className="tag">
              {ing}
            </span>
          ))}
        </div>
      )}
      {meal.kid_bridge && (
        <div className="kid-bridge">
          <span className="kid-bridge-tag">Kid bridge</span>
          {meal.kid_bridge}
        </div>
      )}
      {meal.recipe_md && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setRecipeOpen((v) => !v)}
            style={{ background: 'none', border: '1px solid #1f6feb', color: '#1f6feb', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
          >
            {recipeOpen ? 'Hide recipe' : 'View recipe'}
          </button>
          {recipeOpen && (
            <div className="recipe-md" style={{ marginTop: 10, padding: '8px 14px', background: '#fafafa', border: '1px solid #eee', borderRadius: 8, lineHeight: 1.55, fontSize: 14 }}>
              <ReactMarkdown>{meal.recipe_md}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
      <div className="votes">
        <button
          className={`vote-btn yes${myVote === 1 ? ' active' : ''}`}
          onClick={() => onVote(meal.id, myVote === 1 ? null : 1)}
        >
          {myVote === 1 ? '✓ Yes' : 'Yes'}
        </button>
        <button
          className={`vote-btn no${myVote === 0 ? ' active' : ''}`}
          onClick={() => onVote(meal.id, myVote === 0 ? null : 0)}
        >
          {myVote === 0 ? '✕ No' : 'No'}
        </button>
        {meal.votes
          .filter((v) => v.user_id !== user.id)
          .map((v) => (
            <span key={v.user_id} className="vote-row">
              {v.display_name}: {v.vote === 1 ? 'yes' : v.vote === 0 ? 'no' : '—'}
            </span>
          ))}
      </div>
    </div>
  );
}
