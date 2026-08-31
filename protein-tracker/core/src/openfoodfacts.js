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
