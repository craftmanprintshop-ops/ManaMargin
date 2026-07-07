/**
 * eBay sold listings scrape worker.
 * Spawned as a child process by server.js to isolate Chromium memory.
 *
 * Usage: node ebay-scrape-worker.js <query> [max_pages]
 * Outputs JSON to stdout: { ok, items: [...], errors: [...] }
 */
const { chromium } = require('playwright');

const query = process.argv[2];
const maxPages = Math.min(parseInt(process.argv[3]) || 1, 10);

if (!query) {
  console.log(JSON.stringify({ ok: false, error: 'Missing query argument' }));
  process.exit(1);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-extensions',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    // Block images, fonts, media — allow document + script + xhr/fetch
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['document', 'script', 'xhr', 'fetch'].includes(type)) return route.continue();
      return route.abort();
    });

    const allItems = [];
    const errors = [];
    let pageNum = 1;

    while (pageNum <= maxPages) {
      const params = new URLSearchParams({
        _nkw: query,
        _sacat: '0',
        _from: 'R40',
        LH_Sold: '1',
        rt: 'nc',
        LH_PrefLoc: '1',
      });
      if (pageNum > 1) params.set('_pgn', String(pageNum));
      const searchUrl = `https://www.ebay.com/sch/i.html?${params.toString()}`;

      process.stderr.write(`[ebay-worker] Page ${pageNum}: ${searchUrl}\n`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait for JS to render search results
      await page.waitForSelector('li.s-card', { timeout: 10000 }).catch(() => {
        process.stderr.write(`[ebay-worker] waitForSelector timed out\n`);
      });

      // Check for bot detection
      const pageTitle = await page.title().catch(() => '(unknown)');
      process.stderr.write(`[ebay-worker] Page title: ${pageTitle}\n`);

      if (pageTitle.includes('Pardon Our Interruption')) {
        process.stderr.write(`[ebay-worker] Bot detection, waiting 8s...\n`);
        await sleep(8000);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('li.s-card', { timeout: 10000 }).catch(() => {});
        const retryTitle = await page.title().catch(() => '(unknown)');
        process.stderr.write(`[ebay-worker] Retry title: ${retryTitle}\n`);
        if (retryTitle.includes('Pardon Our Interruption')) {
          errors.push('eBay bot detection — try again in a few minutes');
          break;
        }
      }

      // Extract data directly from DOM
      const rows = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('li.s-card').forEach(el => {
          const cls = el.className || '';
          if (cls.includes('srp-river-answer')) return;

          let title = '';
          const heading = el.querySelector('[role="heading"]');
          if (heading) title = heading.textContent.trim();
          if (!title) {
            const titleEl = el.querySelector('.s-card__title');
            if (titleEl) title = titleEl.textContent.trim();
          }
          if (!title) {
            const img = el.querySelector('img.s-card__image');
            if (img) title = img.alt || '';
          }
          title = title.replace(/Opens in a new window or tab$/i, '').trim();
          if (!title || title === 'Shop on eBay' || title === 'Results matching fewer words' || title.length < 5) return;

          let priceText = '';
          const priceEl = el.querySelector('.s-card__price');
          if (priceEl) priceText = priceEl.textContent.trim();
          if (!priceText) {
            for (const span of el.querySelectorAll('span')) {
              const t = span.textContent.trim();
              if (/^\$[\d,.]+$/.test(t)) { priceText = t; break; }
            }
          }

          let soldDateRaw = '';
          for (const span of el.querySelectorAll('span')) {
            const t = span.textContent.trim();
            if (/^Sold\s+/i.test(t)) { soldDateRaw = t; break; }
          }
          if (!soldDateRaw) {
            const posEl = el.querySelector('.positive, .POSITIVE');
            if (posEl) {
              const t = posEl.textContent.trim();
              if (/Sold/i.test(t)) soldDateRaw = t;
            }
          }

          let shippingText = '';
          for (const span of el.querySelectorAll('span')) {
            const t = span.textContent.trim();
            if (/shipping|delivery|free/i.test(t) && t.length < 50) { shippingText = t; break; }
          }

          let condition = null;
          for (const span of el.querySelectorAll('span')) {
            const t = span.textContent.trim();
            if (/^(New|Used|Pre-Owned|Brand New|Open Box|Sealed)/i.test(t)) { condition = t; break; }
          }

          let bidsText = '';
          for (const span of el.querySelectorAll('span')) {
            const t = span.textContent.trim();
            if (/\d+\s*bid/i.test(t)) { bidsText = t; break; }
          }

          let qtyText = '';
          for (const span of el.querySelectorAll('span')) {
            const t = span.textContent.trim();
            if (/\d+\+?\s*sold/i.test(t)) { qtyText = t; break; }
          }

          const linkEl = el.querySelector('a.s-card__link') || el.querySelector('a[href*="/itm/"]');
          const url = linkEl ? linkEl.href : null;

          const imgEl = el.querySelector('img.s-card__image');
          const imageUrl = imgEl ? imgEl.src : null;

          results.push({ title, priceText, soldDateRaw, shippingText, condition, bidsText, qtyText, url, imageUrl });
        });
        return results;
      });

      process.stderr.write(`[ebay-worker] Page ${pageNum}: ${rows.length} items\n`);

      if (rows.length === 0 && pageNum === 1) {
        errors.push('No listing items found on page');
        break;
      }
      if (rows.length === 0) break;

      allItems.push(...rows);

      // Check for next page
      const hasNext = await page.evaluate(() => {
        const next = document.querySelector('a.pagination__next');
        return next && !next.classList.contains('pagination__next--disabled');
      });
      if (!hasNext) break;
      pageNum++;
      await sleep(2500);
    }

    await browser.close();
    browser = null;

    // Output results as JSON to stdout
    console.log(JSON.stringify({ ok: true, items: allItems, errors, pages: pageNum }));
  } catch (e) {
    if (browser) await browser.close().catch(() => null);
    console.log(JSON.stringify({ ok: false, error: e.message || String(e), items: [], errors: [] }));
    process.exit(1);
  }
})();
