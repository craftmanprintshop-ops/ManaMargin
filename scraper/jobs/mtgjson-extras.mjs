// Port of the "MTGJSON Extras Import (Identifiers, Legalities, Prices)"
// n8n workflow (weekly). Downloads MTGJSON's CSV exports and loads them into
// allprintings_card_identifiers / _legalities / _prices.
//
// The original went through import RPCs, but those have hardcoded snake_case
// column lists while the tables (rebuilt at some point) use camelCase columns
// mirroring the CSV headers 1:1 — the RPCs 400 on every call, which is why
// this data went stale in January. This port upserts directly via PostgREST:
//   identifiers/legalities: upsert on uuid
//   prices: insert the new date's rows, then delete older dates (the table
//   holds a single-day snapshot; the CSV is one date per publication)
// allprintings_card_prices is what v_commander_deck_values (deck Value
// columns on the site) reads, so this going stale zeroes deck pricing.
// Idempotent — safe to re-run.

import zlib from 'node:zlib';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY;

const URLS = {
  cardIdentifiers: 'https://mtgjson.com/api/v5/csv/cardIdentifiers.csv.gz',
  cardLegalities: 'https://mtgjson.com/api/v5/csv/cardLegalities.csv.gz',
  cardPrices: 'https://mtgjson.com/api/v5/csv/cardPrices.csv.gz',
};

const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 500;
const PRICE_BATCH_SIZE = Number(process.env.PRICE_BATCH_SIZE) || 1000;
const ROW_LIMIT = Number(process.env.ROW_LIMIT) || 0; // testing: cap rows per file

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(csvText) {
  const lines = csvText.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return [];
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      const val = values[j];
      row[headers[j]] = val === '' || val === undefined ? null : val;
    }
    rows.push(row);
  }
  return rows;
}

async function fetchGzCSV(url) {
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const ab = await res.arrayBuffer();
  return zlib.gunzipSync(Buffer.from(ab)).toString('utf8');
}

function isTransient(err) {
  const m = String(err && err.message || err);
  return (
    m.includes('57014') || m.includes('timeout') ||
    m.includes(' 500') || m.includes(' 502') || m.includes(' 503') || m.includes(' 504') ||
    m.includes('fetch failed') || m.includes('ECONNRESET')
  );
}

async function withRetry(fn, label, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts || !isTransient(err)) throw err;
      console.warn(`  ${label} failed (attempt ${i}: ${String(err.message).slice(0, 160)}); backing off`);
      await sleep(3000 * i);
    }
  }
}

// Direct PostgREST write. `onConflict` makes it an upsert; without it, a
// plain insert.
async function postRows(table, rows, { onConflict } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/json',
      Prefer: `${onConflict ? 'resolution=merge-duplicates,' : ''}return=minimal`,
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${table} write ${res.status}: ${t.slice(0, 300)}`);
  }
}

// Delete price rows matching a date filter. Tries one statement; if the
// statement times out on a big table, falls back to uuid-prefix chunks.
async function deletePricesWhere(dateFilter) {
  const base = `${SUPABASE_URL}/rest/v1/allprintings_card_prices?date=${dateFilter}`;
  const doDelete = async (url) => {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`prices delete ${res.status}: ${t.slice(0, 300)}`);
    }
  };
  try {
    await withRetry(() => doDelete(base), `prices delete (${dateFilter})`, 2);
  } catch (err) {
    console.warn(`  full delete failed (${String(err.message).slice(0, 120)}); deleting in uuid-prefix chunks`);
    for (const prefix of '0123456789abcdef') {
      await withRetry(
        () => doDelete(`${base}&uuid=like.${prefix}*`),
        `prices delete (${dateFilter}, uuid ${prefix}*)`,
      );
    }
  }
}

const TABLE_FOR = {
  cardIdentifiers: 'allprintings_card_identifiers',
  cardLegalities: 'allprintings_card_legalities',
};

function toSnake(key) {
  return key.replace(/([A-Z])/g, '_$1').toLowerCase();
}

// MTGJSON adds new CSV columns over time; the import RPCs insert by column
// name and 400 on anything the table doesn't have. Fetch the table's actual
// columns and drop unknown CSV keys (warning once) so schema drift upstream
// can't break the import.
async function fetchTableColumns(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?limit=1`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`columns probe for ${table} -> ${res.status}`);
  const rows = await res.json();
  if (!rows.length) return null; // empty table: can't infer, skip filtering
  return new Set(Object.keys(rows[0]));
}

