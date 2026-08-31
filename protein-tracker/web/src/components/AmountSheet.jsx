import { useState } from 'react';
import Sheet from './Sheet.jsx';
import { fmt } from '../lib/date.js';

const QUICK = [50, 100, 150, 200, 250];

/** Menge und Status waehlen, nachdem ein Produkt ausgesucht wurde. */
export default function AmountSheet({ product, date, onCancel, onSubmit }) {
  const [amount, setAmount] = useState(String(product.default_serving_g ?? 100));
  const [status, setStatus] = useState('eaten');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const grams = Number(String(amount).replace(',', '.'));
  const valid = Number.isFinite(grams) && grams > 0;
  const protein = valid ? (grams / 100) * product.protein_per_100g : 0;

  async function submit(e) {
    e.preventDefault();
    if (!valid) return setError('Bitte eine Menge größer als 0 angeben.');
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ amount_g: grams, status });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={product.name} onClose={onCancel}>
      <form className="stack" onSubmit={submit}>
        <p className="small muted" style={{ margin: 0 }}>
          {product.brand ? `${product.brand} · ` : ''}
          {fmt(product.protein_per_100g, 1)} g Protein je 100 g
        </p>

        {error && <div className="banner banner-error">{error}</div>}

        <label className="field">
          <span>Menge in Gramm</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)}
                 inputMode="decimal" autoFocus required />
        </label>

        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {(product.default_serving_g ? [product.default_serving_g, ...QUICK] : QUICK)
            .filter((v, i, arr) => arr.indexOf(v) === i)
            .map((v) => (
              <button type="button" key={v} className="btn-sm" onClick={() => setAmount(String(v))}>
                {fmt(v)} g
              </button>
            ))}
        </div>

        <div className="segmented" role="group" aria-label="Status">
          <button type="button" aria-pressed={status === 'eaten'} onClick={() => setStatus('eaten')}>
            Gegessen
          </button>
          <button type="button" aria-pressed={status === 'planned'} onClick={() => setStatus('planned')}>
            Geplant
          </button>
        </div>

        <div className="row-between">
          <span className="muted small">Ergibt</span>
          <strong className="tabular">{fmt(protein, 1)} g Protein</strong>
        </div>

        <button type="submit" className="primary btn-block" disabled={busy || !valid}>
          {busy ? 'Speichert …' : `Für ${date} eintragen`}
        </button>
      </form>
    </Sheet>
  );
}
