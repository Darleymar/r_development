import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync, useProfile } from '../lib/store.jsx';
import { fmt, relativeDate } from '../lib/date.js';
import Sheet from '../components/Sheet.jsx';
import BarcodeScanner from '../components/BarcodeScanner.jsx';
import ProductForm from '../components/ProductForm.jsx';
import AmountSheet from '../components/AmountSheet.jsx';

/**
 * Drei Wege zum Eintrag: Barcode scannen, Bibliothek durchsuchen oder
 * manuell anlegen. Danach immer dieselbe Abfrage von Menge und Status.
 */
export default function AddEntry() {
  const { user, today, refresh } = useProfile();
  const navigate = useNavigate();

  const [date, setDate] = useState(today);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState(null);              // 'scan' | 'create'
  const [draft, setDraft] = useState(null);            // Vorbelegung fuer das Formular
  const [warnings, setWarnings] = useState([]);
  const [selected, setSelected] = useState(null);      // Produkt fuer die Mengenabfrage
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const [online, setOnline] = useState(null);        // Treffer von Open Food Facts
  const [searching, setSearching] = useState(false);

  const { data: products, loading } = useAsync(
    () => api.products({ q: query || undefined, limit: 40 }),
    [query, reload],
    { initial: [] }
  );

  async function onBarcode(barcode) {
    setMode(null);
    setError(null);
    setNotice(null);
    try {
      const result = await api.lookupBarcode(barcode);

      if (result.source === 'library') {
        setNotice(`„${result.existing_product.name}“ ist schon in der Bibliothek.`);
        setSelected(result.existing_product);
        return;
      }
      if (!result.found) {
        // Unbekannter Code: direkt ins Anlegeformular, Barcode vorbelegt.
        setNotice(`Barcode ${barcode} ist bei Open Food Facts nicht hinterlegt – bitte selbst anlegen.`);
        setDraft({ barcode });
        setWarnings([]);
        setMode('create');
        return;
      }
      // Gefunden: Werte vorbelegen, aber editierbar lassen.
      setDraft(result.product);
      setWarnings(result.warnings ?? []);
      setMode('create');
    } catch (err) {
      // Nicht erreichbar oder Fehler bei Open Food Facts: kein Grund zum
      // Abbrechen – das Produkt laesst sich von Hand anlegen.
      setNotice(`${err.message} Das Produkt lässt sich hier direkt selbst anlegen.`);
      setDraft({ barcode });
      setWarnings([]);
      setMode('create');
    }
  }

  /**
   * Online nachschlagen. Der Grundstock und die eigene Bibliothek decken den
   * Alltag ab; das hier ist fuer Markenprodukte, deren Packung gerade nicht
   * zur Hand ist.
   */
  async function searchOnline() {
    setSearching(true);
    setError(null);
    setNotice(null);
    setOnline(null);
    try {
      const res = await api.searchOnline(query);
      setOnline(res.results);
      if (res.count === 0) setNotice(`Keine Treffer für „${query}“ bei Open Food Facts.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function createProduct(body) {
    const product = await api.createProduct(body);
    setMode(null);
    setDraft(null);
    setWarnings([]);
    setReload((r) => r + 1);
    setOnline(null);
    setSelected(product);
  }

  async function logEntry({ amount_g, status }) {
    await api.addEntry({ user_id: user.id, date, product_id: selected.id, amount_g, status });
    setSelected(null);
    refresh();
    navigate('/');
  }

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}
      {notice && <div className="banner">{notice}</div>}

      <div className="card stack">
        <label className="field">
          <span>Tag</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <p className="tiny muted" style={{ margin: 0 }}>
          Eintrag für {relativeDate(date, today)}. Für morgen Geplantes lässt sich hier vorbereiten.
        </p>
      </div>

      <div className="field-row">
        <button className="primary" onClick={() => { setNotice(null); setError(null); setMode('scan'); }}>
          Barcode scannen
        </button>
        <button onClick={() => { setDraft(null); setWarnings([]); setMode('create'); }}>
          Neu anlegen
        </button>
      </div>

      <div className="card stack">
        <label className="field">
          <span>Bibliothek durchsuchen</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name oder Marke"
            autoComplete="off"
          />
        </label>

        {loading && <p className="empty">Suche …</p>}
        {!loading && products.length === 0 && (
          <p className="empty">
            {query ? 'Nichts gefunden – über „Neu anlegen“ ergänzen.' : 'Die Bibliothek ist noch leer.'}
          </p>
        )}

        <div className="list">
          {products.map((p) => (
            <button key={p.id} className="list-item" onClick={() => setSelected(p)}>
              <div className="grow">
                <div className="truncate">
                  {p.is_favorite ? '★ ' : ''}{p.name}
                </div>
                <div className="tiny muted truncate">
                  {[p.brand || p.category, `${fmt(p.protein_per_100g, 1)} g/100 g`,
                    p.use_count > 0 ? `${p.use_count}×` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className="muted">+</span>
            </button>
          ))}
        </div>

        {query.trim().length >= 2 && (
          <button className="btn-ghost btn-sm" onClick={searchOnline} disabled={searching}>
            {searching ? 'Sucht online …' : 'Online bei Open Food Facts suchen'}
          </button>
        )}
      </div>

      {online && online.length > 0 && (
        <div className="card stack">
          <h2>Treffer bei Open Food Facts</h2>
          <p className="tiny muted" style={{ margin: 0 }}>
            Werte werden übernommen und lassen sich vor dem Speichern prüfen.
          </p>
          <div className="list">
            {online.map((hit, i) => (
              <button
                key={hit.product.barcode ?? i}
                className="list-item"
                onClick={() => {
                  setDraft(hit.product);
                  setWarnings(hit.warnings);
                  setMode('create');
                }}
              >
                <div className="grow">
                  <div className="truncate">{hit.product.name}</div>
                  <div className="tiny muted truncate">
                    {[hit.product.brand,
                      hit.product.protein_per_100g === null
                        ? 'kein Proteinwert hinterlegt'
                        : `${fmt(hit.product.protein_per_100g, 1)} g/100 g`,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span className="muted">+</span>
              </button>
            ))}
          </div>
          <button className="btn-ghost btn-sm" onClick={() => setOnline(null)}>
            Treffer ausblenden
          </button>
        </div>
      )}

      {mode === 'scan' && (
        <Sheet title="Barcode scannen" onClose={() => setMode(null)}>
          <BarcodeScanner onDetected={onBarcode} onCancel={() => setMode(null)} />
        </Sheet>
      )}

      {mode === 'create' && (
        <Sheet title={draft?.name ? 'Gefundene Werte prüfen' : 'Produkt anlegen'} onClose={() => setMode(null)}>
          {draft?.source === 'openfoodfacts' && (
            <p className="tiny muted" style={{ margin: 0 }}>
              Von Open Food Facts übernommen. Die Datenqualität dort schwankt – Werte bitte kurz prüfen.
            </p>
          )}
          <ProductForm
            initial={draft ?? {}}
            warnings={warnings}
            submitLabel="Anlegen und eintragen"
            onSubmit={createProduct}
            onCancel={() => setMode(null)}
          />
        </Sheet>
      )}

      {selected && (
        <AmountSheet
          product={selected}
          date={relativeDate(date, today).toLowerCase()}
          onCancel={() => setSelected(null)}
          onSubmit={logEntry}
        />
      )}
    </>
  );
}
