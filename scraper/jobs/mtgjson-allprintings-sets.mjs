// MTGJSON AllPrintings incremental import.
//
// Replaces the old truncate-and-reload port of the n8n workflow. That version
// truncated allprintings_sets/_cards, then re-imported all ~865 sets over ~2h;
// when Supabase RPC calls started 504ing under the load, the job died partway
// and left the site missing whichever sets hadn't loaded yet.
//
// This version never truncates. Per set it decides whether an import is
// needed (new set, size changed, recent release, or a previous run didn't
// finish it), then does delete-cards + insert-cards for just that set. A
// success marker is stored in plain columns (import_card_rows,
// import_source_total, import_completed_at) only after the set's cards are
// fully imported, so a crash at any point leaves at most one set to be
// redone on the next run — never a wiped database. (Previously this lived
// under raw->_import; that key was observed disappearing about a day after
// being written for reasons never identified, see migration 020.)
//
// Env knobs:
//   SET_CONCURRENCY (default 3), CARD_RPC_BATCH (default 50)
//   SET_LIMIT       process only the first N SetList entries (testing)
//   FULL_RELOAD=1   truncate first and re-import everything (old behavior)

import zlib from 'node:zlib';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY;

const SETS_TABLE = 'allprintings_sets';
const CARDS_TABLE = 'allprintings_cards';

const RPC_TRUNCATE_URL = `${SUPABASE_URL}/rest/v1/rpc/truncate_allprintings`;
const UPSERT_SETS_URL = `${SUPABASE_URL}/rest/v1/${SETS_TABLE}?on_conflict=code`;

// cards go through RPC to avoid statement_timeout
const RPC_IMPORT_CARDS_URL = `${SUPABASE_URL}/rest/v1/rpc/import_allprintings_cards`;

const SETLIST_GZ_URL = 'https://mtgjson.com/api/v5/SetList.json.gz';
const SETFILE_GZ_URL = (code) => `https://mtgjson.com/api/v5/${encodeURIComponent(code)}.json.gz`;

const SET_CONCURRENCY = Number(process.env.SET_CONCURRENCY) || 3;
const CARD_RPC_BATCH = Number(process.env.CARD_RPC_BATCH) || 50;
const SET_LIMIT = Number(process.env.SET_LIMIT) || 0;
const FULL_RELOAD = process.env.FULL_RELOAD === '1';
const RETRIES = 3;

// Sets released within this window (or in the future) are refreshed every
// run, since MTGJSON keeps adding spoiled/promo cards to them.
const RECENT_SET_WINDOW_DAYS = 60;
// ...but at most once per this many hours (lets a rerun on the same day skip them).
const RECENT_REFRESH_HOURS = 20;

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function isPlainObject(x) {
  return x && typeof x === 'object' && !Array.isArray(x);
}

function toTextOrNull(v) {
  return typeof v === 'string' && v.length ? v : null;
}
function toNumOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function toBoolOrNull(v) {
  return typeof v === 'boolean' ? v : null;
}
function toArrOrNull(v) {
  return Array.isArray(v) ? v : null;
}
function toUuidOrNull(v) {
  if (typeof v !== 'string') return null;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v) ? v : null;
}
function toDateOrNull(v) {
  return typeof v === 'string' && v.length >= 8 ? v : null;
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
  const buf = Buffer.from(ab);
  const jsonText = zlib.gunzipSync(buf).toString('utf8');
  return JSON.parse(jsonText);
}

function isTransient(err) {
  const m = String(err && err.message || err);
  return (
    m.includes('57014') || // statement timeout
    m.includes('timeout') ||
    m.includes(' 500') || m.includes(' 502') || m.includes(' 503') || m.includes(' 504') ||
    m.includes('fetch failed') ||
    m.includes('ECONNRESET')
  );
}

// Generic retry with linear backoff for transient Supabase/network errors.
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

async function callRpcTruncate() {
  const res = await fetch(RPC_TRUNCATE_URL, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`RPC truncate failed ${res.status}: ${t.slice(0, 1200)}`);
  }
}

