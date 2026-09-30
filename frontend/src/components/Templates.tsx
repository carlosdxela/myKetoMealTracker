import React, { useEffect, useState } from 'react';
import type { Api, Template } from '../api';
import { MEAL_SLOTS } from '../../../shared/macro-math';
import type { BuilderSeed } from './MealBuilder';

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function Templates({
  api,
  onUseInBuilder,
}: {
  api: Api;
  onUseInBuilder: (seed: BuilderSeed) => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [date, setDate] = useState(todayStr());
  const [slot, setSlot] = useState<string>('breakfast');
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api.listTemplates();
      setTemplates(r.templates);
    } catch (e: any) {
      setNotice(e?.message ?? 'load failed');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addToDay(t: Template) {
    try {
      await api.mealFromTemplate({ templateId: t.id, date, slot });
      setNotice(`"${t.name}" added to ${date} · ${slot}.`);
    } catch (e: any) {
      setNotice(e?.message ?? 'add failed');
    }
  }

  async function remove(t: Template) {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api.deleteTemplate(t.id);
      load();
    } catch (e: any) {
      setNotice(e?.message ?? 'delete failed');
    }
  }

  return (
    <div>
      <h2>Templates</h2>
      <p className="muted">
        Templates are reusable starting points. Adding one to a day <b>copies</b> it — tweaks never
        change the template.
      </p>
      {notice && <p className="notice">{notice}</p>}
      {templates.length === 0 && <p className="muted">No templates yet. Save one from the builder.</p>}
      {templates.map((t) => (
        <div key={t.id} className="meal">
          <div className="row">
            <span className="grow">
              <b>{t.name}</b>{' '}
              <span className="muted">
                {t.totals.fat}g fat · {t.totals.protein}g pro · {t.netCarbs}g net ·{' '}
                {t.ratio === null ? '—' : `${t.ratio}:1`}
              </span>
            </span>
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
            <button onClick={() => addToDay(t)}>Add to day</button>
            <button onClick={() => onUseInBuilder({ name: t.name, ingredients: t.ingredients })}>
              Edit in builder
            </button>
            <button className="danger" onClick={() => remove(t)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
