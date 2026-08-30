import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync, useProfile } from '../lib/store.jsx';
import { fmt } from '../lib/date.js';
import Sheet from '../components/Sheet.jsx';

/** Anlegen und Bearbeiten einer Vorlage: Name plus Positionen mit Menge. */
function TemplateForm({ initial, products, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [items, setItems] = useState(
    initial?.items?.map((i) => ({ product_id: i.product_id, amount_g: String(i.amount_g) })) ?? []
  );
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const setItem = (idx, patch) =>
    setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const protein = items.reduce((sum, it) => {
    const p = products.find((x) => x.id === Number(it.product_id));
    const amount = Number(String(it.amount_g).replace(',', '.'));
    return sum + (p && Number.isFinite(amount) ? (amount / 100) * p.protein_per_100g : 0);
  }, 0);

  async function submit(e) {
    e.preventDefault();
    const clean = items
      .map((it) => ({ product_id: Number(it.product_id), amount_g: Number(String(it.amount_g).replace(',', '.')) }))
      .filter((it) => it.product_id > 0 && Number.isFinite(it.amount_g) && it.amount_g > 0);

    if (!name.trim()) return setError('Bitte einen Namen angeben.');
    if (clean.length === 0) return setError('Mindestens eine Position mit Menge angeben.');

    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), items: clean });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error && <div className="banner banner-error">{error}</div>}

      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)}
               placeholder="z. B. Shake nach dem Training" required />
      </label>

      {items.map((it, idx) => (
        <div className="field-row" key={idx}>
          <label className="field" style={{ flex: 2 }}>
            <span>Produkt</span>
            <select value={it.product_id} onChange={(e) => setItem(idx, { product_id: e.target.value })}>
              <option value="">– wählen –</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Gramm</span>
            <input value={it.amount_g} inputMode="decimal"
                   onChange={(e) => setItem(idx, { amount_g: e.target.value })} />
          </label>
          <button type="button" className="btn-ghost btn-danger" style={{ alignSelf: 'flex-end' }}
                  aria-label={`Position ${idx + 1} entfernen`}
                  onClick={() => setItems((l) => l.filter((_, i) => i !== idx))}>✕</button>
        </div>
      ))}

      <button type="button" onClick={() => setItems((l) => [...l, { product_id: '', amount_g: '' }])}>
        + Position
      </button>

      <div className="row-between">
        <span className="muted small">Ergibt</span>
        <strong className="tabular">{fmt(protein, 1)} g Protein</strong>
      </div>

      <div className="field-row">
        <button type="button" className="btn-ghost" onClick={onCancel}>Abbrechen</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Speichert …' : 'Speichern'}</button>
      </div>
    </form>
  );
}

export default function Templates() {
  const { user, today, refresh } = useProfile();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [reload, setReload] = useState(0);

  const { data: templates, loading } = useAsync(() => api.templates(), [reload], { initial: [] });
  const { data: products } = useAsync(() => api.products({ limit: 300 }), [reload], { initial: [] });

  const reloadAll = () => setReload((r) => r + 1);

  async function logTemplate(tpl, status) {
    setError(null);
    try {
      await api.logTemplate(tpl.id, { user_id: user.id, date: today, status });
      refresh();
      setNotice(`„${tpl.name}“ eingetragen (${fmt(tpl.protein_g, 1)} g).`);
      if (status === 'eaten') navigate('/');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}
      {notice && <div className="banner">{notice}</div>}

      <div className="card row-between">
        <div className="grow">
          <div style={{ fontWeight: 600 }}>Mahlzeiten-Vorlagen</div>
          <p className="tiny muted" style={{ margin: '2px 0 0' }}>
            Wiederkehrende Kombinationen mit einem Tap für heute loggen.
          </p>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>+ Neu</button>
      </div>

      {loading && <div className="empty">Lade …</div>}
      {!loading && templates.length === 0 && (
        <div className="card empty">Noch keine Vorlage angelegt.</div>
      )}

      {templates.map((tpl) => (
        <div className="card stack" key={tpl.id}>
          <div className="row-between">
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{tpl.name}</div>
              <div className="tiny muted">
                {tpl.items.map((i) => `${i.product_name} ${fmt(i.amount_g)} g`).join(' · ')}
              </div>
            </div>
            <strong className="tabular">{fmt(tpl.protein_g, 1)} g</strong>
          </div>

          <div className="field-row">
            <button className="primary" onClick={() => logTemplate(tpl, 'eaten')}>Gegessen</button>
            <button onClick={() => logTemplate(tpl, 'planned')}>Geplant</button>
            <button className="btn-ghost" onClick={() => setEditing(tpl)}>Bearbeiten</button>
          </div>
        </div>
      ))}

      {(creating || editing) && (
        <Sheet title={editing ? 'Vorlage bearbeiten' : 'Vorlage anlegen'}
               onClose={() => { setCreating(false); setEditing(null); }}>
          <TemplateForm
            initial={editing}
            products={products}
            onCancel={() => { setCreating(false); setEditing(null); }}
            onSubmit={async (body) => {
              if (editing) await api.updateTemplate(editing.id, body);
              else await api.createTemplate(body);
              setCreating(false);
              setEditing(null);
              reloadAll();
            }}
          />
          {editing && (
            <button className="btn-ghost btn-danger btn-block"
                    onClick={async () => {
                      await api.deleteTemplate(editing.id);
                      setEditing(null);
                      reloadAll();
                    }}>
              Vorlage löschen
            </button>
          )}
        </Sheet>
      )}
    </>
  );
}