async function upsertSets(rows) {
  const res = await fetch(UPSERT_SETS_URL, {
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
    throw new Error(`SETS UPSERT failed ${res.status}: ${t.slice(0, 1200)}`);
  }
}

async function deleteSetCards(code) {
  const url = `${SUPABASE_URL}/rest/v1/${CARDS_TABLE}?set_code=eq.${encodeURIComponent(code)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`CARDS DELETE (${code}) failed ${res.status}: ${t.slice(0, 1200)}`);
  }
}

async function rpcImportCards(rows) {
  const res = await fetch(RPC_IMPORT_CARDS_URL, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ _rows: rows }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`CARDS RPC failed ${res.status}: ${t.slice(0, 1200)}`);
  }
}

// Import a batch with retries; if a large batch still fails, fall back to
// chunks of 25 before giving up.
async function rpcImportCardsSafe(rows) {
  try {
    await withRetry(() => rpcImportCards(rows), `batch of ${rows.length}`);
  } catch (err) {
    if (rows.length <= 25) throw err;
    console.warn(`  batch of ${rows.length} failed (${err.message.slice(0, 200)}); retrying in chunks of 25`);
    for (const part of chunkArray(rows, 25)) {
      await withRetry(() => rpcImportCards(part), `chunk of ${part.length}`);
    }
  }
}

async function fetchSetWithRetries(code) {
  let lastErr;
  for (let i = 1; i <= RETRIES; i++) {
    try {
      const root = await fetchGzJson(SETFILE_GZ_URL(code));
      const setObj = root && root.data;
      if (!isPlainObject(setObj)) throw new Error(`Bad set data for ${code}`);
      return setObj;
    } catch (e) {
      lastErr = e;
      await sleep(500 * i);
    }
  }
  throw lastErr;
}

// Fetch existing set rows with their import markers. Plain typed columns
// (import_card_rows / import_source_total / import_completed_at), not a
// buried raw->_import jsonb key -- that key was observed going missing about
// a day after being written, for reasons never identified (see migration
// 020). Plain columns are a sturdier, independently-checkable alternative.
async function fetchDbSetMarkers() {
  const url = `${SUPABASE_URL}/rest/v1/${SETS_TABLE}?select=code,total_set_size,import_card_rows,import_source_total,import_completed_at&limit=5000`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(300_000) });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`SETS GET failed ${res.status}: ${t.slice(0, 1200)}`);
  }
  const rows = await res.json();
  return new Map(rows.map((r) => [r.code, r]));
}

// Trim set raw (keep small)
const STORE_FULL_SET_RAW = false;
function trimmedSetRaw(setObj) {
  if (STORE_FULL_SET_RAW) return setObj;
  const raw = { ...setObj };
  delete raw.cards;
  delete raw.tokens;
  delete raw.sealedProduct;
  delete raw.booster;
  delete raw.translations;
  return raw;
}

function mapSetToRow(setObj) {
  return {
    code: toTextOrNull(setObj.code),
    name: toTextOrNull(setObj.name),
    release_date: toDateOrNull(setObj.releaseDate),
    set_type: toTextOrNull(setObj.type),
    block: toTextOrNull(setObj.block),
    parent_code: toTextOrNull(setObj.parentCode),
    base_set_size: setObj.baseSetSize ?? null,
    total_set_size: setObj.totalSetSize ?? null,
    is_foil_only: toBoolOrNull(setObj.isFoilOnly),
    is_nonfoil_only: toBoolOrNull(setObj.isNonFoilOnly),
    is_online_only: toBoolOrNull(setObj.isOnlineOnly),
    is_paper_only: toBoolOrNull(setObj.isPaperOnly),
    keyrune_code: toTextOrNull(setObj.keyruneCode),
    scryfall_id: toUuidOrNull(setObj.scryfallId),
    mtgo_code: toTextOrNull(setObj.mtgoCode),
    tcgplayer_group_id: setObj.tcgplayerGroupId ?? null,
    raw: trimmedSetRaw(setObj),
  };
}

function mapCardToRow(cardObj, setCode) {
  const finishes = Array.isArray(cardObj.finishes) ? cardObj.finishes : [];
  const hasFoil = typeof cardObj.hasFoil === 'boolean' ? cardObj.hasFoil : finishes.includes('foil');
  const hasNonFoil = typeof cardObj.hasNonFoil === 'boolean' ? cardObj.hasNonFoil : finishes.includes('nonfoil');

  return {
    uuid: toUuidOrNull(cardObj.uuid),
    set_code: toTextOrNull(setCode),
    number: toTextOrNull(cardObj.number || cardObj.collectorNumber),
    name: toTextOrNull(cardObj.name),
    face_name: toTextOrNull(cardObj.faceName),
    layout: toTextOrNull(cardObj.layout),
    rarity: toTextOrNull(cardObj.rarity),
    mana_cost: toTextOrNull(cardObj.manaCost),
    cmc: toNumOrNull(cardObj.cmc ?? cardObj.convertedManaCost),
    colors: toArrOrNull(cardObj.colors),
    color_identity: toArrOrNull(cardObj.colorIdentity),
    types: toArrOrNull(cardObj.types),
    supertypes: toArrOrNull(cardObj.supertypes),
    subtypes: toArrOrNull(cardObj.subtypes),
    finishes: toArrOrNull(cardObj.finishes),
    artist: toTextOrNull(cardObj.artist),
    power: toTextOrNull(cardObj.power),
    toughness: toTextOrNull(cardObj.toughness),
    loyalty: toTextOrNull(cardObj.loyalty),
    text: toTextOrNull(cardObj.text),
    flavor_text: toTextOrNull(cardObj.flavorText),
    frame_version: toTextOrNull(cardObj.frameVersion),
    identifiers: isPlainObject(cardObj.identifiers) ? cardObj.identifiers : null,
    legalities: isPlainObject(cardObj.legalities) ? cardObj.legalities : null,
    purchase_urls: isPlainObject(cardObj.purchaseUrls) ? cardObj.purchaseUrls : null,
    other_face_ids: toArrOrNull(cardObj.otherFaceIds),
    raw: cardObj,
    side: toTextOrNull(cardObj.side),
    type_line: toTextOrNull(cardObj.type || cardObj.typeLine),
    edhrec_saltiness: toNumOrNull(cardObj.edhrecSaltiness),
    keywords: cardObj.keywords ?? null,
    has_foil: hasFoil,
    has_non_foil: hasNonFoil,
    frame_effects: cardObj.frameEffects ?? null,
    security_stamp: toTextOrNull(cardObj.securityStamp),
    foreign_data: cardObj.foreignData ?? null,
    leadership_skills: cardObj.leadershipSkills ?? null,
    related_cards: cardObj.relatedCards ?? null,
    collector_number: toTextOrNull(cardObj.collectorNumber),
    mana_value: toNumOrNull(cardObj.manaValue),
  };
}

// Decide whether a SetList entry needs (re)import. Returns a reason string
// or null to skip.
function importReason(entry, dbRow, now) {
  if (FULL_RELOAD) return 'full reload';
  if (!dbRow) return 'new set';
  if (typeof dbRow.import_card_rows !== 'number') return 'no completed import on record';
  if ((dbRow.import_source_total ?? null) !== (entry.totalSetSize ?? null)) {
    return `set size changed (${dbRow.import_source_total} -> ${entry.totalSetSize})`;
  }
  const rel = entry.releaseDate ? Date.parse(entry.releaseDate) : NaN;
  const isRecentOrUpcoming = !Number.isNaN(rel) && now - rel < RECENT_SET_WINDOW_DAYS * 86_400_000;
  if (isRecentOrUpcoming) {
    const impAt = dbRow.import_completed_at ? Date.parse(dbRow.import_completed_at) : 0;
    if (now - impAt > RECENT_REFRESH_HOURS * 3_600_000) return 'recent set refresh';
  }
  return null;
}

// Import one set: upsert set row, delete+insert its cards, then stamp the
// success marker. The delete+insert pair is retried as a unit so a partially
// committed insert can never leave duplicates behind.
async function importSet(entry) {
  const setObj = await fetchSetWithRetries(entry.code);
  const setRow = mapSetToRow(setObj);
  if (!setRow.code) return 0;

  await withRetry(() => upsertSets([setRow]), `set upsert ${setRow.code}`);

  const cards = Array.isArray(setObj.cards) ? setObj.cards : [];
  const rows = [];
  for (const c of cards) {
    const row = mapCardToRow(c, setObj.code);
    if (row.uuid) rows.push(row);
  }

  for (let attempt = 1; ; attempt++) {
    try {
      await withRetry(() => deleteSetCards(setRow.code), `cards delete ${setRow.code}`);
      for (const part of chunkArray(rows, CARD_RPC_BATCH)) {
        await rpcImportCardsSafe(part);
      }
      break;
    } catch (err) {
      if (attempt >= 2) throw err;
      console.warn(`  set ${setRow.code}: import failed (${String(err.message).slice(0, 160)}); redoing delete+insert`);
      await sleep(5000);
    }
  }

  // Marker written only after every card batch committed. Plain columns,
  // not the old raw->_import jsonb key -- see fetchDbSetMarkers().
  setRow.import_card_rows = rows.length;
  setRow.import_source_total = entry.totalSetSize ?? null;
  setRow.import_completed_at = new Date().toISOString();
  await withRetry(() => upsertSets([setRow]), `marker upsert ${setRow.code}`);
  return rows.length;
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
const elapsedMin = () => ((Date.now() - T0) / 60000).toFixed(1);

console.log(`Tuning: SET_CONCURRENCY=${SET_CONCURRENCY}, CARD_RPC_BATCH=${CARD_RPC_BATCH}, FULL_RELOAD=${FULL_RELOAD}`);

if (FULL_RELOAD) {
  console.log('1) FULL_RELOAD: truncating via RPC (CASCADE)...');
  await callRpcTruncate();
  console.log('   Truncate done.');
}

console.log('1) Fetching SetList:', SETLIST_GZ_URL);
const setListRoot = await fetchGzJson(SETLIST_GZ_URL);
const list = setListRoot && setListRoot.data;
if (!Array.isArray(list)) throw new Error('Unexpected SetList: expected root.data array');

let entries = list.filter((s) => s && s.code);
if (SET_LIMIT > 0) entries = entries.slice(0, SET_LIMIT);
console.log('   Sets in SetList:', entries.length);

console.log('2) Reading existing set markers from DB...');
const dbSets = FULL_RELOAD ? new Map() : await fetchDbSetMarkers();
console.log('   Sets already in DB:', dbSets.size);

const now = Date.now();
const toImport = [];
for (const entry of entries) {
  const reason = importReason(entry, dbSets.get(entry.code), now);
  if (reason) toImport.push({ entry, reason });
}
console.log(`3) Sets needing import: ${toImport.length} of ${entries.length}`);
for (const { entry, reason } of toImport.slice(0, 40)) {
  console.log(`   - ${entry.code}: ${reason}`);
}
if (toImport.length > 40) console.log(`   ... and ${toImport.length - 40} more`);

let setsImported = 0;
let cardsImported = 0;
const failures = [];

async function importWithLogging({ entry, reason }) {
  const n = await importSet(entry);
  setsImported += 1;
  cardsImported += n;
  if (setsImported % 25 === 0) {
    console.log(`   Progress: sets=${setsImported}/${toImport.length}, cards=${cardsImported}, elapsed=${elapsedMin()}min`);
  }
}

await runPool(
  toImport,
  async (item) => {
    try {
      await importWithLogging(item);
    } catch (err) {
      console.error(`   FAILED ${item.entry.code}: ${String(err.message).slice(0, 300)}`);
      failures.push(item);
    }
  },
  SET_CONCURRENCY
);

if (failures.length) {
  console.log(`4) Retrying ${failures.length} failed set(s) sequentially...`);
  const still = [];
  for (const item of failures) {
    try {
      await importWithLogging(item);
    } catch (err) {
      console.error(`   FAILED AGAIN ${item.entry.code}: ${String(err.message).slice(0, 300)}`);
      still.push(item);
    }
  }
  failures.length = 0;
  failures.push(...still);
}

console.log(`DONE in ${elapsedMin()} minutes.`);
console.log('   Sets imported:', setsImported);
console.log('   Cards imported:', cardsImported);
if (failures.length) {
  console.error('   Unrecovered sets:', failures.map((f) => f.entry.code).join(', '));
  console.error('   (Database remains consistent; these will be retried on the next run.)');
  process.exit(1);
}