async function filterRowsToTable(rows, table) {
  const columns = await fetchTableColumns(table);
  if (!columns || rows.length === 0) return rows;
  const keys = Object.keys(rows[0]);
  const keep = keys.filter((k) => columns.has(toSnake(k)) || columns.has(k));
  const dropped = keys.filter((k) => !keep.includes(k));
  if (dropped.length) {
    console.warn(`   Dropping ${dropped.length} CSV column(s) not in ${table}: ${dropped.join(', ')}`);
  }
  if (!dropped.length) return rows;
  return rows.map((r) => {
    const out = {};
    for (const k of keep) out[k] = r[k];
    return out;
  });
}

async function importSimpleCSV(name, batchSize) {
  console.log(`--- Importing ${name} ---`);
  const csv = await fetchGzCSV(URLS[name]);
  let rows = parseCSV(csv);
  if (ROW_LIMIT > 0) rows = rows.slice(0, ROW_LIMIT);
  rows = await filterRowsToTable(rows, TABLE_FOR[name]);
  console.log(`   Parsed ${rows.length} rows`);

  const batches = chunkArray(rows, batchSize);
  let imported = 0;
  for (let i = 0; i < batches.length; i++) {
    await withRetry(() => postRows(TABLE_FOR[name], batches[i], { onConflict: 'uuid' }), name);
    imported += batches[i].length;
    if ((i + 1) % 50 === 0 || i === batches.length - 1) {
      console.log(`   Progress: ${imported}/${rows.length}`);
    }
  }
  console.log(`   ${name}: ${imported} rows imported`);
  return imported;
}

async function importCardPrices() {
  console.log('--- Importing cardPrices ---');
  // The current CSV is already long-format and matches the table columns
  // (cardFinish, currency, date, gameAvailability, price, priceProvider,
  // providerListing, uuid) — no expansion needed, unlike the old n8n script.
  const csv = await fetchGzCSV(URLS.cardPrices);
  let rows = parseCSV(csv).filter((r) => r.uuid && r.date && r.price);
  if (ROW_LIMIT > 0) rows = rows.slice(0, ROW_LIMIT);
  rows = await filterRowsToTable(rows, 'allprintings_card_prices');
  console.log(`   Parsed ${rows.length} price rows`);
  if (rows.length === 0) return 0;

  const newDate = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);
  console.log(`   Snapshot date: ${newDate}`);

  // Idempotency: clear any partial rows for this date from a previous
  // attempt, insert the new snapshot, then drop older dates.
  console.log('   Clearing any existing rows for this date...');
  await deletePricesWhere(`eq.${newDate}`);

  const batches = chunkArray(rows, PRICE_BATCH_SIZE);
  let imported = 0;
  for (let i = 0; i < batches.length; i++) {
    await withRetry(() => postRows('allprintings_card_prices', batches[i]), 'cardPrices');
    imported += batches[i].length;
    if ((i + 1) % 100 === 0 || i === batches.length - 1) {
      console.log(`   Progress: ${imported}/${rows.length}`);
    }
  }

  if (ROW_LIMIT > 0) {
    console.log('   ROW_LIMIT set — keeping older price snapshots (test mode).');
  } else {
    console.log('   Dropping older price snapshots...');
    await deletePricesWhere(`neq.${newDate}`);
  }

  console.log(`   cardPrices: ${imported} rows imported for ${newDate}`);
  return imported;
}

const T0 = Date.now();
console.log('MTGJSON Extras Import (Identifiers, Legalities, Prices)');
console.log(`Tuning: BATCH_SIZE=${BATCH_SIZE}, PRICE_BATCH_SIZE=${PRICE_BATCH_SIZE}${ROW_LIMIT ? `, ROW_LIMIT=${ROW_LIMIT}` : ''}`);

const results = {};
results.cardIdentifiers = await importSimpleCSV('cardIdentifiers', BATCH_SIZE);
results.cardLegalities = await importSimpleCSV('cardLegalities', BATCH_SIZE);
results.cardPrices = await importCardPrices();

console.log(`DONE in ${((Date.now() - T0) / 60000).toFixed(1)} minutes.`);
console.log(`   cardIdentifiers: ${results.cardIdentifiers}`);
console.log(`   cardLegalities: ${results.cardLegalities}`);
console.log(`   cardPrices: ${results.cardPrices}`);
