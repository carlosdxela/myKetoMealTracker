import React, { useState } from 'react';
import type { Api } from '../api';

export default function SettingsView({
  api,
  targetRatio,
  onSaved,
}: {
  api: Api;
  targetRatio: number;
  onSaved: (r: number) => void;
}) {
  const [value, setValue] = useState(String(targetRatio));
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // keep the input in sync if the saved value changes elsewhere
  React.useEffect(() => setValue(String(targetRatio)), [targetRatio]);

  async function save() {
    const v = parseFloat(value);
    if (!Number.isFinite(v) || v <= 0 || v > 10) {
      setNotice('Enter a ratio between 0 and 10 (e.g. 3 for 3:1).');
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const r = await api.putSettings(v);
      onSaved(r.ratioTarget);
      setNotice(`Target ratio saved: ${r.ratioTarget}:1.`);
    } catch (e: any) {
      setNotice(e?.message ?? 'save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2>Settings</h2>
      <div className="row">
        <label>
          Target ketogenic ratio (fat : protein + net carbs){' '}
          <input
            className="grams"
            value={value}
            inputMode="decimal"
            onChange={(e) => {
              if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setValue(e.target.value);
            }}
          />{' '}
          :1
        </label>
        <button onClick={save} disabled={saving}>
          Save
        </button>
      </div>
      <p className="muted">
        Classic therapeutic keto is 4:1 or 3:1. Net carbs are always total carbs minus fiber.
      </p>
      {notice && <p className="notice">{notice}</p>}
    </div>
  );
}
