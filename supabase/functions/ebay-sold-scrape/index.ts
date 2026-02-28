declare const Deno: any;

import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const scraperBaseUrl = Deno.env.get('SCRAPER_BASE_URL');
  if (!scraperBaseUrl) {
    return new Response(
      JSON.stringify({ error: 'SCRAPER_BASE_URL not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  let q = '';
  let maxPages = '3';

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      q = body.q || '';
      maxPages = String(body.max_pages || '3');
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  } else {
    const url = new URL(req.url);
    q = url.searchParams.get('q') || '';
    maxPages = url.searchParams.get('max_pages') || '3';
  }

  if (!q.trim()) {
    return new Response(
      JSON.stringify({ error: 'Missing required parameter: q' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  const target = new URL('/jobs/ebay-sold/scrape', scraperBaseUrl);
  target.searchParams.set('q', q.trim());
  target.searchParams.set('max_pages', maxPages);

  try {
    const scraperResp = await fetch(target.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    const body = await scraperResp.text();

    return new Response(body, {
      status: scraperResp.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Scraper proxy error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to reach scraper', message: err.message }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
