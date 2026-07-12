// Port of the "MTGJSON Commander Decks Import" n8n workflow (weekly).
// Fetches the MTGJSON DeckList, filters to Commander Decks, and upserts deck
// metadata into commander_decks and card lists into commander_deck_cards.
// Pure upserts (merge-duplicates) — no truncate, safe to re-run anytime.

import zlib from 'node:zlib';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const SUPABASE_KEY = SUPABASE_SERVICE_ROLE_KEY;

const DECK_LIST_URL = 'https://mtgjson.com/api/v5/DeckList.json.gz';
const DECK_URL = (fileName) => `https://mtgjson.com/api/v5/decks/${encodeURIComponent(fileName)}.json.gz`;

const CARD_BATCH = Number(process.env.CARD_BATCH) || 100;
const DECK_LIMIT = Number(process.env.DECK_LIMIT) || 0; // testing

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

async function upsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
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
    throw new Error(`${table} upsert failed ${res.status}: ${t.slice(0, 300)}`);
  }
}

function mapDeckCard(card, deck, isCommander) {
  return {
    deck_code: deck.code,
    deck_file_name: deck.fileName,
    uuid: card.uuid,
    card_name: card.name,
    count: card.count || 1,
    is_commander: isCommander,
    is_foil: card.isFoil || false,
    tcgplayer_product_id: card.identifiers?.tcgplayerProductId || null,
  };
}

const T0 = Date.now();

console.log('MTGJSON Commander Decks Import');
console.log('1) Fetching DeckList...');
const deckListData = await fetchGzJson(DECK_LIST_URL);
let commanderDecks = (deckListData.data || []).filter((d) => d.type === 'Commander Deck');
if (DECK_LIMIT > 0) commanderDecks = commanderDecks.slice(0, DECK_LIMIT);
console.log(`   Commander Decks found: ${commanderDecks.length}`);

let decksProcessed = 0;
let cardsProcessed = 0;
const errors = [];

for (const deck of commanderDecks) {
  try {
    const deckData = await withRetry(() => fetchGzJson(DECK_URL(deck.fileName)), `fetch ${deck.fileName}`);
    const d = deckData.data;
    if (!d) {
      errors.push(`No data for ${deck.fileName}`);
      continue;
    }

    const sealedUuid = d.sealedProductUuids && d.sealedProductUuids[0] ? d.sealedProductUuids[0] : null;

    await withRetry(() => upsert('commander_decks', [{
      code: deck.code,
      file_name: deck.fileName,
      name: d.name || deck.name,
      release_date: deck.releaseDate || null,
      type: deck.type,
      sealed_product_uuid: sealedUuid,
    }]), `deck upsert ${deck.fileName}`);

    const cardRows = [];
    const seen = new Set();
    for (const card of Array.isArray(d.commander) ? d.commander : []) {
      if (!card.uuid || seen.has(card.uuid)) continue;
      seen.add(card.uuid);
      cardRows.push(mapDeckCard(card, deck, true));
    }
    for (const card of Array.isArray(d.mainBoard) ? d.mainBoard : []) {
      if (!card.uuid || seen.has(card.uuid)) continue;
      seen.add(card.uuid);
      cardRows.push(mapDeckCard(card, deck, false));
    }

    for (const batch of chunkArray(cardRows, CARD_BATCH)) {
      await withRetry(() => upsert('commander_deck_cards', batch), `cards batch ${deck.fileName}`);
      cardsProcessed += batch.length;
    }

    decksProcessed++;
    if (decksProcessed % 25 === 0) {
      console.log(`   Progress: ${decksProcessed}/${commanderDecks.length} decks, ${cardsProcessed} cards, ${((Date.now() - T0) / 60000).toFixed(1)}min`);
    }
    await sleep(50);
  } catch (err) {
    errors.push(`${deck.fileName}: ${err.message}`);
  }
}

console.log(`DONE in ${((Date.now() - T0) / 60000).toFixed(1)} minutes.`);
console.log('   Decks processed:', decksProcessed);
console.log('   Cards processed:', cardsProcessed);
if (errors.length) {
  console.error(`   Errors (${errors.length}):`);
  errors.slice(0, 10).forEach((e) => console.error(`   - ${e}`));
  if (errors.length > 10) console.error(`   ... and ${errors.length - 10} more`);
  process.exit(1);
}
