import React, { useEffect, useMemo, useState } from 'react';
import type { Api, IngredientLine, IngredientSearchResult, Per100g } from '../api';
import {
  MEAL_SLOTS,
  fatNeededForRatio,
  ketoRatio,
  netCarbs,
  ratioStatus,
  sumNutrients,
} from '../../../shared/macro-math';

export interface BuilderSeed {
  name: string;
  ingredients: IngredientLine[];
}

interface LineState {
  key: string;
  name: string;
  fdcId?: number;
  /** kept as text so the field can be cleared while typing */
  gramsText: string;
  per100g: Per100g;
}

let keySeq = 0;
const nextKey = () => `line-${Date.now()}-${keySeq++}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

function parseGrams(t: string): number {
  const v = parseFloat(t);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export default function MealBuilder({
  api,
  targetRatio,
  seed,
  onSeedConsumed,
  onSaved,
}: {
  api: Api;
  targetRatio: number;
  seed: BuilderSeed | null;
  onSeedConsumed: () => void;
  onSaved: () => void;
}) {
  const [mealName, setMealName] = useState('');
  const [date, setDate] = useState(todayStr());
  const [slot, setSlot] = useState<string>('breakfast');
  const [lines, setLines] = useState<LineState[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IngredientSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Apply a template seed once (copy-on-instantiate: edits here never touch the template).
  useEffect(() => {
    if (seed) {
      setMealName(seed.name);
      setLines(
        seed.ingredients.map((i) => ({
          key: nextKey(),
          name: i.name,
          fdcId: i.fdcId,
          gramsText: String(i.grams),
          per100g: i.per100g,
        })),
      );
      onSeedConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const totals = useMemo(
    () => sumNutrients(lines.map((l) => ({ grams: parseGrams(l.gramsText), per100g: l.per100g }))),
    [lines],
  );
  const ratio = ketoRatio(totals);
  const status = ratioStatus(ratio, targetRatio);
  const nc = netCarbs(totals);
  const fatNeeded = fatNeededForRatio(totals, targetRatio);

  async function doSearch() {
    if (query.trim().length < 2) return;
    setSearching(true);
    setSearchError(null);
    try {
      const r = await api.searchIngredients(query.trim());
      setResults(r.results);
    } catch (e: any) {
      setSearchError(e?.message ?? 'search failed');
    } finally {
      setSearching(false);
    }
  }

  function addLine(r: IngredientSearchResult) {
    setLines((ls) => [
      ...ls,
      { key: nextKey(), name: r.description, fdcId: r.fdcId, gramsText: '100', per100g: r.per100g },
    ]);
  }

  function setGrams(key: string, text: string) {
    if (text !== '' && !/^\d*\.?\d*$/.test(text)) return; // digits + one dot, or empty
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, gramsText: text } : l)));
  }

  function nudge(key: string, delta: number) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const cur = parseGrams(l.gramsText) || 100;
        return { ...l, gramsText: String(Math.max(1, Math.round(cur + delta))) };
      }),
    );
  }

  function blurClamp(key: string) {
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const v = parseGrams(l.gramsText);
        return { ...l, gramsText: v > 0 ? String(Math.round(v)) : '1' };
      }),
    );
  }

  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  function payload() {
    return {
      date,
      slot,
      name: mealName.trim() || 'Untitled meal',
      ingredients: lines.map((l) => ({
        name: l.name,
        fdcId: l.fdcId,
        grams: parseGrams(l.gramsText) || 1,
        per100g: l.per100g,
      })),
    };
  }

  async function logMeal() {
    if (!lines.length) {
      setNotice('Add at least one ingredient first.');
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await api.createMeal(payload());
      setNotice(`Logged to ${date} · ${slot}.`);
      onSaved();
    } catch (e: any) {
      setNotice(e?.message ?? 'save failed');
    } finally {
      setSaving(false);
    }
  }

  async function saveTemplate() {
    if (!lines.length) {
      setNotice('Add at least one ingredient first.');
      return;
    }
    const name = mealName.trim();
    if (!name) {
      setNotice('Give the meal a name to save it as a template.');
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await api.createTemplate({ name, ingredients: payload().ingredients });
      setNotice(`Template "${name}" saved.`);
      onSaved();
    } catch (e: any) {
      setNotice(e?.message ?? 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2>Meal builder</h2>

      <div className="row">
        <input
          className="grow"
          placeholder="Meal name (e.g. Typical breakfast)"
          value={mealName}
          onChange={(e) => setMealName(e.target.value)}
        />
      </div>
      <div className="row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select value={slot} onChange={(e) => setSlot(e.target.value)}>
          {MEAL_SLOTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <h3>Add ingredient</h3>
      <div className="row">
        <input
          className="grow"
          placeholder="Search USDA (e.g. avocado)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
        />
        <button onClick={doSearch} disabled={searching}>
          {searching ? '…' : 'Search'}
        </button>
      </div>
      {searchError && <p className="error">{searchError}</p>}
      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={r.fdcId}>
              <span className="grow">{r.description}</span>
              <span className="muted">
                {r.per100g.fat}g fat · {r.per100g.protein}g pro · {r.per100g.carbs - r.per100g.fiber}g net
                /100g
              </span>
              <button onClick={() => addLine(r)}>Add</button>
            </li>
          ))}
        </ul>
      )}

      <h3>Ingredients ({lines.length})</h3>
      {lines.length === 0 && <p className="muted">Search above and add ingredients to start building.</p>}
      <ul className="lines">
        {lines.map((l) => (
          <li key={l.key}>
            <span className="grow">{l.name}</span>
            <div className="stepper">
              <button onClick={() => nudge(l.key, -1)} aria-label="decrease grams">
                −
              </button>
              <input
                className="grams"
                value={l.gramsText}
                inputMode="decimal"
                onChange={(e) => setGrams(l.key, e.target.value)}
                onBlur={() => blurClamp(l.key)}
                aria-label="grams"
              />
              <button onClick={() => nudge(l.key, 1)} aria-label="increase grams">
                +
              </button>
              <span className="muted">g</span>
            </div>
            <button className="danger" onClick={() => removeLine(l.key)} aria-label="remove">
              ×
            </button>
          </li>
        ))}
      </ul>

      {lines.length > 0 && (
        <div className="totals">
          <div>
            Fat <b>{totals.fat}g</b> · Protein <b>{totals.protein}g</b> · Net carbs{' '}
            <b>{nc}g</b> <span className="muted">(fiber {totals.fiber}g)</span> ·{' '}
            {totals.calories} kcal
          </div>
          <div className={`ratio ratio-${status}`}>
            Ratio {ratio === null ? '—' : `${ratio}:1`} · target {targetRatio}:1 ·{' '}
            {status === 'hit' ? 'on target ✓' : status === 'below' ? `add ~${fatNeeded}g fat` : 'add ingredients'}
          </div>
        </div>
      )}

      <div className="row">
        <button onClick={logMeal} disabled={saving || !lines.length}>
          Log meal
        </button>
        <button onClick={saveTemplate} disabled={saving || !lines.length}>
          Save as template
        </button>
      </div>
      {notice && <p className="notice">{notice}</p>}
    </div>
  );
}
