// Auto-registers newly-announced MTG sets into known_sets, the lookup table
// the offer classifier fuzzy-matches retailer titles against.
//
// Why this exists: known_sets used to require a manual INSERT for every new
// set (see migration 021 for "The Hobbit"). Until that happens, every offer
// for the set gets set_name = NULL, a garbage product_type guess, and is
// marked classified = true -- meaning it's treated as done and never
// auto-retried, so the set is invisible on the Products page even though its
// offers/prices are being scraped correctly.
//
// MTGJSON's SetList typically lists a set well before its street date (WotC
// previews and retailer preorders both draw on the same public spoiler
// data), so syncing from SetList -- rather than waiting for a set to be
// "released" -- lets a set become classifiable as soon as it's publicly
// known, matching how retailers open preorders ahead of release.
//
// Run every 8h alongside the retailer scrapes (not just once daily with the
// full sets/cards import) so a new set is recognized within one scrape cycle
// instead of up to 24h: fetching SetList is cheap (small file, no card data).

import zlib from 'node:zlib';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

async function fetchGzJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
}

async function fetchKnownSetNames() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/known_sets?select=set_name&limit=5000`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`GET known_sets -> ${res.status}`);
  const rows = await res.json();
  return new Set(rows.map((r) => r.set_name));
}

async function insertKnownSet(name, type) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/known_sets`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify([{ set_name: name, set_type: type || 'expansion', aliases: [] }]),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`INSERT known_sets(${name}) -> ${res.status}: ${t.slice(0, 300)}`);
  }
}

async function resetClassificationForSet(name) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reset_classification_for_set`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_set_name: name }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`reset_classification_for_set(${name}) -> ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

console.log('1) Fetching MTGJSON SetList...');
const setListRoot = await fetchGzJson('https://mtgjson.com/api/v5/SetList.json.gz');
const entries = (setListRoot.data || []).filter((s) => s && s.name);
console.log(`   ${entries.length} sets in SetList`);

console.log('2) Loading known_sets...');
const known = await fetchKnownSetNames();
console.log(`   ${known.size} sets already known`);

const missing = entries.filter((e) => !known.has(e.name));
console.log(`3) New sets to register: ${missing.length}`);

let registered = 0;
let reclassified = 0;

for (const entry of missing) {
  try {
    await insertKnownSet(entry.name, entry.type);
    console.log(`   + ${entry.name} (${entry.type}, code=${entry.code})`);
    registered++;

    const affected = await resetClassificationForSet(entry.name);
    if (affected > 0) {
      console.log(`     reset classification on ${affected} existing offer(s)`);
      reclassified += affected;
    }
  } catch (err) {
    console.error(`   FAILED ${entry.name}: ${err.message.slice(0, 200)}`);
  }
}

console.log(`DONE. Registered ${registered} new set(s), reset classification on ${reclassified} offer(s).`);
