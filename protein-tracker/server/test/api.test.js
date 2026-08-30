import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { addDays } from '../src/targets.js';
import { mapOffProduct } from '../src/routes/off.js';

const TODAY = '2026-03-10';

async function withServer(run) {
  const db = openDb(':memory:');
  const server = http.createServer(createApp(db));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const api = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  try {
    await run({ api, db });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

test('zwei Profile sind ohne Einrichtung vorhanden', async () => {
  await withServer(async ({ api }) => {
    const { status, body } = await api('GET', '/api/users');
    assert.equal(status, 200);
    assert.equal(body.length, 2);
    assert.equal(body[0].factor_training, 2.0);
    assert.equal(body[0].factor_rest, 1.6);
  });
});

test('Produkt anlegen, suchen und per Barcode finden', async () => {
  await withServer(async ({ api }) => {
    const created = await api('POST', '/api/products', {
      name: 'Magerquark', brand: 'Milbona', barcode: '4056489123456',
      protein_per_100g: 12, kcal_per_100g: 67, default_serving_g: 250,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.source, 'manual');

    const search = await api('GET', '/api/products?q=quark');
    assert.equal(search.body.length, 1);
    assert.equal(search.body[0].use_count, 0);

    const byBarcode = await api('GET', '/api/products/barcode/4056489123456');
    assert.equal(byBarcode.status, 200);
    assert.equal(byBarcode.body.id, created.body.id);

    const dupe = await api('POST', '/api/products', { name: 'Anderer', barcode: '4056489123456', protein_per_100g: 5 });
    assert.equal(dupe.status, 409);
  });
});

test('Produkte ohne Proteinwert werden abgelehnt', async () => {
  await withServer(async ({ api }) => {
    const res = await api('POST', '/api/products', { name: 'Ohne Wert' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /protein_per_100g/);
  });
});

test('Tagesansicht summiert gegessen und geplant getrennt', async () => {
  await withServer(async ({ api }) => {
    const quark = (await api('POST', '/api/products', { name: 'Magerquark', protein_per_100g: 12 })).body;
    const shake = (await api('POST', '/api/products', { name: 'Whey', protein_per_100g: 80 })).body;

    await api('POST', '/api/log', { user_id: 1, date: TODAY, product_id: quark.id, amount_g: 250, status: 'eaten' });
    await api('POST', '/api/log', { user_id: 1, date: TODAY, product_id: shake.id, amount_g: 30, status: 'planned' });

    const day = (await api('GET', `/api/day?user_id=1&date=${TODAY}&today=${TODAY}`)).body;
    assert.equal(day.eaten_g, 30);    // 250 g * 12 %
    assert.equal(day.planned_g, 24);  // 30 g * 80 %
    assert.equal(day.target_g, 128);  // 80 kg * 1.6 (Ruhetag)
    assert.equal(day.remaining_g, 98);
    assert.equal(day.remaining_after_planned_g, 74);
    assert.equal(day.entries.length, 2);
  });
});

test('geplant laesst sich auf gegessen umschalten', async () => {
  await withServer(async ({ api }) => {
    const p = (await api('POST', '/api/products', { name: 'Whey', protein_per_100g: 80 })).body;
    const entry = (await api('POST', '/api/log', {
      user_id: 1, date: TODAY, product_id: p.id, amount_g: 30, status: 'planned',
    })).body;

    const updated = await api('PATCH', `/api/log/${entry.id}`, { status: 'eaten' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.status, 'eaten');

    const day = (await api('GET', `/api/day?user_id=1&date=${TODAY}&today=${TODAY}`)).body;
    assert.equal(day.eaten_g, 24);
    assert.equal(day.planned_g, 0);
  });
});

test('Trainings-Toggle hebt das heutige Ziel und senkt es wieder', async () => {
  await withServer(async ({ api }) => {
    const before = (await api('GET', `/api/day?user_id=1&date=${TODAY}&today=${TODAY}`)).body;
    assert.equal(before.target_g, 128);
    assert.equal(before.trained, false);

    const on = await api('PUT', '/api/workouts/toggle', { user_id: 1, date: TODAY });
    assert.equal(on.body.trained, true);
    assert.deepEqual(on.body.affects, [TODAY, addDays(TODAY, 1)]);

    const during = (await api('GET', `/api/day?user_id=1&date=${TODAY}&today=${TODAY}`)).body;
    assert.equal(during.target_g, 160);
    assert.equal(during.was_training_adjacent, true);

    // Der Folgetag zaehlt ebenfalls als trainingsnah.
    const tomorrow = (await api('GET', `/api/day?user_id=1&date=${addDays(TODAY, 1)}&today=${TODAY}`)).body;
    assert.equal(tomorrow.target_g, 160);
    assert.equal(tomorrow.trained, false);
    assert.equal(tomorrow.was_training_adjacent, true);

    const off = await api('PUT', '/api/workouts/toggle', { user_id: 1, date: TODAY });
    assert.equal(off.body.trained, false);
    assert.equal((await api('GET', `/api/day?user_id=1&date=${TODAY}&today=${TODAY}`)).body.target_g, 128);
  });
});

test('Vorlage loggt alle Positionen auf einmal', async () => {
  await withServer(async ({ api }) => {
    const milch = (await api('POST', '/api/products', { name: 'Milch', protein_per_100g: 3.4 })).body;
    const pulver = (await api('POST', '/api/products', { name: 'Proteinpulver', protein_per_100g: 80 })).body;
    const banane = (await api('POST', '/api/products', { name: 'Banane', protein_per_100g: 1.1 })).body;

    const tpl = await api('POST', '/api/templates', {
      name: 'Shake',
      items: [
        { product_id: milch.id, amount_g: 300 },
        { product_id: pulver.id, amount_g: 30 },
        { product_id: banane.id, amount_g: 120 },
      ],
    });
    assert.equal(tpl.status, 201);
    assert.equal(tpl.body.protein_g, 35.5); // 10.2 + 24 + 1.3

    const logged = await api('POST', `/api/templates/${tpl.body.id}/log`, {
      user_id: 1, date: TODAY, status: 'eaten',
    });
    assert.equal(logged.status, 201);
    assert.equal(logged.body.created, 3);

    const day = (await api('GET', `/api/day?user_id=1&date=${TODAY}&today=${TODAY}`)).body;
    assert.equal(day.eaten_g, 35.5);
    assert.equal(day.entries.length, 3);
  });
});

test('Produkte in Benutzung werden nicht geloescht', async () => {
  await withServer(async ({ api }) => {
    const p = (await api('POST', '/api/products', { name: 'Whey', protein_per_100g: 80 })).body;
    await api('POST', '/api/log', { user_id: 1, date: TODAY, product_id: p.id, amount_g: 30, status: 'eaten' });

    const res = await api('DELETE', `/api/products/${p.id}`);
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Historie/);
  });
});

test('Gewichtseintrag aktualisiert das Profilgewicht und damit das Ziel', async () => {
  await withServer(async ({ api }) => {
    await api('POST', '/api/users/1/weights', { user_id: 1, date: TODAY, weight_kg: 85 });
    const user = (await api('GET', '/api/users')).body.find((u) => u.id === 1);
    assert.equal(user.weight_kg, 85);

    const day = (await api('GET', `/api/day?user_id=1&date=${TODAY}&today=${TODAY}`)).body;
    assert.equal(day.weight_kg, 85);
    assert.equal(day.target_g, 136); // 85 * 1.6
  });
});

test('Verlauf liefert 7-Tage-Schnitt und Quote getrennt nach Tagtyp', async () => {
  await withServer(async ({ api }) => {
    const p = (await api('POST', '/api/products', { name: 'Protein', protein_per_100g: 100 })).body;

    // Sechs abgeschlossene Tage: an trainingsnahen Tagen wird das Ziel verfehlt,
    // an Ruhetagen erreicht.
    await api('POST', '/api/workouts', { user_id: 1, date: '2026-03-04' }); // 04. und 05. trainingsnah
    for (const [date, grams] of [
      ['2026-03-04', 140], ['2026-03-05', 140],
      ['2026-03-06', 130], ['2026-03-07', 130],
      ['2026-03-08', 130], ['2026-03-09', 130],
    ]) {
      await api('POST', '/api/log', { user_id: 1, date, product_id: p.id, amount_g: grams, status: 'eaten' });
    }

    const hist = (await api('GET', `/api/history?user_id=1&days=7&today=${TODAY}`)).body;
    assert.equal(hist.days.length, 7);
    assert.equal(hist.days.at(-1).date, TODAY);

    const training = hist.days.filter((d) => d.was_training_adjacent).map((d) => d.date);
    assert.deepEqual(training, ['2026-03-04', '2026-03-05']);

    assert.equal(hist.achievement.excludes_today, true);
    assert.equal(hist.achievement.training_adjacent.days, 2);
    assert.equal(hist.achievement.training_adjacent.hit, 0);  // 140 < 160
    assert.equal(hist.achievement.rest.hit, 4);               // 130 >= 128
    assert.equal(hist.achievement.rest.days, 4);

    // 7-Tage-Schnitt inklusive des leeren heutigen Tages.
    assert.equal(hist.rolling7.avg_eaten_g, round1((140 * 2 + 130 * 4) / 7));
    assert.equal(hist.rolling7.window_days, 7);
  });
});

const round1 = (n) => Math.round(n * 10) / 10;

test('Open-Food-Facts-Antworten werden robust gemappt', () => {
  const full = mapOffProduct({
    product_name: 'Skyr Natur', brands: 'Arla, Arla Foods',
    nutriments: { proteins_100g: 11, 'energy-kcal_100g': 63 },
    serving_size: '150 g',
  }, '5711953068904');
  assert.equal(full.product.name, 'Skyr Natur');
  assert.equal(full.product.brand, 'Arla');
  assert.equal(full.product.protein_per_100g, 11);
  assert.equal(full.product.default_serving_g, 150);
  assert.equal(full.warnings.length, 0);

  // Fehlender Proteinwert kommt bei Open Food Facts regelmaessig vor.
  const sparse = mapOffProduct({ product_name: 'Irgendwas', nutriments: {} }, '1234567890');
  assert.equal(sparse.product.protein_per_100g, null);
  assert.match(sparse.warnings[0], /Proteinwert/);
});

test('bekannte Barcodes werden aus der Bibliothek beantwortet, ohne Netzzugriff', async () => {
  await withServer(async ({ api }) => {
    await api('POST', '/api/products', { name: 'Skyr', barcode: '5711953068904', protein_per_100g: 11 });
    const res = await api('GET', '/api/off/5711953068904');
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'library');
    assert.equal(res.body.existing_product.name, 'Skyr');
  });
});

test('ungueltige Eingaben liefern verstaendliche Fehler', async () => {
  await withServer(async ({ api }) => {
    assert.equal((await api('GET', '/api/day?user_id=1&date=10.03.2026')).status, 400);
    assert.equal((await api('GET', '/api/day?user_id=99&date=2026-03-10')).status, 404);
    assert.equal((await api('GET', '/api/off/abc')).status, 400);
    assert.equal((await api('POST', '/api/log', { user_id: 1, date: TODAY, product_id: 999, amount_g: 10, status: 'eaten' })).status, 400);
    assert.equal((await api('POST', '/api/log', { user_id: 1, date: TODAY, product_id: 1, amount_g: 10, status: 'vielleicht' })).status, 400);
  });
});
