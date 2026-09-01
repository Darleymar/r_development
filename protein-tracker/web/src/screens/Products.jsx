import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/store.jsx';
import { fmt } from '../lib/date.js';
import Sheet from '../components/Sheet.jsx';
import ProductForm from '../components/ProductForm.jsx';

/**
 * Die Produktbibliothek ist nutzeruebergreifend: einmal erfasst, greifen
 * beide Profile darauf zu.
 */
export default function Products() {
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  const { data: products, loading } = useAsync(
    () => api.products({ q: query || undefined, favorites: favoritesOnly ? '1' : undefined, limit: 300 }),
    [query, favoritesOnly, reload],
    { initial: [] }
  );

  const refresh = () => setReload((r) => r + 1);

  const act = async (fn) => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}

      <div className="card stack">
        <label className="field">
          <span>Suche</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="Name, Marke oder Kategorie" autoComplete="off" />
        </label>

        <div className="row-between">
          <div className="segmented" style={{ flex: 1 }} role="group" aria-label="Filter">
            <button type="button" aria-pressed={!favoritesOnly} onClick={() => setFavoritesOnly(false)}>Alle</button>
            <button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(true)}>Favoriten</button>
          </div>
          <button className="primary" onClick={() => setCreating(true)}>+ Neu</button>
        </div>

        <p className="tiny muted" style={{ margin: 0 }}>
          Sortiert nach Favoriten, dann nach Häufigkeit und zuletzt verwendet. Beide Profile teilen sich diese Liste.
        </p>
      </div>

      <div className="card">
        {loading && <p className="empty">Lade …</p>}
        {!loading && products.length === 0 && <p className="empty">Kein Produkt gefunden.</p>}

        <div className="list">
          {products.map((p) => (
            <div key={p.id} className="list-item">
              <button
                className="star"
                aria-pressed={!!p.is_favorite}
                aria-label={p.is_favorite ? `${p.name} aus Favoriten entfernen` : `${p.name} zu Favoriten`}
                onClick={() => act(() => api.updateProduct(p.id, { is_favorite: !p.is_favorite }))}
              >
                {p.is_favorite ? '★' : '☆'}
              </button>

              <button className="grow list-item" style={{ padding: 0, border: 'none' }}
                      onClick={() => setEditing(p)}>
                <div className="grow" style={{ textAlign: 'left' }}>
                  <div className="truncate">{p.name}</div>
                  <div className="tiny muted truncate">
                    {[p.brand || p.category,
                      `${fmt(p.protein_per_100g, 1)} g/100 g`,
                      p.kcal_per_100g ? `${fmt(p.kcal_per_100g)} kcal` : null,
                      p.use_count > 0 ? `${p.use_count}×` : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </button>
            </div>
          ))}
        </div>
      </div>

      {(creating || editing) && (
        <Sheet title={editing ? 'Produkt bearbeiten' : 'Produkt anlegen'}
               onClose={() => { setCreating(false); setEditing(null); }}>
          <ProductForm
            initial={editing ?? {}}
            submitLabel={editing ? 'Speichern' : 'Anlegen'}
            onCancel={() => { setCreating(false); setEditing(null); }}
            onSubmit={async (body) => {
              if (editing) await api.updateProduct(editing.id, body);
              else await api.createProduct(body);
              setCreating(false);
              setEditing(null);
              refresh();
            }}
          />
          {editing && (
            <button
              className="btn-ghost btn-danger btn-block"
              onClick={async () => {
                try {
                  await api.deleteProduct(editing.id);
                  setEditing(null);
                  refresh();
                } catch (err) {
                  setError(err.message);
                  setEditing(null);
                }
              }}
            >
              Produkt löschen
            </button>
          )}
        </Sheet>
      )}
    </>
  );
}
