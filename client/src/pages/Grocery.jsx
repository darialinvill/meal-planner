import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Grocery() {
  const [data, setData] = useState(null);
  const [exists, setExists] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newItem, setNewItem] = useState('');
  const [newCategory, setNewCategory] = useState('Produce');

  const load = () => {
    setLoading(true);
    api
      .get('/api/grocery/current')
      .then((d) => {
        setExists(d.exists);
        setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const toggleMealItem = async (item, checked) => {
    setData((d) => ({
      ...d,
      from_meals: Object.fromEntries(
        Object.entries(d.from_meals).map(([cat, items]) => [
          cat,
          items.map((it) => (it.key === item.key ? { ...it, checked } : it)),
        ]),
      ),
    }));
    await api.post('/api/grocery/check', { week_id: data.week_id, item_key: item.key, checked });
  };

  const toggleManual = async (item, checked) => {
    setData((d) => ({
      ...d,
      manual: d.manual.map((m) => (m.id === item.id ? { ...m, checked: checked ? 1 : 0 } : m)),
    }));
    await api.post(`/api/grocery/manual/${item.id}/check`, { checked });
  };

  const addManual = async (e) => {
    e.preventDefault();
    if (!newItem.trim()) return;
    await api.post('/api/grocery/manual', { week_id: data.week_id, name: newItem, category: newCategory });
    setNewItem('');
    load();
  };

  const deleteManual = async (id) => {
    await api.del(`/api/grocery/manual/${id}`);
    load();
  };

  if (loading) return <div className="container">Loading…</div>;
  if (error) return <div className="container"><div className="error">{error}</div></div>;
  if (!exists) {
    return (
      <div className="container">
        <h1>Grocery</h1>
        <div className="empty">No week generated yet. Head to "Week" to create one.</div>
      </div>
    );
  }

  const categoryOrder = ['Produce', 'Refrigerated', 'Frozen', 'Pantry', 'Bakery', 'Bulk', 'Other'];
  const cats = Object.keys(data.from_meals).sort(
    (a, b) => (categoryOrder.indexOf(a) + 100) - (categoryOrder.indexOf(b) + 100),
  );

  return (
    <div className="container">
      <h1>Grocery</h1>
      <p className="subtitle">Items from meals where at least one of you said yes.</p>

      {cats.length === 0 && (
        <div className="empty">
          No meal-derived items yet. Vote yes on meals in <a href="/week">Week</a> to populate this list.
        </div>
      )}

      {cats.map((cat) => (
        <div key={cat} className="grocery-category">
          <h3>{cat}</h3>
          {data.from_meals[cat].map((item) => (
            <label key={item.key} className={`grocery-item${item.checked ? ' checked' : ''}`}>
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) => toggleMealItem(item, e.target.checked)}
              />
              <div>
                <div className="grocery-name">{item.name}</div>
                <div className="grocery-detail">
                  {item.quantities.join(', ')}
                  {item.store ? ` · ${item.store}` : ''}
                  {item.for_meals.length > 0 && (
                    <> · for {item.for_meals.slice(0, 2).join(', ')}{item.for_meals.length > 2 && ` +${item.for_meals.length - 2}`}</>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>
      ))}

      <h2>Manual items</h2>
      <form onSubmit={addManual} className="row" style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Add an item"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
        />
        <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="narrow">
          {categoryOrder.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button type="submit" className="primary narrow">
          Add
        </button>
      </form>
      {data.manual.map((m) => (
        <label key={m.id} className={`grocery-item${m.checked ? ' checked' : ''}`}>
          <input type="checkbox" checked={!!m.checked} onChange={(e) => toggleManual(m, e.target.checked)} />
          <div style={{ flex: 1 }}>
            <div className="grocery-name">{m.name}</div>
            <div className="grocery-detail">
              {m.category || 'Other'} · added by {m.added_by_name}
            </div>
          </div>
          <button onClick={() => deleteManual(m.id)} style={{ minHeight: 32 }}>
            Remove
          </button>
        </label>
      ))}
    </div>
  );
}
