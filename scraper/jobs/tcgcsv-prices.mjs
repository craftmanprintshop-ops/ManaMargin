// Daily TCGplayer prices via TCGCSV (tcgcsv.com), the public daily mirror of
// TCGplayer's price API. Joins productIds to card uuids through
// allprintings_card_identifiers (tcgplayerProductId), upserts per-card prices
// into card_tcg_prices (uuid+finish), then aggregates per-deck totals into
// commander_deck_tcg_values for the Commander Decks page's TCG column.
// Pure upserts, safe to re-run.

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer/1'; // category 1 = Magic
const GROUP_CONCURRENCY = Number(process.env.GROUP_CONCURRENCY) || 8;
const GROUP_LIMIT = Number(process.env.GROUP_LIMIT) || 0; // testing

const HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

async function getJson(url) {
  // TCGCSV 401s requests without a browser-ish User-Agent
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ManaMargin/1.0; +https://manamargin.netlify.app)' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function getAllRows(pathBase, pageSize = 10000) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const res = await withRetry(
      () => fetch(`${SUPABASE_URL}/rest/v1/${pathBase}&limit=${pageSize}&offset=${offset}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(120_000),
      }),
      `fetch ${pathBase} @${offset}`,
    );
    if (!res.ok) throw new Error(`GET ${pathBase} -> ${res.status}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

async function upsert(table, rows, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
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
    throw new Error(`${table} upsert ${res.status}: ${t.slice(0, 300)}`);
  }
}

const T0 = Date.now();
console.log('TCGCSV daily price import');

console.log('1) Loading card identifiers (tcgplayerProductId -> uuid)...');
const idRows = await getAllRows('allprintings_card_identifiers?select=uuid,tcgplayerProductId&tcgplayerProductId=not.is.null');
const uuidsByProduct = new Map();
for (const r of idRows) {
  const pid = String(r.tcgplayerProductId);
  if (!uuidsByProduct.has(pid)) uuidsByProduct.set(pid, []);
  uuidsByProduct.get(pid).push(r.uuid);
}
console.log(`   ${idRows.length} cards with product ids (${uuidsByProduct.size} distinct products)`);

console.log('2) Fetching TCGCSV group list...');
const groupsData = await withRetry(() => getJson(`${TCGCSV_BASE}/groups`), 'groups');
let groups = groupsData.results || [];
if (GROUP_LIMIT > 0) groups = groups.slice(0, GROUP_LIMIT);
console.log(`   ${groups.length} groups`);

console.log('3) Fetching prices per group...');
const priceRows = [];
let groupsDone = 0;
{
  let idx = 0;
  await Promise.all(Array.from({ length: GROUP_CONCURRENCY }, async () => {
    while (true) {
      const i = idx++;
      if (i >= groups.length) break;
      const g = groups[i];
      try {
        const data = await withRetry(() => getJson(`${TCGCSV_BASE}/${g.groupId}/prices`), `group ${g.groupId}`);
        const now = new Date().toISOString();
        for (const p of data.results || []) {
          const uuids = uuidsByProduct.get(String(p.productId));
          if (!uuids) continue; // sealed products / non-card items
          const finish = String(p.subTypeName || 'Normal').toLowerCase() === 'foil' ? 'foil' : 'normal';
          for (const uuid of uuids) {
            priceRows.push({
              uuid,
              finish,
              tcgplayer_product_id: p.productId,
              market_price: p.marketPrice ?? null,
              low_price: p.lowPrice ?? null,
              mid_price: p.midPrice ?? null,
              direct_low: p.directLowPrice ?? null,
              updated_at: now,
            });
          }
        }
      } catch (err) {
        console.warn(`   group ${g.groupId} (${g.name}) failed: ${String(err.message).slice(0, 120)}`);
      }
      groupsDone++;
      if (groupsDone % 100 === 0) console.log(`   Groups: ${groupsDone}/${groups.length}, price rows so far: ${priceRows.length}`);
    }
  }));
}
console.log(`   Card price rows: ${priceRows.length}`);

// Dedupe on (uuid, finish) — keep the row with a market price if duplicated
const byKey = new Map();
for (const r of priceRows) {
  const key = `${r.uuid}|${r.finish}`;
  const prev = byKey.get(key);
  if (!prev || (prev.market_price == null && r.market_price != null)) byKey.set(key, r);
}
const rows = [...byKey.values()];
console.log(`   Deduped to ${rows.length} rows`);

console.log('4) Upserting card_tcg_prices...');
{
  const batches = chunkArray(rows, 1000);
  let done = 0;
  let idx = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (true) {
      const i = idx++;
      if (i >= batches.length) break;
      await withRetry(() => upsert('card_tcg_prices', batches[i], 'uuid,finish'), 'card prices batch');
      done += batches[i].length;
      if (i > 0 && i % 25 === 0) console.log(`   Upserted ~${done}/${rows.length}`);
    }
  }));
}

console.log('5) Aggregating commander deck TCG totals...');
const deckCards = await getAllRows('commander_deck_cards?select=deck_code,deck_file_name,uuid,count,is_foil&order=deck_code');
const deckNames = await getAllRows('commander_decks?select=code,file_name,name&order=code');
const nameByDeck = new Map(deckNames.map((d) => [`${d.code}|${d.file_name}`, d.name]));

const priceByKey = byKey; // uuid|finish -> row
const agg = new Map();
for (const dc of deckCards) {
  const deckName = nameByDeck.get(`${dc.deck_code}|${dc.deck_file_name}`);
  if (!deckName) continue;
  const key = `${dc.deck_code}|${deckName}`;
  if (!agg.has(key)) {
    agg.set(key, { deck_code: dc.deck_code, deck_name: deckName, tcg_market_total: 0, tcg_low_total: 0, cards_with_tcg: 0, card_count: 0 });
  }
  const a = agg.get(key);
  const count = dc.count || 1;
  a.card_count += count;
  const preferred = dc.is_foil ? 'foil' : 'normal';
  const fallback = dc.is_foil ? 'normal' : 'foil';
  const p = priceByKey.get(`${dc.uuid}|${preferred}`) || priceByKey.get(`${dc.uuid}|${fallback}`);
  if (p && (p.market_price != null || p.low_price != null)) {
    a.tcg_market_total += (p.market_price ?? p.low_price ?? 0) * count;
    a.tcg_low_total += (p.low_price ?? p.market_price ?? 0) * count;
    a.cards_with_tcg += count;
  }
}
const aggRows = [...agg.values()].map((a) => ({
  ...a,
  tcg_market_total: Number(a.tcg_market_total.toFixed(2)),
  tcg_low_total: Number(a.tcg_low_total.toFixed(2)),
  updated_at: new Date().toISOString(),
}));
console.log(`   Deck aggregates: ${aggRows.length}`);
for (const batch of chunkArray(aggRows, 500)) {
  await withRetry(() => upsert('commander_deck_tcg_values', batch, 'deck_code,deck_name'), 'deck aggregates');
}

console.log(`DONE in ${((Date.now() - T0) / 60000).toFixed(1)} minutes.`);
console.log('   Card price rows upserted:', rows.length);
console.log('   Deck totals upserted:', aggRows.length);
