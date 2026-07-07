// Port of the "BotBox EV Calculations Scraper" n8n workflow.
// Fetches all pages of botbox.dev EV calculations and upserts them into the
// botbox_ev_calculations table (on_conflict: set_code,product_name).

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const BOTBOX_URL = 'https://botbox.dev/data/ev_calculations';
const UA = 'ManaMargin-n8n/1.0';
const PAGE_DELAY_MS = 500;
const BATCH_SIZE = 100;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(page) {
  const url = `${BOTBOX_URL}?page=${page}&per_page=200&sort_by=ev_to_price_ratio&order=desc`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`GET page ${page} -> ${res.status}`);
  return res.json();
}

async function upsertBatch(rows) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/botbox_ev_calculations?on_conflict=set_code,product_name`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(120_000),
    }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Upsert failed ${res.status}: ${t.slice(0, 500)}`);
  }
}

const first = await fetchPage(1);
const totalPages = first.pagination?.total_pages ?? 1;
const allItems = [...(first.calculations ?? [])];
console.log(`page 1/${totalPages}: ${allItems.length} items`);

for (let p = 2; p <= totalPages; p++) {
  await sleep(PAGE_DELAY_MS);
  const data = await fetchPage(p);
  const items = data.calculations ?? [];
  allItems.push(...items);
  console.log(`page ${p}/${totalPages}: ${items.length} items`);
}

const fetchedAt = new Date().toISOString();
const rows = allItems.map((item) => ({
  set_code: item.set_code,
  set_name: item.set_name || null,
  product_name: item.product_name,
  expected_value: item.expected_value,
  market_price: item.market_price,
  ev_to_price_ratio: item.ev_to_price_ratio,
  variance: item.variance,
  expected_value_eur: item.expected_value_eur,
  market_price_eur: item.market_price_eur,
  ev_to_price_ratio_eur: item.ev_to_price_ratio_eur,
  variance_eur: item.variance_eur,
  calculation_timestamp: item.calculation_timestamp,
  fetched_at: fetchedAt,
}));

for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  await upsertBatch(rows.slice(i, i + BATCH_SIZE));
}
console.log(`DONE. Upserted ${rows.length} rows.`);
