import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync, useProfile } from '../lib/store.jsx';
import { fmt, longDate } from '../lib/date.js';

const asNumber = (v) => Number(String(v).replace(',', '.'));

export default function Settings() {
  const { user, users, activeId, setActiveId, reloadUsers, today, refresh } = useProfile();

  const [form, setForm] = useState({ name: '', weight_kg: '', factor_training: '', factor_rest: '' });
  const [weightInput, setWeightInput] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    setForm({
      name: user.name,
      weight_kg: String(user.weight_kg),
      factor_training: String(user.factor_training),
      factor_rest: String(user.factor_rest),
    });
  }, [user]);

  const { data: weights } = useAsync(() => api.weights(user.id), [user.id, reload], { initial: [] });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function saveProfile(e) {
    e.preventDefault();
    setError(null);
    setStatus(null);

    const factorTraining = asNumber(form.factor_training);
    const factorRest = asNumber(form.factor_rest);
    if (factorTraining < factorRest) {
      setError('faktor_training darf nicht unter faktor_ruhe liegen – sonst wäre die Untergrenze wirkungslos.');
      return;
    }

    try {
      await api.updateUser(user.id, {
        name: form.name.trim(),
        weight_kg: asNumber(form.weight_kg),
        factor_training: factorTraining,
        factor_rest: factorRest,
      });
      await reloadUsers();
      refresh();
      setStatus('Gespeichert. Das heutige Ziel ist sofort angepasst, eingefrorene Tage bleiben unverändert.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function addWeight(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.addWeight(user.id, { user_id: user.id, date: today, weight_kg: asNumber(weightInput) });
      setWeightInput('');
      setReload((r) => r + 1);
      await reloadUsers();
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addProfile() {
    setError(null);
    try {
      const created = await api.createUser({ name: `Profil ${users.length + 1}`, weight_kg: 75 });
      await reloadUsers();
      setActiveId(created.id);
    } catch (err) {
      setError(err.message);
    }
  }

  const preview = {
    training: asNumber(form.weight_kg) * Math.max(asNumber(form.factor_training), asNumber(form.factor_rest)),
    rest: asNumber(form.weight_kg) * asNumber(form.factor_rest),
  };

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}
      {status && <div className="banner">{status}</div>}

      <div className="card stack">
        <h2>Profil</h2>
        <div className="segmented" role="group" aria-label="Profil wählen">
          {users.map((u) => (
            <button key={u.id} type="button" aria-pressed={u.id === activeId} onClick={() => setActiveId(u.id)}>
              {u.name}
            </button>
          ))}
        </div>
        <button className="btn-ghost btn-sm" onClick={addProfile}>+ Weiteres Profil</button>
        <p className="tiny muted" style={{ margin: 0 }}>
          Ohne Anmeldung – der Prototyp ist für ein geteiltes Gerät im Heimnetz gedacht.
        </p>
      </div>

      <form className="card stack" onSubmit={saveProfile}>
        <h2>Gewicht und Faktoren</h2>

        <label className="field">
          <span>Name</span>
          <input value={form.name} onChange={set('name')} required />
        </label>

        <label className="field">
          <span>Körpergewicht in kg</span>
          <input value={form.weight_kg} onChange={set('weight_kg')} inputMode="decimal" required />
        </label>

        <div className="field-row">
          <label className="field">
            <span>faktor_training (g/kg)</span>
            <input value={form.factor_training} onChange={set('factor_training')} inputMode="decimal" required />
          </label>
          <label className="field">
            <span>faktor_ruhe (g/kg)</span>
            <input value={form.factor_rest} onChange={set('factor_rest')} inputMode="decimal" required />
          </label>
        </div>

        <div className="row-between small secondary">
          <span>Trainingsnaher Tag <strong className="tabular">{fmt(preview.training)} g</strong></span>
          <span>Ruhetag <strong className="tabular">{fmt(preview.rest)} g</strong></span>
        </div>

        <p className="tiny muted" style={{ margin: 0 }}>
          faktor_ruhe ist die Untergrenze: das Ziel sinkt nie darunter, auch nicht nach Wochen ohne Training.
        </p>

        <button type="submit" className="primary btn-block">Speichern</button>
      </form>

      <div className="card stack">
        <h2>Gewichtsverlauf</h2>
        <form className="field-row" onSubmit={addWeight}>
          <label className="field grow">
            <span>Heutiges Gewicht in kg</span>
            <input value={weightInput} onChange={(e) => setWeightInput(e.target.value)}
                   inputMode="decimal" placeholder={String(user.weight_kg)} />
          </label>
          <button type="submit" className="primary" style={{ alignSelf: 'flex-end' }}
                  disabled={!weightInput.trim()}>Eintragen</button>
        </form>

        {weights.length === 0 ? (
          <p className="empty">Noch kein Eintrag – gerechnet wird mit dem Profilgewicht.</p>
        ) : (
          <div className="list">
            {weights.slice(0, 12).map((w) => (
              <div className="list-item" key={w.date}>
                <span className="grow small">{longDate(w.date)}</span>
                <strong className="tabular">{fmt(w.weight_kg, 1)} kg</strong>
                <button className="btn-sm btn-ghost btn-danger" aria-label={`Eintrag vom ${w.date} löschen`}
                        onClick={async () => {
                          await api.deleteWeight(user.id, w.date);
                          setReload((r) => r + 1);
                          await reloadUsers();
                        }}>✕</button>
              </div>
            ))}
          </div>
        )}
        <p className="tiny muted" style={{ margin: 0 }}>
          Für jeden Tag gilt der zuletzt davor eingetragene Wert – so bleiben alte Ziele nachvollziehbar.
        </p>
      </div>

      <div className="card stack">
        <h2>Hinweis</h2>
        <p className="small secondary" style={{ margin: 0 }}>
          Die Voreinstellungen orientieren sich am Bereich 1,6–2,2 g/kg, der für Kraftsport gut belegt ist
          (u. a. Morton et al., 2018). Bei Nierenerkrankungen oder anderen Vorerkrankungen gelten andere
          Werte – das gehört in eine ärztliche oder ernährungsmedizinische Beratung, nicht in diese App.
        </p>
      </div>
    </>
  );
}
