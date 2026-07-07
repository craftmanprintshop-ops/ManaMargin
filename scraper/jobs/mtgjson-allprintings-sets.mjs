// Port of the "MTGJSON AllPrintings Sets (delete cards + sets, reload sets)"
// n8n workflow. Truncates via RPC, fetches the MTGJSON SetList, then per set
// upserts the set row and imports its cards through the
// import_allprintings_cards RPC. Logic lifted verbatim from the n8n script.

import zlib from 'node:zlib';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY;

const SETS_TABLE = 'allprintings_sets';

const RPC_TRUNCATE_URL = `${SUPABASE_URL}/rest/v1/rpc/truncate_allprintings`;
const UPSERT_SETS_URL = `${SUPABASE_URL}/rest/v1/${SETS_TABLE}?on_conflict=code`;

// cards go through RPC to avoid statement_timeout
const RPC_IMPORT_CARDS_URL = `${SUPABASE_URL}/rest/v1/rpc/import_allprintings_cards`;

const SETLIST_GZ_URL = 'https://mtgjson.com/api/v5/SetList.json.gz';
const SETFILE_GZ_URL = (code) => `https://mtgjson.com/api/v5/${encodeURIComponent(code)}.json.gz`;

// Tuning (overridable via env; the job is network-latency-bound, so
// concurrency and batch size are the main speed levers)
const SET_CONCURRENCY = Number(process.env.SET_CONCURRENCY) || 6;
const CARD_RPC_BATCH = Number(process.env.CARD_RPC_BATCH) || 100;
const RETRIES = 3;

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

// Import a batch; if a large batch fails (e.g. statement timeout), fall back
// to smaller chunks of 25 before giving up.
async function rpcImportCardsSafe(rows) {
  try {
    await rpcImportCards(rows);
  } catch (err) {
    if (rows.length <= 25) throw err;
    console.warn(`  batch of ${rows.length} failed (${err.message.slice(0, 200)}); retrying in chunks of 25`);
    for (const part of chunkArray(rows, 25)) {
      await rpcImportCards(part);
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

console.log(`Tuning: SET_CONCURRENCY=${SET_CONCURRENCY}, CARD_RPC_BATCH=${CARD_RPC_BATCH}`);
console.log('1) Truncating via RPC (CASCADE)...');
await callRpcTruncate();
console.log('   Truncate done.');

console.log('2) Fetching SetList:', SETLIST_GZ_URL);
const setListRoot = await fetchGzJson(SETLIST_GZ_URL);
const list = setListRoot && setListRoot.data;
if (!Array.isArray(list)) throw new Error('Unexpected SetList: expected root.data array');

const codes = list.map((s) => s && s.code).filter(Boolean);
console.log('   Set codes:', codes.length);

let setsPosted = 0;
let cardsPosted = 0;

console.log('3) Downloading per-set files; upserting set first; then importing cards via RPC (concurrency =', SET_CONCURRENCY + ')');

await runPool(
  codes,
  async (code, i) => {
    const setObj = await fetchSetWithRetries(code);

    // upsert THIS set immediately (prevents FK violations)
    const setRow = mapSetToRow(setObj);
    if (setRow.code) {
      await upsertSets([setRow]);
      setsPosted += 1;
    }

    // cards via RPC for this set
    const cards = Array.isArray(setObj.cards) ? setObj.cards : [];
    if (cards.length) {
      const rows = [];
      for (const c of cards) {
        const row = mapCardToRow(c, setObj.code);
        if (row.uuid) rows.push(row);
      }
      for (const part of chunkArray(rows, CARD_RPC_BATCH)) {
        await rpcImportCardsSafe(part);
        cardsPosted += part.length;
      }
    }

    if ((i + 1) % 25 === 0) {
      console.log(`   Progress: sets=${i + 1}/${codes.length}, sets_upserted=${setsPosted}, cards_upserted=${cardsPosted}, elapsed=${elapsedMin()}min`);
    }
  },
  SET_CONCURRENCY
);

console.log(`DONE in ${elapsedMin()} minutes.`);
console.log('   Total sets upserted:', setsPosted);
console.log('   Total cards inserted/upserted:', cardsPosted);
