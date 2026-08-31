import { useState } from 'react';

const asNumber = (v) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(',', '.')));

/**
 * Anlegen und Bearbeiten eines Produkts.
 *
 * Wird nach einem Barcode-Scan mit den Werten von Open Food Facts
 * vorbelegt – die bleiben ausdruecklich editierbar, weil dort Proteinwerte
 * fehlen oder falsch sein koennen.
 */
export default function ProductForm({ initial = {}, warnings = [], onSubmit, onCancel, submitLabel = 'Speichern' }) {
  const [form, setForm] = useState({
    name: initial.name ?? '',
    brand: initial.brand ?? '',
    barcode: initial.barcode ?? '',
    protein_per_100g: initial.protein_per_100g ?? '',
    kcal_per_100g: initial.kcal_per_100g ?? '',
    default_serving_g: initial.default_serving_g ?? '',
    is_favorite: !!initial.is_favorite,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function submit(e) {
    e.preventDefault();
    const protein = asNumber(form.protein_per_100g);
    if (!form.name.trim()) return setError('Bitte einen Namen angeben.');
    if (protein === null || Number.isNaN(protein) || protein < 0 || protein > 100) {
      return setError('Protein je 100 g muss zwischen 0 und 100 liegen.');
    }

    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: form.name.trim(),
        brand: form.brand.trim() || null,
        barcode: form.barcode.trim() || null,
        protein_per_100g: protein,
        kcal_per_100g: asNumber(form.kcal_per_100g),
        default_serving_g: asNumber(form.default_serving_g),
        source: initial.source ?? 'manual',
        is_favorite: form.is_favorite,
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {warnings.map((w) => <div key={w} className="banner banner-warn">⚠ {w}</div>)}
      {error && <div className="banner banner-error">{error}</div>}

      <label className="field">
        <span>Name</span>
        <input value={form.name} onChange={set('name')} required autoComplete="off" />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Marke</span>
          <input value={form.brand ?? ''} onChange={set('brand')} autoComplete="off" />
        </label>
        <label className="field">
          <span>Barcode</span>
          <input value={form.barcode ?? ''} onChange={set('barcode')} inputMode="numeric" autoComplete="off" />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span>Protein je 100 g *</span>
          <input value={form.protein_per_100g} onChange={set('protein_per_100g')}
                 inputMode="decimal" required placeholder="z. B. 12" />
        </label>
        <label className="field">
          <span>kcal je 100 g</span>
          <input value={form.kcal_per_100g ?? ''} onChange={set('kcal_per_100g')} inputMode="decimal" />
        </label>
      </div>

      <label className="field">
        <span>Übliche Portion in Gramm</span>
        <input value={form.default_serving_g ?? ''} onChange={set('default_serving_g')}
               inputMode="decimal" placeholder="optional" />
      </label>

      <label className="row small">
        <input type="checkbox" checked={form.is_favorite} onChange={set('is_favorite')}
               style={{ width: 'auto', minHeight: 0 }} />
        <span>Als Favorit markieren</span>
      </label>

      <div className="field-row">
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Abbrechen</button>}
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Speichert …' : submitLabel}</button>
      </div>
    </form>
  );
}
