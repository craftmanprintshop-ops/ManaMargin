// Port of the "MTGJSON AllPricesToday - Production" n8n workflow.
// 1. Truncates allprices_today via RPC
// 2. Downloads https://mtgjson.com/api/v5/AllPricesToday.json.gz
// 3. Picks the best price per (uuid, format, date) and upserts in batches.
// The dedupe/priority logic is lifted verbatim from the n8n embedded script.

import zlib from 'node:zlib';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const TABLE = 'allprices_today';
const BATCH_SIZE = 1000;
const ON_CONFLICT = 'uuid,format,price_date';
const POST_URL = `${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=${encodeURIComponent(ON_CONFLICT)}`;
const GZ_URL = 'https://mtgjson.com/api/v5/AllPricesToday.json.gz';

const HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=minimal',
};

function isPlainObject(x) {
  return x && typeof x === 'object' && !Array.isArray(x);
}

function toFiniteNumber(val) {
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.+-eE]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Priority (lower is better) to choose ONE best price per (uuid,format,date)
const providerPriorityPaper = ['tcgplayer', 'cardkingdom', 'cardsphere', 'cardmarket'];
const providerPriorityMtgo = ['cardhoarder'];
const priceTypePriority = ['retail', 'buylist'];
const finishPriority = ['normal', 'foil'];

function idxOrBig(arr, v) {
  const i = arr.indexOf(v);
  return i === -1 ? 999 : i;
}

function scoreCandidate(format, provider, priceType, finish) {
  const provArr = format === 'mtgo' ? providerPriorityMtgo : providerPriorityPaper;
  return (
    idxOrBig(provArr, provider) * 100 +
    idxOrBig(priceTypePriority, priceType) * 10 +
    idxOrBig(finishPriority, finish)
  );
}

async function postBatch(batch) {
  if (!batch.length) return;
  const res = await fetch(POST_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('POST failed:', res.status, t.slice(0, 800));
    process.exit(1);
  }
}

console.log('1) Truncating allprices_today via RPC...');
{
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/truncate_allprices_today`, {
    method: 'POST',
    headers: HEADERS,
    body: '{}',
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('Truncate RPC failed:', res.status, t.slice(0, 500));
    process.exit(1);
  }
}

console.log('2) Downloading', GZ_URL);
const gzRes = await fetch(GZ_URL, { signal: AbortSignal.timeout(600_000) });
if (!gzRes.ok) {
  console.error('Download failed:', gzRes.status);
  process.exit(1);
}
const gz = Buffer.from(await gzRes.arrayBuffer());
console.log(`   downloaded ${(gz.length / 1024 / 1024).toFixed(1)} MB`);

const jsonText = zlib.gunzipSync(gz).toString('utf8');
const root = JSON.parse(jsonText);

const data = root.data || {};
const uuids = Object.keys(data);
console.log('UUIDs in data:', uuids.length);

// best row per (uuid, format, date)
const best = new Map();
let skippedNonNumeric = 0;

function consider(uuid, format, provider, priceType, finish, date, currency, priceRaw) {
  const priceNum = toFiniteNumber(priceRaw);
  if (priceNum === null) {
    skippedNonNumeric++;
    return;
  }

  const key = `${uuid}|${format}|${date}`;
  const score = scoreCandidate(format, provider, priceType, finish);

  const prev = best.get(key);
  if (!prev || score < prev._score) {
    best.set(key, {
      uuid,
      format,
      price_date: date,
      currency: typeof currency === 'string' && currency ? currency : 'USD',
      price: priceNum,
      _score: score,
    });
  }
}

for (let i = 0; i < uuids.length; i++) {
  const uuid = uuids[i];
  const priceData = data[uuid];
  if (!isPlainObject(priceData)) continue;

  for (const format of ['paper', 'mtgo']) {
    const fmtObj = priceData[format];
    if (!isPlainObject(fmtObj)) continue;

    for (const [provider, providerData] of Object.entries(fmtObj)) {
      if (!isPlainObject(providerData)) continue;

      const currency = providerData.currency;

      for (const [priceType, priceTypeObj] of Object.entries(providerData)) {
        if (priceType === 'currency') continue;
        if (!isPlainObject(priceTypeObj)) continue;

        for (const [finish, finishObj] of Object.entries(priceTypeObj)) {
          if (!isPlainObject(finishObj)) continue;

          for (const [date, priceRaw] of Object.entries(finishObj)) {
            consider(uuid, format, provider, priceType, finish, date, currency, priceRaw);
          }
        }
      }
    }
  }

  if (i && i % 5000 === 0) {
    console.log(`...processed ${i}/${uuids.length}, deduped ${best.size}, skippedNonNumeric ${skippedNonNumeric}`);
  }
}

console.log('Deduped rows to upsert:', best.size);

let batch = [];
let posted = 0;

for (const row of best.values()) {
  delete row._score;
  batch.push(row);
  if (batch.length >= BATCH_SIZE) {
    const toSend = batch;
    batch = [];
    await postBatch(toSend);
    posted += toSend.length;
  }
}
if (batch.length) {
  await postBatch(batch);
  posted += batch.length;
}

console.log('COMPLETED! Upserted rows:', posted, 'Skipped non-numeric:', skippedNonNumeric);
