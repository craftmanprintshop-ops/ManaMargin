declare const Deno: any;

import { corsHeaders } from '../_shared/cors.ts';

/**
 * Supabase Edge Function: ebay-sold-scrape
 *
 * Fetches eBay sold listings directly from eBay's search page using plain HTTP
 * (no Playwright/Chromium needed). Edge functions run on Deno Deploy which uses
 * non-AWS IPs that aren't blocked by eBay's bot detection.
 *
 * Parses the HTML for listing data and upserts to ebay_sold_events table.
 */

const EBAY_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ---- Parsing helpers ----

function parseEbayPrice(text: string): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, '').match(/\$?([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function parseShippingCost(text: string): number | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('free')) return 0;
  const m = text.replace(/,/g, '').match(/\$?([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function parseEbaySoldDate(raw: string): string | null {
  if (!raw) return null;
  // "Sold  Feb 28, 2026" or "Sold Feb 28, 2026"
  const cleaned = raw.replace(/^Sold\s+/i, '').trim();
  try {
    const d = new Date(cleaned);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function parseBidsAndType(text: string): { bids: number | null; type: string } {
  if (!text) return { bids: null, type: 'buy_it_now' };
  const m = text.match(/(\d+)\s*bid/i);
  return m ? { bids: parseInt(m[1]), type: 'auction' } : { bids: null, type: 'buy_it_now' };
}

function parseSoldCount(text: string): number | null {
  if (!text) return null;
  const m = text.match(/(\d+)\+?\s*sold/i);
  return m ? parseInt(m[1]) : null;
}

function extractEbayItemId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/itm\/(\d+)/);
  return m ? m[1] : null;
}

// ---- HTML scraping (regex-based, no DOM parser needed) ----

interface RawListing {
  title: string;
  priceText: string;
  soldDateRaw: string;
  shippingText: string;
  condition: string | null;
  bidsText: string;
  qtyText: string;
  url: string | null;
  imageUrl: string | null;
}

function extractListingsFromHtml(html: string): RawListing[] {
  const listings: RawListing[] = [];

  // eBay's server-rendered HTML uses <li ... class="s-card s-card--horizontal">
  // or class=s-card (unquoted). Split by finding each s-card <li> boundary.
  const srpStart = html.indexOf('srp-results');
  if (srpStart === -1) return listings;
  const srpSection = html.substring(srpStart);

  // Find all s-card <li> tag positions
  const liRegex = /<li\b[^>]*\bs-card\b[^>]*>/gi;
  const positions: number[] = [];
  let m;
  while ((m = liRegex.exec(srpSection)) !== null) {
    positions.push(m.index);
  }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : srpSection.indexOf('</ul>', start);
    if (end <= start) continue;
    const block = srpSection.substring(start, end);

    // Skip promos/ads
    if (block.includes('srp-river-answer')) continue;

    // Title — look for role="heading" or role=heading (may be unquoted)
    let title = '';
    const headingMatch = block.match(/role=["']?heading["']?[^>]*>([^<]+)/i);
    if (headingMatch) title = headingMatch[1].trim();
    if (!title) {
      const altMatch = block.match(/alt=["']([^"']+)["']/i);
      if (altMatch) title = altMatch[1].trim();
    }
    title = title.replace(/<[^>]+>/g, '').replace(/Opens in a new window or tab$/i, '').trim();
    if (!title || title === 'Shop on eBay' || title === 'Results matching fewer words' || title.length < 5) continue;

    // Price — find $xxx.xx pattern
    let priceText = '';
    const priceMatch = block.match(/>\$[\d,.]+</);
    if (priceMatch) priceText = priceMatch[0].replace(/[<>]/g, '').trim();

    // Sold date
    let soldDateRaw = '';
    const soldMatch = block.match(/>Sold\s+([^<]+)</i);
    if (soldMatch) soldDateRaw = 'Sold ' + soldMatch[1].trim();

    // Shipping
    let shippingText = '';
    const freeShipMatch = block.match(/>Free [sd](?:hipping|elivery)/i);
    if (freeShipMatch) {
      shippingText = 'Free shipping';
    } else {
      const shipCostMatch = block.match(/>\+?\$[\d,.]+\s*(?:shipping|delivery)[^<]*/i);
      if (shipCostMatch) shippingText = shipCostMatch[0].replace(/^>/, '').trim();
    }

    // Condition
    let condition: string | null = null;
    const condMatch = block.match(/>(?:New|Brand New|Pre-Owned|Used|Open Box|Sealed)\b[^<]*/i);
    if (condMatch) condition = condMatch[0].replace(/^>/, '').trim();

    // Bids
    let bidsText = '';
    const bidsMatch = block.match(/>(\d+\s*bids?)</i);
    if (bidsMatch) bidsText = bidsMatch[1];

    // Qty sold
    let qtyText = '';
    const qtyMatch = block.match(/>(\d+\+?\s*sold)</i);
    if (qtyMatch) qtyText = qtyMatch[1];

    // URL — may be quoted or unquoted href
    let url: string | null = null;
    const urlMatch = block.match(/href=["']?(https?:\/\/(?:www\.)?ebay\.com\/itm\/[^\s"'>]+)/i);
    if (urlMatch) url = urlMatch[1].replace(/&amp;/g, '&');

    // Image
    let imageUrl: string | null = null;
    const imgMatch = block.match(/src=["']?(https?:\/\/i\.ebayimg\.com[^\s"'>]+)/i);
    if (imgMatch) imageUrl = imgMatch[1];

    listings.push({ title, priceText, soldDateRaw, shippingText, condition, bidsText, qtyText, url, imageUrl });
  }

  return listings;
}

// ---- Main handler ----

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // Parse params
  let q = '';
  let maxPages = 1;

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      q = body.q || '';
      maxPages = Math.min(parseInt(body.max_pages) || 1, 3);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  } else {
    const url = new URL(req.url);
    q = url.searchParams.get('q') || '';
    maxPages = Math.min(parseInt(url.searchParams.get('max_pages') || '1') || 1, 3);
  }

  q = q.trim();
  if (!q) {
    return new Response(
      JSON.stringify({ error: 'Missing required parameter: q' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const stats = { query: q, rows_found: 0, rows_upserted: 0, pages_scraped: 0, errors: [] as string[] };

  try {
    const allListings: RawListing[] = [];

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const params = new URLSearchParams({
        _nkw: q,
        _sacat: '0',
        _from: 'R40',
        LH_Sold: '1',
        LH_Complete: '1',
        rt: 'nc',
        LH_PrefLoc: '1',
      });
      if (pageNum > 1) params.set('_pgn', String(pageNum));

      const searchUrl = `https://www.ebay.com/sch/i.html?${params.toString()}`;
      console.log(`[ebay-sold] Page ${pageNum}: ${searchUrl}`);

      const resp = await fetch(searchUrl, {
        headers: {
          'User-Agent': EBAY_USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
        },
        redirect: 'follow',
      });

      if (!resp.ok) {
        console.error(`[ebay-sold] HTTP ${resp.status} from eBay`);
        stats.errors.push(`eBay returned HTTP ${resp.status}`);
        break;
      }

      const html = await resp.text();
      console.log(`[ebay-sold] Page ${pageNum}: ${html.length} bytes`);

      // Check for bot detection
      if (html.includes('Pardon Our Interruption')) {
        console.warn(`[ebay-sold] Bot detection on page ${pageNum}`);
        stats.errors.push('eBay bot detection — edge function IP may be blocked');
        break;
      }

      const listings = extractListingsFromHtml(html);
      console.log(`[ebay-sold] Page ${pageNum}: ${listings.length} listings extracted`);

      if (listings.length === 0 && pageNum === 1) {
        stats.errors.push('No listings found in eBay HTML');
        break;
      }
      if (listings.length === 0) break;

      allListings.push(...listings);
      stats.pages_scraped = pageNum;

      // Check for next page
      if (!html.includes('pagination__next') || html.includes('pagination__next--disabled')) break;
    }

    stats.rows_found = allListings.length;
    console.log(`[ebay-sold] Total: ${allListings.length} listings`);

    // Upsert to Supabase
    for (const raw of allListings) {
      try {
        const parsed = parseBidsAndType(raw.bidsText);
        const ebayItemId = extractEbayItemId(raw.url);
        const soldDateUtc = parseEbaySoldDate(raw.soldDateRaw);
        const priceUsd = parseEbayPrice(raw.priceText);

        if (priceUsd === null) continue;

        const row = {
          query: q,
          title: raw.title || null,
          sold_date_utc: soldDateUtc,
          sold_date_raw: raw.soldDateRaw || null,
          price_usd: priceUsd,
          shipping_cost: parseShippingCost(raw.shippingText),
          condition: raw.condition || null,
          type: parsed.type,
          bids: parsed.bids,
          sold_count: parseSoldCount(raw.qtyText),
          ebay_item_id: ebayItemId,
          ebay_url: raw.url || null,
          image_url: raw.imageUrl || null,
          scraped_at: new Date().toISOString(),
        };

        // Upsert via Supabase REST API
        const upsertResp = await fetch(`${supabaseUrl}/rest/v1/ebay_sold_events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify(row),
        });

        if (upsertResp.ok || upsertResp.status === 201) {
          stats.rows_upserted++;
        } else {
          const errText = await upsertResp.text();
          // Ignore duplicate key errors
          if (!errText.includes('duplicate')) {
            stats.errors.push(`Upsert error: ${errText.substring(0, 100)}`);
          } else {
            stats.rows_upserted++;
          }
        }
      } catch (rowErr: any) {
        stats.errors.push(`Parse error: ${rowErr?.message || String(rowErr)}`);
      }
    }

    console.log(`[ebay-sold] Done: ${stats.rows_upserted} upserted, ${stats.errors.length} errors`);

    return new Response(
      JSON.stringify({ ok: true, ...stats }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[ebay-sold] Fatal error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || String(err), ...stats }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
