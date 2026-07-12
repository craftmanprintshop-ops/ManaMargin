// Port of the "MTGJSON Sealed Products Import" n8n workflow (manual/ad-hoc,
// last ran Feb 2026). Walks paper sets from 2020+ and upserts each set's
// sealedProduct catalog (canonical product names, category/subtype,
// marketplace ids, contents) into sealed_products, keyed by uuid.
// This is the ground-truth catalog for matching scraped offer titles to
// real products. Pure upserts — safe to re-run.

import zlib from 'node:zlib';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY;

const SET_LIST_URL = 'https://mtgjson.com/api/v5/SetList.json.gz';
const SET_URL = (code) => `https://mtgjson.com/api/v5/${encodeURIComponent(code)}.json.gz`;

const MIN_RELEASE = process.env.MIN_RELEASE || '1993-01-01';
const SET_LIMIT = Number(process.env.SET_LIMIT) || 0; // testing
const SET_CONCURRENCY = Number(process.env.SET_CONCURRENCY) || 4;

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

async function fetchGzJson(url) {
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const ab = await res.arrayBuffer();
  return JSON.parse(zlib.gunzipSync(Buffer.from(ab)).toString('utf8'));
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

async function upsertProducts(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sealed_products?on_conflict=uuid`, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`sealed_products upsert ${res.status}: ${t.slice(0, 300)}`);
  }
}

function mapProduct(p, set) {
  return {
    uuid: p.uuid,
    set_code: set.code.toUpperCase(),
    name: p.name,
    category: p.category || null,
    subtype: p.subtype || null,
    release_date: p.releaseDate || set.releaseDate || null,
    tcgplayer_product_id: p.identifiers?.tcgplayerProductId || null,
    cardkingdom_id: p.identifiers?.cardKingdomId || null,
    mcm_id: p.identifiers?.mcmId || null,
    contents: p.contents || null,
    identifiers: p.identifiers || null,
    purchase_urls: p.purchaseUrls || null,
    updated_at: new Date().toISOString(),
  };
}

async function runPool(items, worker, concurrency) {
  let idx = 0;
  async function runner() {
    while (true) {
      const myIdx = idx++;
      if (myIdx >= items.length) break;
      await worker(items[myIdx], myIdx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runner));
}

const T0 = Date.now();
console.log('MTGJSON Sealed Products Import');
console.log('1) Fetching SetList...');
const setListData = await fetchGzJson(SET_LIST_URL);
let paperSets = (setListData.data || []).filter(
  (s) => s.isOnlineOnly !== true && s.releaseDate && s.releaseDate >= MIN_RELEASE && s.code,
);
if (SET_LIMIT > 0) paperSets = paperSets.slice(0, SET_LIMIT);
console.log(`   Paper sets since ${MIN_RELEASE}: ${paperSets.length}`);

let setsProcessed = 0;
let productsProcessed = 0;
const errors = [];

await runPool(
  paperSets,
  async (set) => {
    try {
      const setData = await withRetry(() => fetchGzJson(SET_URL(set.code)), `fetch ${set.code}`);
      const d = setData.data;
      const products = d && Array.isArray(d.sealedProduct) ? d.sealedProduct.filter((p) => p.uuid && p.name) : [];
      if (products.length) {
        const rows = products.map((p) => mapProduct(p, set));
        for (const batch of chunkArray(rows, 100)) {
          await withRetry(() => upsertProducts(batch), `upsert ${set.code}`);
          productsProcessed += batch.length;
        }
      }
      setsProcessed++;
      if (setsProcessed % 50 === 0) {
        console.log(`   Progress: ${setsProcessed}/${paperSets.length} sets, ${productsProcessed} products`);
      }
    } catch (err) {
      errors.push(`${set.code}: ${err.message}`);
    }
  },
  SET_CONCURRENCY,
);

console.log(`DONE in ${((Date.now() - T0) / 60000).toFixed(1)} minutes.`);
console.log('   Sets processed:', setsProcessed);
console.log('   Products upserted:', productsProcessed);
if (errors.length) {
  console.error(`   Errors (${errors.length}):`);
  errors.slice(0, 10).forEach((e) => console.error(`   - ${e}`));
  process.exit(1);
}
