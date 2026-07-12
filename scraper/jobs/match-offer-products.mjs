// Match scraped offer titles to canonical MTGJSON sealed products.
//
// Reads distinct titles from offers_latest_enriched_mv, matches each against
// the sealed_products catalog for its set, and records the result in
// offer_product_matches keyed by normalized title. Titles already matched are
// skipped (REMATCH=1 to redo them; rows with verified=true are never touched),
// so routine runs only process titles new since the last scrape.
//
// Matching rules (most important first):
//   1. Candidates are limited to the offer's set (via set_name, else the
//      longest set name found in the title).
//   2. Qualifier agreement: discriminator words (collector, play, set, draft,
//      jumpstart, gift, japanese, ...) must match EXACTLY in both directions —
//      presence and absence. "Booster Box" can never match "Collector
//      Booster Box" and vice versa.
//   3. Base product nouns (booster/box/bundle/deck/pack/case/kit) must
//      overlap.
//   4. Survivors are scored by token overlap; ambiguous ties are recorded as
//      unmatched rather than guessed.

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const REMATCH = process.env.REMATCH === '1';
const REPORT_LIMIT = Number(process.env.REPORT_LIMIT) || 30;

const HEADERS = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function get(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GET ${path} -> ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function getAll(pathBase, pageSize = 10000) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await get(`${pathBase}&limit=${pageSize}&offset=${offset}`);
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

async function upsertMatches(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/offer_product_matches?on_conflict=title_norm`, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`matches upsert ${res.status}: ${t.slice(0, 300)}`);
  }
}

// --- normalization ---

const NOISE = new Set([
  'mtg', 'magic', 'gathering', 'tcg', 'ccg', 'sealed', 'new', 'nib', 'brand',
  'factory', 'english', 'en', 'edition', 'the', 'of', 'a', 'an', 'and',
  'presale', 'preorder', 'pre', 'order', 'in', 'stock', 'free', 'shipping',
]);

const SYNONYM = {
  boosters: 'booster', boxes: 'box', bundles: 'bundle', packs: 'pack',
  decks: 'deck', displays: 'box', display: 'box', kits: 'pack', kit: 'pack',
  cases: 'case', collectors: 'collector', "collector's": 'collector',
  jp: 'japanese', japan: 'japanese', cb: 'collector',
};

// Words that distinguish otherwise-similar products. Presence/absence must
// agree exactly between title and candidate.
const QUALIFIERS = new Set([
  'collector', 'play', 'set', 'draft', 'jumpstart', 'gift', 'japanese',
  'prerelease', 'commander', 'starter', 'beginner', 'welcome', 'theme',
  'case', 'anthology',
]);

// Container nouns — like qualifiers, presence/absence must agree exactly:
// a "Booster Box" title must never match a "Booster Pack" product.
// 'booster' itself stays generic (it appears on both sides of most pairs).
const BASE_NOUNS = new Set(['box', 'bundle', 'deck', 'pack', 'case', 'tin', 'scene']);

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    // Retailer bundle phrasings -> MTGJSON's "Commander Decks Set of N":
    // "Commander Deck Display (4 Decks)" / "Commander Deck (Set of 4)"
    .replace(/commander decks? (display|case)\b/g, 'commander deck set')
    .replace(/\(\s*set of (\d+)[^)]*\)/g, ' set of $1 ')
    .replace(/\(\s*(\d+)\s*decks?\s*\)/g, ' set of $1 ')
    // drop remaining count parentheticals — "(36 Packs)" — which would
    // otherwise inject container nouns that break strict agreement
    .replace(/\([^)]*\d[^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9']+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SYNONYM[w] || w)
    .filter((w) => !NOISE.has(w));
}

function qualifierSet(tokens) {
  return new Set(tokens.filter((t) => QUALIFIERS.has(t)));
}

function setEquals(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function jaccard(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

// --- main ---

console.log('Offer -> sealed product matcher');

console.log('1) Loading sealed products catalog...');
const products = await getAll('sealed_products?select=uuid,set_code,name,category,subtype&order=uuid');
console.log(`   ${products.length} products`);

console.log('2) Loading set names...');
const sets = await getAll('allprintings_sets?select=code,name,parent_code&order=code');
const setNameByCode = new Map(sets.map((s) => [s.code.toUpperCase(), s.name || '']));
const codeByNormName = new Map();
for (const s of sets) {
  if (s.name) codeByNormName.set(normalize(s.name).join(' '), s.code.toUpperCase());
}

// Set families: a title saying "Aetherdrift ... Commander Deck" matches
// products filed under the child set (DRC, parent DFT). Candidates are drawn
// from the whole family: the set itself, its parent, and all siblings/children.
const familyOf = new Map();
{
  const rootOf = (code) => {
    const s = sets.find((x) => x.code.toUpperCase() === code);
    return s && s.parent_code ? s.parent_code.toUpperCase() : code;
  };
  const byRoot = new Map();
  for (const s of sets) {
    const code = s.code.toUpperCase();
    const root = rootOf(code);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(code);
  }
  for (const [root, members] of byRoot) {
    const family = [...new Set([root, ...members])];
    for (const code of family) familyOf.set(code, family);
  }
}

// Pre-normalize catalog, grouped by set, with set-name tokens removed from
// the product tokens (titles repeat the set name; it shouldn't dominate the
// score).
const productsBySet = new Map();
for (const p of products) {
  const setTokens = new Set(normalize(setNameByCode.get(p.set_code) || ''));
  const tokens = normalize(p.name).filter((t) => !setTokens.has(t));
  const entry = {
    ...p,
    setTokens,
    tokens,
    qualifiers: qualifierSet(tokens),
    nouns: new Set(tokens.filter((t) => BASE_NOUNS.has(t))),
  };
  if (!productsBySet.has(p.set_code)) productsBySet.set(p.set_code, []);
  productsBySet.get(p.set_code).push(entry);
}

console.log('3) Loading distinct offer titles...');
const offers = await getAll('offers_latest_enriched_mv?select=title,set_name&order=title');
const titleMap = new Map();
for (const o of offers) {
  if (!o.title) continue;
  const norm = normalize(o.title).join(' ');
  if (norm && !titleMap.has(norm)) titleMap.set(norm, o);
}
console.log(`   ${offers.length} offers -> ${titleMap.size} distinct normalized titles`);

console.log('4) Loading existing matches...');
if (REMATCH) {
  // Normalization changes can alter title_norm keys, stranding old rows —
  // purge everything non-verified and rebuild from scratch.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/offer_product_matches?verified=is.false`, {
    method: 'DELETE',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`purge failed ${res.status}`);
  console.log('   REMATCH: purged non-verified rows');
}
const existing = REMATCH
  ? await getAll('offer_product_matches?select=title_norm,verified&verified=is.true&order=title_norm')
  : await getAll('offer_product_matches?select=title_norm,verified&order=title_norm');
const skip = new Set(existing.map((r) => r.title_norm));
console.log(`   ${skip.size} titles already decided${REMATCH ? ' (verified only — rematching the rest)' : ''}`);

// Sort set names longest-first for title-based set detection
const setNamesByLength = [...codeByNormName.keys()].filter(Boolean).sort((a, b) => b.length - a.length);

// Normalized set names that are too generic to detect inside a title
const GENERIC_SET_NAMES = new Set([
  'unlimited', 'legends', 'revised', 'portal', 'chronicles', 'renaissance',
  'anthologies', 'commander', 'jumpstart', 'unglued', 'prophecy', 'legions',
]);

function findSetCode(titleNorm, setName) {
  if (setName) {
    const code = codeByNormName.get(normalize(setName).join(' '));
    if (code) return code;
  }
  const padded = ` ${titleNorm} `;
  for (const name of setNamesByLength) {
    // Skip set names that are generic English words — "Unlimited" matches
    // "Monarch Unlimited (Flesh and Blood)", which is not Unlimited Edition.
    // Distinctive one-worders (Aetherdrift, Bloomburrow, ...) stay scannable;
    // generic ones can still match via the classified set_name field above.
    if (GENERIC_SET_NAMES.has(name)) continue;
    if (name.length < 4) continue;
    if (padded.includes(` ${name} `)) return codeByNormName.get(name);
  }
  return null;
}

let matched = 0;
let unmatchedNoSet = 0;
let unmatchedNoCandidate = 0;
let ambiguous = 0;
const pending = [];
const unmatchedSamples = [];

for (const [titleNorm, offer] of titleMap) {
  if (skip.has(titleNorm)) continue;

  const record = {
    title_norm: titleNorm,
    raw_title: offer.title.slice(0, 500),
    set_name: offer.set_name || null,
    sealed_product_uuid: null,
    method: 'unmatched',
    score: null,
  };

  const setCode = findSetCode(titleNorm, offer.set_name);
  const candidates = setCode
    ? (familyOf.get(setCode) || [setCode]).flatMap((c) => productsBySet.get(c) || [])
    : [];

  if (!setCode) {
    unmatchedNoSet++;
  } else {
    const rawTokens = normalize(offer.title);

    // Compare each candidate against the title with THAT candidate's set-name
    // tokens removed, so "Aetherdrift Commander Deck ..." strips "commander"
    // when the candidate lives in the "Aetherdrift Commander" child set.
    const survivors = [];
    for (const c of candidates) {
      const titleTokens = rawTokens.filter((t) => !c.setTokens.has(t));
      const titleQuals = qualifierSet(titleTokens);
      const titleNouns = new Set(titleTokens.filter((t) => BASE_NOUNS.has(t)));
      if (setEquals(titleQuals, c.qualifiers) && setEquals(titleNouns, c.nouns)) {
        survivors.push({ c, titleTokens });
      }
    }

    if (survivors.length === 0) {
      unmatchedNoCandidate++;
    } else {
      const scored = survivors
        .map(({ c, titleTokens }) => ({ c, s: jaccard(titleTokens, c.tokens) }))
        .sort((a, b) => b.s - a.s);
      const best = scored[0];
      // A runner-up with the SAME normalized tokens is a catalog duplicate
      // (MTGJSON ships e.g. "Collectors Edition" and "Collector's Edition"
      // variants of one product) — not a real ambiguity. Only a genuinely
      // different close-scoring product blocks the match.
      const bestTokens = [...new Set(best.c.tokens)].sort().join(' ');
      const second = scored.find(
        (x) => x.c.uuid !== best.c.uuid && [...new Set(x.c.tokens)].sort().join(' ') !== bestTokens,
      );
      if (best.s >= 0.3 && (!second || best.s - second.s > 0.05)) {
        record.sealed_product_uuid = best.c.uuid;
        record.method = 'rules';
        record.score = Number(best.s.toFixed(3));
        matched++;
      } else {
        ambiguous++;
      }
    }
  }

  if (record.method === 'unmatched' && unmatchedSamples.length < REPORT_LIMIT) {
    unmatchedSamples.push(`${offer.title.slice(0, 90)}  [set: ${offer.set_name || '?'}]`);
  }
  pending.push(record);
  if (pending.length >= 500) {
    await upsertMatches(pending.splice(0));
  }
}
if (pending.length) await upsertMatches(pending.splice(0));

const total = matched + unmatchedNoSet + unmatchedNoCandidate + ambiguous;
console.log('DONE.');
console.log(`   New titles processed: ${total}`);
console.log(`   Matched: ${matched} (${total ? ((matched / total) * 100).toFixed(1) : 0}%)`);
console.log(`   Unmatched — no set identified: ${unmatchedNoSet}`);
console.log(`   Unmatched — no candidate passed qualifier gate: ${unmatchedNoCandidate}`);
console.log(`   Unmatched — ambiguous tie: ${ambiguous}`);
if (unmatchedSamples.length) {
  console.log('   Sample unmatched titles:');
  unmatchedSamples.forEach((s) => console.log(`   - ${s}`));
}
