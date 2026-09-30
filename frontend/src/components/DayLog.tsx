import React, { useEffect, useState } from 'react';
import type { Api, Meal } from '../api';
import { MEAL_SLOTS } from '../../../shared/macro-math';

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function DayLog({ api, targetRatio }: { api: Api; targetRatio: number }) {
  const [date, setDate] = useState(todayStr());
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(d: string) {
    setLoading(true);
    setNotice(null);
    try {
      const r = await api.getMeals(d);
      setMeals(r.meals);
    } catch (e: any) {
      setNotice(e?.message ?? 'load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function saveAsTemplate(m: Meal) {
    try {
      await api.createTemplate({ name: m.name, ingredients: m.ingredients });
      setNotice(`Template "${m.name}" saved.`);
    } catch (e: any) {
      setNotice(e?.message ?? 'save failed');
    }
  }

  async function remove(m: Meal) {
    if (!window.confirm(`Delete "${m.name}" from ${m.slot}?`)) return;
    try {
      await api.deleteMeal(m.id, m.date, m.slot);
      load(date);
    } catch (e: any) {
      setNotice(e?.message ?? 'delete failed');
    }
  }

  const dayTotals = meals.reduce(
    (a, m) => ({
      fat: a.fat + m.totals.fat,
      protein: a.protein + m.totals.protein,
      netCarbs: a.netCarbs + m.netCarbs,
      calories: a.calories + m.totals.calories,
    }),
    { fat: 0, protein: 0, netCarbs: 0, calories: 0 },
  );

  return (
    <div>
      <h2>Day log</h2>
      <div className="row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={() => setDate(todayStr())}>Today</button>
      </div>
      {loading && <p className="muted">Loading…</p>}
      {notice && <p className="notice">{notice}</p>}

      {!loading &&
        MEAL_SLOTS.map((slot) => {
          const slotMeals = meals.filter((m) => m.slot === slot);
          return (
            <div key={slot} className="slot">
              <h3>
                {slot} <span className="muted">({slotMeals.length})</span>
              </h3>
              {slotMeals.length === 0 && <p className="muted">Nothing logged.</p>}
              {slotMeals.map((m) => (
                <div key={m.id} className="meal">
                  <div className="row" onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                    <span className="grow">
                      <b>{m.name}</b>
                    </span>
                    <span className={m.ratio !== null && m.ratio >= targetRatio ? 'ok' : 'warn'}>
                      {m.ratio === null ? '—' : `${m.ratio}:1`}
                    </span>
                  </div>
                  {expanded === m.id && (
                    <div className="meal-detail">
                      <ul>
                        {m.ingredients.map((ing, i) => (
                          <li key={i}>
                            {ing.name} — {ing.grams}g
                          </li>
                        ))}
                      </ul>
                      <p className="muted">
                        Fat {m.totals.fat}g · Protein {m.totals.protein}g · Net carbs {m.netCarbs}g ·{' '}
                        {m.totals.calories} kcal
                      </p>
                      <div className="row">
                        <button onClick={() => saveAsTemplate(m)}>Save as template</button>
                        <button className="danger" onClick={() => remove(m)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}

      {meals.length > 0 && (
        <div className="totals">
          Day totals: fat {Math.round(dayTotals.fat * 10) / 10}g · protein{' '}
          {Math.round(dayTotals.protein * 10) / 10}g · net carbs{' '}
          {Math.round(dayTotals.netCarbs * 10) / 10}g · {Math.round(dayTotals.calories)} kcal
        </div>
      )}
    </div>
  );
}
