/**
 * Nachschlagen eines Barcodes bei Open Food Facts.
 *
 * Laeuft jetzt direkt im Geraet – Open Food Facts erlaubt Zugriffe aus dem
 * Browser. In der Android-App wird ein nativer HTTP-Aufruf hereingereicht,
 * der ohnehin keiner CORS-Regel unterliegt.
 */
import { AppError, bad } from './validate.js';

const BARCODE = /^\d{8,14}$/;
const BASE_URL = 'https://world.openfoodfacts.org/api/v2/product';
const SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
const FIELDS = [
  'code', 'product_name', 'product_name_de', 'brands', 'nutriments',
  'serving_size', 'serving_quantity', 'quantity',
].join(',');

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

export const isBarcode = (code) => BARCODE.test(String(code ?? '').trim());

/**
 * @param {object} deps
 * @param {(url: string) => Promise<{status: number, json: () => Promise<any>}>} deps.request
 *        Abrufmethode – im Browser `fetch`, in der App der native Ersatz.
 */
export async function lookupBarcode(barcode, { request } = {}) {
  const code = String(barcode ?? '').trim();
  if (!isBarcode(code)) throw bad('barcode muss 8–14 Ziffern haben');

  const url = `${BASE_URL}/${code}.json?fields=${FIELDS}`;

  let response;
  try {
    response = await request(url);
  } catch {
    throw new AppError(
      502,
      'Open Food Facts ist gerade nicht erreichbar – das Produkt laesst sich manuell anlegen.'
    );
  }

  if (response.status === 404) return { found: false, source: 'openfoodfacts', barcode: code, warnings: [] };
  if (response.status < 200 || response.status >= 300) {
    throw new AppError(502, `Open Food Facts antwortete mit HTTP ${response.status}.`);
  }

  const body = await response.json();
  if (body?.status !== 1 || !body?.product) {
    return { found: false, source: 'openfoodfacts', barcode: code, warnings: [] };
  }
  return { found: true, source: 'openfoodfacts', barcode: code, ...mapOffProduct(body.product, code) };
}

/**
 * Suche nach dem Namen, fuer Markenprodukte ohne Barcode zur Hand.
 *
 * Ergaenzt den eingebauten Grundstock, ersetzt ihn nicht: Grundzutaten sind
 * ohnehin lokal vorhanden, hier geht es um konkrete Produkte. Treffer ohne
 * Proteinwert kommen ans Ende und werden als solche gekennzeichnet – die
 * Datenlage bei Open Food Facts ist uneinheitlich.
 */
export async function searchByName(query, { request, limit = 20 } = {}) {
  const terms = String(query ?? '').trim();
  if (terms.length < 2) throw bad('Bitte mindestens zwei Zeichen eingeben.');

  const params = new URLSearchParams({
    search_terms: terms,
    search_simple: '1',
    action: 'process',
    json: '1',
    lc: 'de',
    page_size: String(Math.min(Math.max(limit, 1), 50)),
    fields: FIELDS,
  });

  let response;
  try {
    response = await request(`${SEARCH_URL}?${params}`);
  } catch {
    throw new AppError(
      502,
      'Open Food Facts ist gerade nicht erreichbar – das Produkt laesst sich manuell anlegen.'
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new AppError(502, `Open Food Facts antwortete mit HTTP ${response.status}.`);
  }

  const body = await response.json();
  const products = Array.isArray(body?.products) ? body.products : [];

  const results = products
    .map((raw) => mapOffProduct(raw, String(raw?.code ?? '').trim() || null))
    .filter((r) => r.product.name)
    .sort((a, b) => (b.product.protein_per_100g !== null) - (a.product.protein_per_100g !== null));

  return { query: terms, count: results.length, results };
}
