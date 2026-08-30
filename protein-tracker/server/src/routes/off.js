import { Router } from 'express';
import { h, bad, HttpError } from '../util.js';

const BARCODE = /^\d{8,14}$/;
const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS = [
  'code', 'product_name', 'product_name_de', 'brands', 'nutriments',
  'serving_size', 'serving_quantity', 'quantity',
].join(',');

// Open Food Facts bittet ausdruecklich um einen aussagekraeftigen User-Agent.
const USER_AGENT = 'ProteinTracker-Prototype/0.1 (self-hosted, non-commercial)';

const numberOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** "30 g", "250ml", "1 Portion (30 g)" -> 30 / 250 / 30 */
function parseServingGrams(servingSize, servingQuantity) {
  const q = numberOrNull(servingQuantity);
  if (q) return q;
  if (typeof servingSize !== 'string') return null;
  const m = servingSize.match(/(\d+(?:[.,]\d+)?)\s*(g|ml)/i);
  return m ? numberOrNull(m[1].replace(',', '.')) : null;
}

export function mapOffProduct(raw, barcode) {
  const n = raw?.nutriments ?? {};
  const protein = numberOrNull(n.proteins_100g ?? n.proteins_value);
  const kcal = numberOrNull(n['energy-kcal_100g']);
  const serving = parseServingGrams(raw?.serving_size, raw?.serving_quantity);

  const warnings = [];
  if (protein === null) {
    warnings.push('Open Food Facts hat fuer dieses Produkt keinen Proteinwert – bitte selbst eintragen.');
  }
  if (kcal === null) warnings.push('Kein Kalorienwert hinterlegt.');

  return {
    product: {
      name: (raw?.product_name_de || raw?.product_name || '').trim() || null,
      brand: (raw?.brands || '').split(',')[0].trim() || null,
      barcode,
      protein_per_100g: protein,
      kcal_per_100g: kcal,
      default_serving_g: serving,
      source: 'openfoodfacts',
    },
    warnings,
  };
}

export default function offRoutes(db) {
  const r = Router();

  /**
   * Nachschlagen eines Barcodes. Antwortet immer mit HTTP 200 und einem
   * `found`-Flag, damit die App bei einem unbekannten Code direkt ins
   * manuelle Formular springen kann.
   *
   * Die Bibliothek wird zuerst gefragt: ein bereits erfasstes Produkt gewinnt
   * gegen die – teils luecken- und fehlerhaften – Daten von Open Food Facts.
   */
  r.get('/:barcode', h(async (req, res, next) => {
    try {
      const barcode = String(req.params.barcode).trim();
      if (!BARCODE.test(barcode)) throw bad('barcode muss 8–14 Ziffern haben');

      const known = db.prepare('SELECT * FROM products WHERE barcode = ?').get(barcode);
      if (known) {
        res.json({ found: true, source: 'library', barcode, existing_product: known, warnings: [] });
        return;
      }

      let response;
      try {
        response = await fetch(`${OFF_URL}/${barcode}.json?fields=${FIELDS}`, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
      } catch (cause) {
        throw new HttpError(
          502,
          'Open Food Facts ist gerade nicht erreichbar – das Produkt laesst sich manuell anlegen.'
        );
      }

      if (response.status === 404) {
        res.json({ found: false, source: 'openfoodfacts', barcode, warnings: [] });
        return;
      }
      if (!response.ok) {
        throw new HttpError(502, `Open Food Facts antwortete mit HTTP ${response.status}.`);
      }

      const body = await response.json();
      if (body.status !== 1 || !body.product) {
        res.json({ found: false, source: 'openfoodfacts', barcode, warnings: [] });
        return;
      }

      const mapped = mapOffProduct(body.product, barcode);
      res.json({ found: true, source: 'openfoodfacts', barcode, ...mapped });
    } catch (err) {
      next(err);
    }
  }));

  return r;
}
