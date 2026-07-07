/**
 * server.js (CommonJS)
 * - Scrapes:
 *   - Forge & Fire (product pages via /run, and category pages via /jobs/forgeandfire/crawl)
 *   - TradingCardMarket / CollectorStore / MinMaxGames / SagaConcepts / GameNerdz / GeekeryGames
 * - Inserts results into Supabase:
 *   - tracked_products (upsert by canonical_sku)
 *   - offers (insert rows)
 *
 * IMPORTANT:
 * - Designed to satisfy Supabase constraint "offers_ok_requires_data":
 *   If scrape_ok === true, we ALWAYS ensure price !== null and in_stock !== null.
 *   If we don't have price/in_stock, we flip scrape_ok to false.
 *
 * UPDATED: Now captures product image URLs from all marketplaces
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const cheerio = require('cheerio');
const fs = require('fs/promises');

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// -------------------- Basic helpers --------------------

function safeText(x) {
  return typeof x === 'string' ? x.trim() : null;
}

function parseMoney(str) {
  if (!str) return null;
  const s = String(str).replace(/\u00A0/g, ' ').replace(/,/g, '').trim();
  const m = s.match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalizes a product URL for dedupe:
 * - strips hash and querystring
 * - keeps origin + pathname
 */
function normalizeProductUrl(url) {
  try {
    const u = new URL(url, 'https://example.com');
    // If caller passed a relative URL, URL() will use example.com; handle that:
    const isRelative = !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(String(url));
    if (isRelative) {
      // relative URL: just remove query/hash and return as pathname
      return u.pathname.replace(/\/+$/, '') || '/';
    }
    u.hash = '';
    u.search = '';
    // trim trailing slash except root
    const path = u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '/';
    return `${u.origin}${path}`;
  } catch {
    return String(url || '').trim();
  }
}

/**
 * Normalize image URL - ensure it's absolute and clean
 */
function normalizeImageUrl(imgUrl, baseUrl) {
  if (!imgUrl) return null;
  try {
    // Handle protocol-relative URLs
    if (imgUrl.startsWith('//')) {
      imgUrl = 'https:' + imgUrl;
    }
    // Make absolute if relative
    const absolute = new URL(imgUrl, baseUrl).href;
    // Remove query params that might be size-related to get full image
    // But keep CDN params that are needed
    return absolute;
  } catch {
    return null;
  }
}

// -------------------- Offer row helpers --------------------

const MARKET_PREFIXES = {
  forgeandfire: 'FF',
  tradingcardmarket: 'TCM',
  collectorstore: 'CS',
  minmaxgames: 'MM',
  sagaconcepts: 'SC',
  gamenerdz: 'GN',
  geekerygames: 'GG',
};

function slugToSkuPrefix(prefix, url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const slug = parts[parts.length - 1] || 'UNKNOWN';
    const norm = slug
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
    return `${prefix}_${norm}`;
  } catch {
    const norm = String(url || 'UNKNOWN')
      .replace(/https?:\/\//, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
    return `${prefix}_${norm}`;
  }
}

/**
 * Enforces the check constraint:
 * - If scrape_ok=true, require price!=null and in_stock!=null
 * - If missing, flip scrape_ok=false and write error_text
 */
function normalizeOfferRow(row) {
  const out = { ...row };

  if (!out.fetched_at) out.fetched_at = new Date().toISOString();
  if (out.scrape_ok === undefined) out.scrape_ok = true;
  if (out.error_text === undefined) out.error_text = null;

  if (out.scrape_ok === true) {
    const missingPrice = out.price === null || out.price === undefined;
    const missingStock = out.in_stock === null || out.in_stock === undefined;
    if (missingPrice || missingStock) {
      out.scrape_ok = false;
      out.error_text =
        out.error_text ||
        `Auto-flipped scrape_ok=false because missing ${missingPrice ? 'price' : ''}${
          missingPrice && missingStock ? ' and ' : ''
        }${missingStock ? 'in_stock' : ''}`;
      if (missingPrice) out.price = null;
      if (missingStock) out.in_stock = null;
    }
  }

  return out;
}

function dedupeByKey(rows, keyFn) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

// -------------------- Polite crawling helpers --------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(baseMs, pct = 0.25) {
  const delta = baseMs * pct;
  return Math.floor(baseMs - delta + Math.random() * (2 * delta));
}

async function gotoWithRetry(page, url, opts = {}) {
  const attempts = opts.attempts ?? 3;
  let delay = opts.delayMs ?? 1500;

  for (let a = 1; a <= attempts; a++) {
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
      return resp;
    } catch (e) {
      if (a === attempts) throw e;
      await sleep(jitter(delay, 0.35));
      delay *= 2;
    }
  }
}

async function applyPoliteRouting(page) {
  // NOTE: We're now allowing images through since we need to scrape them
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'font' || type === 'media') return route.abort();
    return route.continue();
  });
}

// -------------------- Supabase upsert/insert helpers --------------------

async function upsertTrackedProducts(rows) {
  if (!rows.length) return;
  const { error } = await supabase
    .from('tracked_products')
    .upsert(rows, { onConflict: 'canonical_sku' });
  if (error) throw new Error(`Supabase upsert tracked_products failed: ${error.message}`);
}

async function insertOffer(row) {
  if (!row?.canonical_sku || !row.marketplace || !row.source_key) return;
  const normalized = normalizeOfferRow(row);
  const { error } = await supabase.from('offers').insert([normalized]);
  if (error) throw new Error(`Supabase insert offers failed: ${error.message}`);
}

// -------------------- Forge & Fire (product page scraper) --------------------

async function scrapeForgeAndFireProduct({ context, url }) {
  const page = await context.newPage();
  try {
    await applyPoliteRouting(page);
    await gotoWithRetry(page, url);

    // Attempt to scroll a bit to trigger lazy-load images
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      window.scrollTo(0, 0);
      await sleep(250);
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(350);
      window.scrollTo(0, 0);
      await sleep(250);
    });

    const data = await page.evaluate(() => {
      const clean = (s) => (s ? String(s).trim() : null);

      const title =
        clean(document.querySelector('h1')?.textContent) ||
        clean(document.title) ||
        null;

      const priceText =
        clean(document.querySelector('[data-product-price]')?.textContent) ||
        clean(document.querySelector('.price')?.textContent) ||
        clean(document.querySelector('.product__price')?.textContent) ||
        null;

      const soldOutText =
        clean(document.querySelector('.product__inventory')?.textContent) ||
        clean(document.querySelector('.product__availability')?.textContent) ||
        clean(document.querySelector('[data-product-availability]')?.textContent) ||
        '';

      const soldOut = (soldOutText || '').toLowerCase().includes('out of stock') ||
        (soldOutText || '').toLowerCase().includes('sold out') ||
        !!document.querySelector('[disabled][name="add"]') ||
        !!document.querySelector('.btn--sold-out');

      // Best-effort image extraction (BigCommerce / Shopify / WooCommerce)
      let imageUrl = null;

      // Try product-specific selectors first (skip logos/icons)
      const img =
        // BigCommerce (Forge & Fire)
        document.querySelector('.productView-image img') ||
        document.querySelector('.productView-images img') ||
        document.querySelector('[data-image-gallery-main] img') ||
        document.querySelector('img[src*="bigcommerce.com"][src*="/products/"]') ||
        // WooCommerce
        document.querySelector('.woocommerce-product-gallery__image img') ||
        document.querySelector('img.wp-post-image') ||
        // Shopify
        document.querySelector('img.product__image') ||
        document.querySelector('.product__media img') ||
        document.querySelector('.product__image-wrapper img') ||
        // Generic product image (skip tiny icons/logos)
        (() => {
          const imgs = Array.from(document.querySelectorAll('img'));
          for (const i of imgs) {
            const src = i.currentSrc || i.src || '';
            if (src.includes('/products/') || src.includes('product')) {
              return i;
            }
          }
          // Fallback: largest non-logo image
          for (const i of imgs) {
            const src = i.currentSrc || i.src || '';
            const w = i.naturalWidth || parseInt(i.getAttribute('width') || '0');
            const h = i.naturalHeight || parseInt(i.getAttribute('height') || '0');
            if (w > 100 && h > 100 && !src.includes('logo')) return i;
          }
          return null;
        })();

      const pickLargestFromSrcset = (srcset) => {
        if (!srcset) return null;
        const parts = srcset
          .split(',')
          .map((s) => s.trim())
          .map((entry) => {
            const [url, desc] = entry.split(/\s+/);
            let score = 0;
            if (desc && desc.endsWith('w')) score = parseInt(desc, 10) || 0;
            else if (desc && desc.endsWith('x')) score = (parseFloat(desc) || 0) * 10000;
            return { url, score };
          })
          .filter((x) => x.url);
        if (!parts.length) return null;
        parts.sort((a, b) => b.score - a.score);
        return parts[0].url;
      };

      if (img) {
        imageUrl = img.currentSrc || img.src || null;

        if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.includes('placeholder') || imageUrl.includes('loading')) {
          imageUrl = null;

          const srcset =
            img.getAttribute('srcset') ||
            img.getAttribute('data-srcset') ||
            img.getAttribute('data-lazy-srcset');
          imageUrl = pickLargestFromSrcset(srcset);

          if (!imageUrl) {
            const picture = img.closest('picture');
            if (picture) {
              const source = picture.querySelector('source[srcset], source[data-srcset]');
              const sset = source?.getAttribute('srcset') || source?.getAttribute('data-srcset');
              imageUrl = pickLargestFromSrcset(sset);
            }
          }

          if (!imageUrl) {
            const lazy =
              img.getAttribute('data-src') ||
              img.getAttribute('data-lazy-src') ||
              img.getAttribute('data-original') ||
              img.getAttribute('data-lazy');
            if (lazy && !lazy.startsWith('data:') && !lazy.includes('placeholder')) imageUrl = lazy;
          }

          if (!imageUrl) {
            const srcAttr = img.getAttribute('src');
            if (srcAttr && !srcAttr.startsWith('data:') && !srcAttr.includes('placeholder')) imageUrl = srcAttr;
          }
        }
      }

      return { title, priceText, soldOut, imageUrl };
    });

    const price = parseMoney(data.priceText);
    const in_stock = data.soldOut ? false : true;

    // If we can't find price, mark scrape_ok false
    const scrape_ok = price !== null && in_stock !== null;

    return {
      title: data.title,
      price,
      in_stock,
      scrape_ok,
      scrape_error: scrape_ok ? null : 'Missing price or stock',
      imageUrl: data.imageUrl,
    };
  } catch (e) {
    return {
      title: null,
      price: null,
      in_stock: null,
      scrape_ok: false,
      scrape_error: e?.message || String(e),
      imageUrl: null,
    };
  } finally {
    await page.close();
  }
}

// -------------------- Generic listing eval (Shopify-ish / general) --------------------

function listingEvalCommon() {
  return (opts) => {
    const clean = (s) => (s ? String(s).trim() : null);

    // Helper: pick the largest candidate from a srcset string
    const pickLargestFromSrcset = (srcset) => {
      if (!srcset) return null;
      const parts = srcset
        .split(',')
        .map((s) => s.trim())
        .map((entry) => {
          const [url, desc] = entry.split(/\s+/);
          let score = 0;
          if (desc && desc.endsWith('w')) score = parseInt(desc, 10) || 0;
          else if (desc && desc.endsWith('x')) score = (parseFloat(desc) || 0) * 10000;
          return { url, score };
        })
        .filter((x) => x.url);

      if (!parts.length) return null;
      parts.sort((a, b) => b.score - a.score);
      return parts[0].url;
    };

    // Helper: extract best image source from an img element (prefer "live" rendered URLs)
    const getBestImageSrc = (img) => {
      if (!img) return null;

      // 0) What the browser actually chose (best after lazy/responsive loads)
      const live = img.currentSrc || img.src;
      if (live && !live.startsWith('data:') && !live.includes('placeholder') && !live.includes('loading')) {
        return live;
      }

      // 1) srcset / data-srcset / data-lazy-srcset (pick largest)
      const srcset =
        img.getAttribute('srcset') ||
        img.getAttribute('data-srcset') ||
        img.getAttribute('data-lazy-srcset');
      const bestFromSet = pickLargestFromSrcset(srcset);
      if (bestFromSet) return bestFromSet;

      // 2) <picture><source srcset=...>
      const picture = img.closest('picture');
      if (picture) {
        const source = picture.querySelector('source[srcset], source[data-srcset]');
        const sset = source?.getAttribute('srcset') || source?.getAttribute('data-srcset');
        const best = pickLargestFromSrcset(sset);
        if (best) return best;
      }

      // 3) Common lazyload attrs
      const lazySrc =
        img.getAttribute('data-src') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy') ||
        img.getAttribute('data-zoom-image');
      if (lazySrc && !lazySrc.startsWith('data:') && !lazySrc.includes('placeholder')) return lazySrc;

      // 4) Plain src attribute fallback
      const srcAttr = img.getAttribute('src');
      if (srcAttr && !srcAttr.startsWith('data:') && !srcAttr.includes('placeholder')) return srcAttr;

      return null;
    };

    // Helper: extract background-image URLs / bgset-based lazy images
    const getBgImageFromEl = (el) => {
      if (!el) return null;

      const bgset = el.getAttribute?.('data-bgset') || el.getAttribute?.('data-bg');
      const bestBg = pickLargestFromSrcset(bgset);
      if (bestBg) return bestBg;

      const style = el.getAttribute?.('style') || '';
      const m = style.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
      if (m?.[2] && !m[2].startsWith('data:')) return m[2];

      return null;
    };

    const productUrlIncludes = opts?.productUrlIncludes || null;
    const productPathIncludes = opts?.productPathIncludes || '/products/';

    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const productLinks = anchors
      .map((a) => ({ a, href: a.href }))
      .filter((x) => x.href && x.href.includes(productPathIncludes));

    const items = [];
    const seen = new Set();

    for (const { a, href } of productLinks) {
      if (productUrlIncludes && !href.includes(productUrlIncludes)) continue;
      if (seen.has(href)) continue;

      let card = a.closest('li, article, div, section') || a.parentElement;
      if (!card) card = document.body;

      const title =
        clean(card.querySelector('h3')?.textContent) ||
        clean(card.querySelector('h2')?.textContent) ||
        clean(card.querySelector('h4')?.textContent) ||
        clean(card.querySelector('[class*="title"]')?.textContent) ||
        clean(a.getAttribute('aria-label')) ||
        clean(a.textContent) ||
        null;

      const cardTextLower = (card.innerText || card.textContent || '').toLowerCase();
      const soldOut =
        cardTextLower.includes('sold out') ||
        cardTextLower.includes('out of stock') ||
        !!card.querySelector('[class*="soldout"], [class*="sold-out"], .sold-out, [data-soldout]');

      let priceText = null;

      // Try meta in-card
      const metaPrice = card.querySelector('meta[itemprop="price"]')?.getAttribute('content');
      if (metaPrice) priceText = metaPrice;

      const moneyEls = Array.from(
        card.querySelectorAll(
          [
            // BigCommerce / random
            '[data-product-price-without-tax]',
            '.data-product-price-without-tax',
            '[data-product-price-with-tax]',
            '.price--withTax',
            // Shopify / general
            'span.price-item--sale',
            'span.price-item--regular',
            '.price__sale .price-item',
            '.price__regular .price-item',
            // Generic
            '[class*="money"]',
            '[class*="price"]',
            '[data-price]',
            '[data-product-price]',
            'meta[itemprop="price"]',
          ].join(',')
        )
      );

      for (const el of moneyEls) {
        if (!priceText && el.tagName === 'META') {
          const v = el.getAttribute('content');
          if (v) priceText = v;
        }
      }

      if (!priceText) {
        const attrEl =
          card.querySelector('span[data-product-price-without-tax]') ||
          card.querySelector('span[data-product-price-with-tax]');
        if (attrEl) {
          const v =
            attrEl.getAttribute('data-product-price-without-tax') ||
            attrEl.getAttribute('data-product-price-with-tax');
          if (v) priceText = v;
        }
      }

      if (!priceText) {
        const clsEl =
          card.querySelector('span.data-product-price-without-tax') ||
          card.querySelector('span.price.price--withTax');
        const t = clean(clsEl?.textContent);
        if (t) priceText = t;
      }

      if (!priceText) {
        const texts = moneyEls.map((el) => (el.textContent || '').trim()).filter(Boolean);
        for (let i = texts.length - 1; i >= 0; i--) {
          const m = texts[i].match(/\$?\s*[0-9,]+(?:\.[0-9]{1,2})?/);
          if (m) {
            priceText = m[0];
            break;
          }
        }
      }

      if (!priceText) {
        const txt = card.innerText || card.textContent || '';
        const matches = txt.match(/\$?\s*[0-9,]+(?:\.[0-9]{1,2})?/g) || [];
        const filtered = matches.filter((t) => /[0-9]/.test(t));
        if (filtered.length) priceText = filtered[filtered.length - 1];
      }

      // Extract image URL
      let imageUrl = null;

      // First: try img inside the product link itself (most reliable)
      const linkImg = a.querySelector('img');
      if (linkImg) imageUrl = getBestImageSrc(linkImg);

      // Second: try common product card image containers
      if (!imageUrl) {
        const imgSelectors = [
          '.card__media img',
          '.card__inner img',
          '.product-card__image img',
          '.product-card__media img',
          'img.product-featured-media',
          'img[data-product-featured-image]',
          '.product-image img',
          '.card-image img',
          '.image-container img',
          'img.product-image',
          'img[class*="product"]',
          'img[src*="cdn.shopify"]',
          'img[data-src*="cdn.shopify"]',
          'img[src*="cdn"]',
          'img[data-src*="cdn"]',
        ];
        for (const sel of imgSelectors) {
          const img = card.querySelector(sel);
          if (img) {
            imageUrl = getBestImageSrc(img);
            if (imageUrl) break;
          }
        }
      }

      // Third: first non-tiny img in card
      if (!imageUrl) {
        for (const img of card.querySelectorAll('img')) {
          const w = parseInt(img.getAttribute('width') || '0');
          const h = parseInt(img.getAttribute('height') || '0');
          if (w > 0 && w < 30) continue;
          if (h > 0 && h < 30) continue;
          const src = getBestImageSrc(img);
          if (src) {
            imageUrl = src;
            break;
          }
        }
      }

      // Fourth: background-image fallbacks (some themes use divs instead of img src)
      if (!imageUrl) {
        const bgCandidates = [
          card.querySelector('.card__media'),
          card.querySelector('.card__inner'),
          card.querySelector('.product-card__image'),
          card.querySelector('.product-card__media'),
          card.querySelector('[style*="background-image"]'),
          card,
        ].filter(Boolean);

        for (const el of bgCandidates) {
          const bg = getBgImageFromEl(el);
          if (bg && !bg.includes('placeholder') && !bg.includes('loading')) {
            imageUrl = bg;
            break;
          }
        }
      }

      items.push({ title, url: href, priceText, soldOut, imageUrl });
      seen.add(href);
    }

    return items;
  };
}

// -------------------- GameNerdz listing eval (StorePass) --------------------

function listingEvalGameNerdz() {
  return () => {
    const clean = (s) => (s ? String(s).trim() : null);

    const cards = Array.from(document.querySelectorAll('.store-pass-products-section .store-pass-product'));
    const out = [];

    for (const card of cards) {
      const a =
        card.querySelector('.store-pass-product-title a[href]') ||
        card.querySelector('.store-pass-product-image-container a[href]') ||
        card.querySelector('a[href]');

      let href = a?.getAttribute('href') || null;
      if (!href) continue;

      // Make absolute
      try {
        href = new URL(href, location.origin).href;
      } catch (_) {}

      const title =
        clean(card.querySelector('.store-pass-product-title')?.innerText) ||
        clean(a.getAttribute('aria-label')) ||
        clean(a.textContent) ||
        null;

      const priceText = clean(card.querySelector('strong.store-pass-product-price')?.textContent);

      // OOS: button changes to restock alert
      const oos =
        !!card.querySelector('.store-pass-product-oos') ||
        (clean(card.querySelector('button')?.textContent) || '').toLowerCase().includes('restock');

      // Extract image
      let imageUrl = null;
      const img =
        card.querySelector('.store-pass-product-image-container img') ||
        card.querySelector('img');

      const pickLargestFromSrcset = (srcset) => {
        if (!srcset) return null;
        const parts = srcset
          .split(',')
          .map((s) => s.trim())
          .map((entry) => {
            const [url, desc] = entry.split(/\s+/);
            let score = 0;
            if (desc && desc.endsWith('w')) score = parseInt(desc, 10) || 0;
            else if (desc && desc.endsWith('x')) score = (parseFloat(desc) || 0) * 10000;
            return { url, score };
          })
          .filter((x) => x.url);
        if (!parts.length) return null;
        parts.sort((a, b) => b.score - a.score);
        return parts[0].url;
      };

      if (img) {
        // Prefer live resolved URL
        imageUrl = img.currentSrc || img.src || null;

        if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.includes('placeholder') || imageUrl.includes('loading')) {
          imageUrl = null;

          const srcset =
            img.getAttribute('srcset') ||
            img.getAttribute('data-srcset') ||
            img.getAttribute('data-lazy-srcset');
          imageUrl = pickLargestFromSrcset(srcset);

          if (!imageUrl) {
            const lazy =
              img.getAttribute('data-src') ||
              img.getAttribute('data-lazy-src') ||
              img.getAttribute('data-original') ||
              img.getAttribute('data-lazy');
            if (lazy && !lazy.startsWith('data:') && !lazy.includes('placeholder')) imageUrl = lazy;
          }

          if (!imageUrl) {
            const srcAttr = img.getAttribute('src');
            if (srcAttr && !srcAttr.startsWith('data:') && !srcAttr.includes('placeholder')) imageUrl = srcAttr;
          }
        }
      }

      out.push({ title, url: href, priceText, soldOut: oos, imageUrl });
    }

    return out;
  };
}

// -------------------- SagaConcepts listing eval (FIXED) --------------------

function listingEvalSagaConcepts() {
  return (opts) => {
    const clean = (s) => (s ? String(s).trim() : null);
    const hostMustInclude = opts?.productUrlIncludes || 'sagaconcepts.com';

    const priceEls = Array.from(
      document.querySelectorAll(
        '.price-section--withTax .price--withTax, [data-product-price-with-tax], .price.price--withTax'
      )
    );

    const items = [];
    const seen = new Set();

    const findHrefInContainer = (startEl) => {
      let el = startEl;
      for (let i = 0; i < 8 && el; i++) {
        const a =
          el.querySelector?.('a[href*="/products/"]') ||
          el.querySelector?.('a[href*="/product/"]') ||
          el.querySelector?.('a[href]');

        if (a?.href) return a.href;

        const dataHref =
          el.getAttribute?.('data-href') ||
          el.getAttribute?.('data-url') ||
          el.getAttribute?.('data-product-url');

        if (dataHref) {
          try {
            return new URL(dataHref, location.origin).href;
          } catch {
            return dataHref;
          }
        }

        el = el.parentElement;
      }
      return null;
    };

    for (const priceEl of priceEls) {
      const href = findHrefInContainer(priceEl);
      if (!href) continue;
      if (!href.includes(hostMustInclude)) continue;

      if (href.includes('Brand=') || href.includes('page=')) continue;
      if (seen.has(href)) continue;

      const card =
        priceEl.closest('li, article, .ProductItem, .product, .card, .grid-item, .item, .prod-item, div') ||
        document.body;

      const title =
        clean(card.querySelector('h3')?.textContent) ||
        clean(card.querySelector('h2')?.textContent) ||
        clean(card.querySelector('h4')?.textContent) ||
        clean(card.querySelector('[class*="title"]')?.textContent) ||
        clean(card.querySelector('a[href]')?.getAttribute('aria-label')) ||
        clean(card.querySelector('a[href]')?.textContent) ||
        null;

      let priceText = null;

      const attrVal = priceEl.getAttribute('data-product-price-with-tax');
      if (attrVal && attrVal.trim()) priceText = attrVal.trim();

      if (!priceText) {
        const t = clean(priceEl.textContent);
        if (t) priceText = t;
      }

      const cardTextLower = (card.innerText || card.textContent || '').toLowerCase();
      const soldOut =
        cardTextLower.includes('sold out') ||
        cardTextLower.includes('out of stock') ||
        !!card.querySelector('[class*="soldout"], [class*="sold-out"], .sold-out');

      // Extract image
      let imageUrl = null;
      const img =
        card.querySelector('img.card-image') ||
        card.querySelector('.card-figure img') ||
        card.querySelector('img');

      const pickLargestFromSrcset = (srcset) => {
        if (!srcset) return null;
        const parts = srcset
          .split(',')
          .map((s) => s.trim())
          .map((entry) => {
            const [url, desc] = entry.split(/\s+/);
            let score = 0;
            if (desc && desc.endsWith('w')) score = parseInt(desc, 10) || 0;
            else if (desc && desc.endsWith('x')) score = (parseFloat(desc) || 0) * 10000;
            return { url, score };
          })
          .filter((x) => x.url);
        if (!parts.length) return null;
        parts.sort((a, b) => b.score - a.score);
        return parts[0].url;
      };

      const getBgImageFromEl = (el) => {
        if (!el) return null;
        const bgset = el.getAttribute?.('data-bgset') || el.getAttribute?.('data-bg');
        const bestBg = pickLargestFromSrcset(bgset);
        if (bestBg) return bestBg;

        const style = el.getAttribute?.('style') || '';
        const m = style.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
        if (m?.[2] && !m[2].startsWith('data:')) return m[2];
        return null;
      };

      if (img) {
        imageUrl = img.currentSrc || img.src || null;

        if (!imageUrl || imageUrl.startsWith('data:') || imageUrl.includes('placeholder') || imageUrl.includes('loading')) {
          imageUrl = null;

          const srcset =
            img.getAttribute('srcset') ||
            img.getAttribute('data-srcset') ||
            img.getAttribute('data-lazy-srcset');
          imageUrl = pickLargestFromSrcset(srcset);

          if (!imageUrl) {
            const picture = img.closest('picture');
            if (picture) {
              const source = picture.querySelector('source[srcset], source[data-srcset]');
              const sset = source?.getAttribute('srcset') || source?.getAttribute('data-srcset');
              imageUrl = pickLargestFromSrcset(sset);
            }
          }

          if (!imageUrl) {
            const lazy =
              img.getAttribute('data-src') ||
              img.getAttribute('data-lazy-src') ||
              img.getAttribute('data-original') ||
              img.getAttribute('data-lazy');
            if (lazy && !lazy.startsWith('data:') && !lazy.includes('placeholder')) imageUrl = lazy;
          }

          if (!imageUrl) {
            const srcAttr = img.getAttribute('src');
            if (srcAttr && !srcAttr.startsWith('data:') && !srcAttr.includes('placeholder')) imageUrl = srcAttr;
          }
        }
      }

      // Background-image fallback
      if (!imageUrl) {
        const bg =
          getBgImageFromEl(card.querySelector('[style*="background-image"]')) ||
          getBgImageFromEl(card.querySelector('.card-figure')) ||
          getBgImageFromEl(card);
        if (bg && !bg.includes('placeholder') && !bg.includes('loading')) imageUrl = bg;
      }

      items.push({ title, url: href, priceText, soldOut, imageUrl });
      seen.add(href);
    }

    return items;
  };
}

// -------------------- Generic paginated collection crawler --------------------

async function crawlPaginatedCollection({
  startUrl,
  pagesToCrawl,
  context,
  evalOpts,
  evalFn, // optional override
  nextHrefFn, // optional custom next-href getter
  waitSelector, // optional: wait for JS-hydrated content before extracting
}) {
  const page = await context.newPage();
  const all = [];
  try {
    await applyPoliteRouting(page);
    const resp = await gotoWithRetry(page, startUrl);
    if (!resp) throw new Error('No response');

    for (let i = 0; i < pagesToCrawl; i++) {
      if (waitSelector) {
        await page.waitForSelector(waitSelector, { timeout: 20000 }).catch(() => null);
      }
      // Scroll to trigger lazy images
      await page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        window.scrollTo(0, 0);
        await sleep(250);
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(350);
        window.scrollTo(0, 0);
        await sleep(250);
      });

      const fn = evalFn || listingEvalCommon();
      const items = await page.evaluate(fn, evalOpts || {});
      for (const it of items || []) all.push(it);

      let nextUrl = null;

      if (nextHrefFn) {
        nextUrl = await page.evaluate(nextHrefFn);
      } else {
        // Common next selectors
        nextUrl = await page.evaluate(() => {
          const candidates = [
            'a[rel="next"]',
            'a.pagination__next',
            'a.next',
            'a[aria-label="Next page"]',
            'a[aria-label*="Next"]',
            'button[aria-label="Next"]',
          ];

          for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const href = el.getAttribute('href') || el.href;
            if (href) {
              try {
                return new URL(href, location.origin).href;
              } catch {
                return href;
              }
            }
          }
          return null;
        });
      }

      if (!nextUrl) break;

      await gotoWithRetry(page, nextUrl);
    }
  } finally {
    await page.close();
  }
  return all;
}

// -------------------- Market-specific crawlers --------------------

// Shopify stores expose /collections/<handle>/products.json — structured
// title/price/availability with no HTML scraping. Used for stores on Shopify.
async function crawlShopifyCollectionJson({ base, handle, maxPages = 8 }) {
  const items = [];
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const url = `${base}/collections/${handle}/products.json?limit=250&page=${pageNum}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ManaMargin/1.0)' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const data = await res.json();
    const products = data.products || [];
    if (products.length === 0) break;

    for (const p of products) {
      const variants = Array.isArray(p.variants) ? p.variants : [];
      const availableVariants = variants.filter((v) => v.available);
      const priced = (availableVariants.length ? availableVariants : variants)
        .map((v) => Number(v.price))
        .filter((n) => Number.isFinite(n) && n > 0);
      items.push({
        title: p.title || null,
        url: `${base}/products/${p.handle}`,
        priceText: priced.length ? String(Math.min(...priced)) : null,
        soldOut: availableVariants.length === 0,
        imageUrl: p.images?.[0]?.src || null,
      });
    }
    await sleep(jitter(600, 0.3));
  }
  return items;
}

// 1) TradingCardMarket (Shopify) — previously scraped the homepage, which
// mixes nav/featured tiles without prices; the MTG collection JSON is exact.
async function crawlTradingCardMarket({ context }) {
  const items = await crawlShopifyCollectionJson({
    base: 'https://tradingcardmarket.com',
    handle: 'magic-the-gathering',
  });

  return items.map((x) => ({
    ...x,
    market: 'tradingcardmarket',
  }));
}

// 2) CollectorStore
async function crawlCollectorStore({ context }) {
  const startUrl = 'https://collectorstore.com/collections/all';
  const pagesToCrawl = 3;

  const evalOpts = {
    productUrlIncludes: 'collectorstore.com',
    productPathIncludes: '/products/',
  };

  const items = await crawlPaginatedCollection({
    startUrl,
    pagesToCrawl,
    context,
    evalOpts,
    evalFn: listingEvalCommon(),
  });

  return items.map((x) => ({
    ...x,
    market: 'collectorstore',
  }));
}

// 3) MinMaxGames
async function crawlMinMaxGames({ context }) {
  const startUrl = 'https://www.minmaxgames.com/collections/all';
  const pagesToCrawl = 3;

  const evalOpts = {
    productUrlIncludes: 'minmaxgames.com',
    productPathIncludes: '/products/',
  };

  const items = await crawlPaginatedCollection({
    startUrl,
    pagesToCrawl,
    context,
    evalOpts,
    evalFn: listingEvalCommon(),
  });

  return items.map((x) => ({
    ...x,
    market: 'minmaxgames',
  }));
}

// 4) GeekeryGames
async function crawlGeekeryGames({ context }) {
  const startUrl = 'https://geekerygames.com/collections/all';
  const pagesToCrawl = 3;

  const evalOpts = {
    productUrlIncludes: 'geekerygames.com',
    productPathIncludes: '/products/',
  };

  const items = await crawlPaginatedCollection({
    startUrl,
    pagesToCrawl,
    context,
    evalOpts,
    evalFn: listingEvalCommon(),
  });

  return items.map((x) => ({
    ...x,
    market: 'geekerygames',
  }));
}

// 5) SagaConcepts (moved from BigCommerce to Shopify; the old
// /trading-cards/... URL redirects to /collections/magic-the-gathering,
// so we read the collection's products.json instead of scraping HTML)
async function crawlSagaConcepts({ context }) {
  const items = await crawlShopifyCollectionJson({
    base: 'https://sagaconcepts.com',
    handle: 'magic-the-gathering',
  });

  console.log(`[SagaConcepts] Total items: ${items.length}`);
  return items.map((x) => ({
    ...x,
    market: 'sagaconcepts',
  }));
}

// 6) GameNerdz
async function crawlGameNerdz({ context }) {
  // The old /collections/all URL 404s now; the MTG category uses JS-hydrated
  // "store pass" cards with numbered pagination driven by a ?page= param.
  const startUrl = 'https://www.gamenerdz.com/magic-the-gathering';
  const pagesToCrawl = 5;

  const nextHrefFn = () => {
    const cur = Number(new URLSearchParams(location.search).get('page') || '1');
    const nums = Array.from(
      document.querySelectorAll('.store-pass-pagination a[aria-label^="Go to page"]')
    )
      .map((a) => Number((a.getAttribute('aria-label') || '').replace('Go to page ', '')))
      .filter((n) => Number.isFinite(n));
    const max = nums.length ? Math.max(...nums) : cur;
    if (cur >= max) return null;
    const u = new URL(location.href);
    u.searchParams.set('page', String(cur + 1));
    return u.href;
  };

  const items = await crawlPaginatedCollection({
    startUrl,
    pagesToCrawl,
    context,
    evalOpts: {},
    evalFn: listingEvalGameNerdz(),
    nextHrefFn,
    waitSelector: '.store-pass-product',
  });

  return items.map((x) => ({
    ...x,
    market: 'gamenerdz',
  }));
}

// -------------------- Main "crawl markets" entrypoint --------------------

async function crawlAllMarkets() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  });

  const all = [];

  try {
    // Add each market
    const markets = [
      crawlTradingCardMarket,
      crawlCollectorStore,
      crawlMinMaxGames,
      crawlGeekeryGames,
      crawlSagaConcepts,
      crawlGameNerdz,
    ];

    for (const fn of markets) {
      try {
        const items = await fn({ context });
        all.push(...items);
      } catch (e) {
        console.error('Market crawl failed:', e?.message || e);
      }
      await sleep(jitter(650, 0.5));
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return all;
}

// -------------------- Run all active products --------------------

async function newRealisticContext(browser) {
  return browser.newContext({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    viewport: { width: 1366, height: 768 },
  });
}

const LOCKS = new Map();
function acquireLock(key) {
  if (LOCKS.get(key)) return false;
  LOCKS.set(key, true);
  return true;
}
function releaseLock(key) {
  LOCKS.set(key, false);
}

async function runAllActiveProducts(context) {
  const startedAt = Date.now();
  const { data: products, error } = await supabase.from('tracked_products').select('*').eq('active', true);
  if (error) throw error;

  const results = [];

  for (const p of products) {
    const sku = p.canonical_sku;
    const fetchedAt = new Date().toISOString();

    if (p.forgeandfire_url) {
      try {
        const ff = await scrapeForgeAndFireProduct({ context, url: p.forgeandfire_url });

        const confirmedOutOfStock = ff.in_stock === false;
        const hasPrice = ff.price != null;

        if (!hasPrice && !confirmedOutOfStock) {
          await insertOffer({
            canonical_sku: sku,
            marketplace: 'forgeandfire',
            source_key: 'product',
            title: ff.title || p.display_name || sku,
            price: null,
            shipping: null,
            in_stock: null,
            url: ff.url || p.forgeandfire_url,
            fetched_at: fetchedAt,
            scrape_ok: false,
            error_text: `Price not found (raw="${ff.raw_price_text || ''}")`,
            image_url: normalizeImageUrl(ff.imageUrl, p.forgeandfire_url),
          });
          results.push({ sku, site: 'forgeandfire', ok: false, error: 'Price not found' });
        } else {
          await insertOffer({
            canonical_sku: sku,
            marketplace: 'forgeandfire',
            source_key: 'product',
            title: ff.title || p.display_name || sku,
            price: ff.price,
            shipping: null,
            in_stock: ff.in_stock === null ? true : ff.in_stock,
            url: ff.url || p.forgeandfire_url,
            fetched_at: fetchedAt,
            scrape_ok: ff.price != null && ff.in_stock !== null && ff.in_stock !== undefined,
            error_text: null,
            image_url: normalizeImageUrl(ff.imageUrl, p.forgeandfire_url),
          });
          results.push({ sku, site: 'forgeandfire', ok: true });
        }

        // Update tracked_products with image if we got one and it doesn't have one
        if (ff.imageUrl && !p.image_url) {
          const imgUrl = normalizeImageUrl(ff.imageUrl, p.forgeandfire_url);
          if (imgUrl) {
            await supabase
              .from('tracked_products')
              .update({ image_url: imgUrl })
              .eq('canonical_sku', sku);
          }
        }
      } catch (e) {
        await insertOffer({
          canonical_sku: sku,
          marketplace: 'forgeandfire',
          source_key: 'product',
          title: p.display_name || sku,
          price: null,
          shipping: null,
          in_stock: null,
          url: p.forgeandfire_url,
          fetched_at: fetchedAt,
          scrape_ok: false,
          error_text: String(e?.message || e),
        });
        results.push({ sku, site: 'forgeandfire', ok: false, error: String(e?.message || e) });
      }
    }

    results.push({ sku, ok: true });
  }

  return {
    ok: true,
    duration_ms: Date.now() - startedAt,
    products: products.length,
    results,
  };
}

// -------------------- Express app --------------------

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ ok: true, message: 'Scraper server running' });
});

/**
 * POST /run
 * Scrapes all active tracked_products (forgeandfire_url).
 * No body required — called by N8N on schedule.
 */
app.post('/run', async (_req, res) => {
  const lockKey = 'run';
  if (!acquireLock(lockKey)) return res.status(409).json({ ok: false, error: 'Run already in progress' });

  const startedAt = Date.now();
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await newRealisticContext(browser);

  try {
    const payload = await runAllActiveProducts(context);
    payload.duration_ms = Date.now() - startedAt;
    res.status(200).json(payload);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  } finally {
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
    releaseLock(lockKey);
  }
});

/**
 * GET /jobs/:market/crawl
 * market in:
 *  - tradingcardmarket
 *  - collectorstore
 *  - minmaxgames
 *  - geekerygames
 *  - sagaconcepts
 *  - gamenerdz
 *
 * Crawls listings (not individual product pages) and stores offers in Supabase.
 */
app.get('/jobs/:market/crawl', async (req, res) => {
  const market = safeText(req.params.market);
  const prefix = MARKET_PREFIXES[market];

  const marketFns = {
    tradingcardmarket: crawlTradingCardMarket,
    collectorstore: crawlCollectorStore,
    minmaxgames: crawlMinMaxGames,
    geekerygames: crawlGeekeryGames,
    sagaconcepts: crawlSagaConcepts,
    gamenerdz: crawlGameNerdz,
  };

  const fn = marketFns[market];
  if (!fn || !prefix) return res.status(400).json({ ok: false, error: `Unknown market: ${market}` });

  const lockKey = `job:${market}`;
  if (!acquireLock(lockKey)) return res.status(409).json({ ok: false, error: 'Run already in progress' });

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await newRealisticContext(browser);

  try {
    const rawItems = await fn({ context });

    // Normalize URLs and dedupe
    const items = rawItems
      .map((it) => ({ ...it, url: normalizeProductUrl(it.url) || it.url }))
      .filter((it) => it.url);
    const itemsBySku = dedupeByKey(items, (it) => slugToSkuPrefix(prefix, it.url));

    // Upsert tracked_products
    const trackedRows = itemsBySku.map((it) => ({
      canonical_sku: slugToSkuPrefix(prefix, it.url),
      display_name: it.title || slugToSkuPrefix(prefix, it.url),
      active: true,
      image_url: normalizeImageUrl(it.imageUrl, it.url) || null,
    }));
    if (trackedRows.length) await upsertTrackedProducts(trackedRows);

    // Insert offers
    const fetchedAt = new Date().toISOString();
    let okCount = 0;
    let failCount = 0;

    for (const it of itemsBySku) {
      const canonical_sku = slugToSkuPrefix(prefix, it.url);
      const price = parseMoney(it.priceText);
      const soldOut = it.soldOut === true;
      const scrape_ok = price != null;
      const in_stock = soldOut ? false : scrape_ok ? true : null;

      await insertOffer({
        canonical_sku,
        marketplace: market,
        source_key: 'category',
        title: safeText(it.title) || canonical_sku,
        price: scrape_ok ? price : null,
        shipping: null,
        in_stock,
        url: it.url,
        fetched_at: fetchedAt,
        scrape_ok,
        error_text: scrape_ok ? null : soldOut ? 'Sold out (no price found)' : `Price not found (raw="${it.priceText || ''}")`,
        image_url: normalizeImageUrl(it.imageUrl, it.url),
      });

      if (scrape_ok) okCount++;
      else failCount++;
    }

    res.json({ ok: true, market, products_found: itemsBySku.length, offers_ok: okCount, offers_failed: failCount, fetched_at: fetchedAt, duration_ms: Date.now() - Date.parse(fetchedAt) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  } finally {
    await context.close().catch(() => null);
    await browser.close().catch(() => null);
    releaseLock(lockKey);
  }
});

/**
 * GET /jobs/crawl_all
 * Crawls all markets and writes results to Supabase.
 */
app.get('/jobs/crawl_all', async (req, res) => {
  const lockKey = 'crawl_all';
  if (!acquireLock(lockKey)) return res.status(409).json({ ok: false, error: 'Crawl already in progress' });

  try {
    const items = await crawlAllMarkets();

    const results = [];
    const fetchedAt = new Date().toISOString();

    for (const it of items) {
      const prefix = MARKET_PREFIXES[it.market];
      if (!prefix) continue;

      const canonical_sku = slugToSkuPrefix(prefix, it.url);
      const price = parseMoney(it.priceText);
      const soldOut = it.soldOut === true;
      const scrape_ok = price != null;
      const in_stock = soldOut ? false : scrape_ok ? true : null;

      // Upsert tracked product
      await upsertTrackedProducts([{
        canonical_sku,
        display_name: it.title || canonical_sku,
        active: true,
        image_url: normalizeImageUrl(it.imageUrl, it.url) || null,
      }]);

      // Insert offer with correct DB column names
      await insertOffer({
        canonical_sku,
        marketplace: it.market,
        source_key: 'category',
        title: safeText(it.title) || canonical_sku,
        price: scrape_ok ? price : null,
        shipping: null,
        in_stock,
        url: normalizeProductUrl(it.url),
        fetched_at: fetchedAt,
        scrape_ok,
        error_text: scrape_ok ? null : soldOut ? 'Sold out' : `Price not found (raw="${it.priceText || ''}")`,
        image_url: normalizeImageUrl(it.imageUrl, it.url),
      });

      results.push({ canonical_sku, url: it.url, market: it.market });
    }

    res.json({ ok: true, count: results.length, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  } finally {
    releaseLock(lockKey);
  }
});

// -------------------- MTGStocks sealed scraper --------------------

/**
 * Detect product type from the product name string.
 * Returns: Pack, Display, Case, Master Case, Display Case, Bundle, Deck, or null
 */
function detectMtgstocksProductType(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes('master case'))  return 'Master Case';
  if (n.includes('display case')) return 'Display Case';
  if (n.includes('case'))         return 'Case';
  if (n.includes('display'))      return 'Display';
  if (n.includes('booster box'))  return 'Display';
  if (n.includes('bundle'))       return 'Bundle';
  if (n.includes('deck'))         return 'Deck';
  if (n.includes('pack'))         return 'Pack';
  if (n.includes('fat pack'))     return 'Bundle';
  if (n.includes('box'))          return 'Display';
  return null;
}

/**
 * GET /jobs/mtgstocks/scrape
 *
 * Scrapes mtgstocks.com/sealed for sealed product prices.
 * Inserts rows into mtgstocks_sealed_prices table.
 */
app.get('/jobs/mtgstocks/scrape', async (req, res) => {
  const lockKey = 'job:mtgstocks';
  if (!acquireLock(lockKey)) {
    return res.status(409).json({ ok: false, error: 'MTGStocks scrape already in progress' });
  }

  let browser;
  let context;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
    });
    context = await newRealisticContext(browser);
    const page = await context.newPage();
    await applyPoliteRouting(page);

    console.log('[MTGStocks] Navigating to /sealed ...');
    await gotoWithRetry(page, 'https://www.mtgstocks.com/sealed', { attempts: 3, delayMs: 2000 });

    // Wait for Angular to finish rendering the product tables
    // Use 'attached' state since many links may exist but not all are visible (dropdowns etc.)
    await page.waitForSelector('a[href^="/sealed/"][href*="-"]', { state: 'attached', timeout: 30000 });
    // Give Angular a moment to fully hydrate
    await sleep(3000);

    // Scroll to bottom to trigger any lazy-loaded sections
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await sleep(150);
      }
      await sleep(500);
    });

    // Extract products with set names from the card structure:
    // .card > .card-body > h4.card-title (set name) + table with product rows
    const products = await page.evaluate(() => {
      const results = [];
      const seenIds = new Set();

      const allLinks = document.querySelectorAll('a[href^="/sealed/"][href*="-"]');

      for (const link of allLinks) {
        const href = link.getAttribute('href') || '';
        const productName = link.textContent.trim();
        if (!productName || !href) continue;

        // Only match product links with numeric ID pattern (skip nav links)
        const match = href.match(/\/sealed\/(\d+)-(.+)/);
        if (!match) continue;

        const mtgstocksId = parseInt(match[1], 10);

        // Dedupe: only take each mtgstocks_id once
        if (seenIds.has(mtgstocksId)) continue;
        seenIds.add(mtgstocksId);

        const slug = match[1] + '-' + match[2];

        // Find set name from the closest .card > h4.card-title
        let setName = 'Unknown Set';
        const card = link.closest('.card');
        if (card) {
          const title = card.querySelector('h4.card-title') || card.querySelector('.card-title') || card.querySelector('h4');
          if (title) {
            setName = title.textContent.trim();
          }
        }

        // Find prices from the table row (td.sealed-set-price)
        const row = link.closest('tr');
        let avgPrice = null;
        let marketPrice = null;

        if (row) {
          const priceCells = row.querySelectorAll('td.sealed-set-price, td.text-end');
          const priceValues = [];
          for (const cell of priceCells) {
            const text = cell.textContent.trim();
            if (text && text !== 'N/A' && text !== '-') {
              const priceMatch = text.match(/([\d,]+\.?\d*)/);
              if (priceMatch) {
                priceValues.push(parseFloat(priceMatch[1].replace(/,/g, '')));
              }
            } else {
              priceValues.push(null);
            }
          }
          // First price cell = average, second = market
          if (priceValues.length >= 1) avgPrice = priceValues[0];
          if (priceValues.length >= 2) marketPrice = priceValues[1];
        }

        results.push({
          setName,
          productName,
          mtgstocksId,
          slug,
          avgPrice: Number.isFinite(avgPrice) ? avgPrice : null,
          marketPrice: Number.isFinite(marketPrice) ? marketPrice : null,
          href,
        });
      }

      return results;
    });

    console.log(`[MTGStocks] Extracted ${products.length} products from page`);

    if (products.length === 0) {
      console.log('[MTGStocks] No products found - page structure may have changed');
      return res.json({
        ok: true,
        warning: 'No products found - page structure may have changed',
        products_found: 0,
      });
    }

    // Insert into Supabase
    const fetchedAt = new Date().toISOString();
    let insertedCount = 0;
    let skippedCount = 0;

    // Batch insert for efficiency (chunks of 100)
    const batchSize = 100;
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      const rows = batch.map((p) => ({
        set_name: p.setName,
        product_name: p.productName,
        product_type: detectMtgstocksProductType(p.productName),
        mtgstocks_id: p.mtgstocksId,
        mtgstocks_slug: p.slug,
        avg_price: p.avgPrice,
        market_price: p.marketPrice,
        url: p.href ? `https://www.mtgstocks.com${p.href}` : null,
        fetched_at: fetchedAt,
      }));

      const { error: insertErr } = await supabase
        .from('mtgstocks_sealed_prices')
        .insert(rows);

      if (insertErr) {
        console.error(`[MTGStocks] Batch insert error:`, insertErr.message);
        skippedCount += batch.length;
      } else {
        insertedCount += batch.length;
      }
    }

    const duration = Date.now() - Date.parse(fetchedAt);
    console.log(`[MTGStocks] Done. Inserted ${insertedCount}, skipped ${skippedCount} in ${duration}ms`);

    res.json({
      ok: true,
      products_found: products.length,
      inserted: insertedCount,
      skipped: skippedCount,
      fetched_at: fetchedAt,
      duration_ms: duration,
    });
  } catch (e) {
    console.error('[MTGStocks] Scrape error:', e);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  } finally {
    if (context) await context.close().catch(() => null);
    if (browser) await browser.close().catch(() => null);
    releaseLock(lockKey);
  }
});

// -------------------- WatchCount eBay sold scraper --------------------

const COOKIE_FILE_WATCHCOUNT = './cookies_watchcount.json';

/**
 * Load WatchCount cookies from file if they exist.
 */
async function loadWatchCountCookies(context) {
  try {
    const raw = await fs.readFile(COOKIE_FILE_WATCHCOUNT, 'utf-8');
    const rawCookies = JSON.parse(raw);
    if (Array.isArray(rawCookies) && rawCookies.length > 0) {
      // Convert browser-extension format to Playwright format
      const cookies = rawCookies.map(c => {
        const cookie = {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
        };
        if (c.expirationDate) cookie.expires = c.expirationDate;
        if (c.httpOnly) cookie.httpOnly = true;
        if (c.secure) cookie.secure = true;
        if (c.sameSite) {
          const ss = String(c.sameSite).toLowerCase();
          if (ss === 'strict') cookie.sameSite = 'Strict';
          else if (ss === 'lax') cookie.sameSite = 'Lax';
          else cookie.sameSite = 'None';
        }
        return cookie;
      });
      await context.addCookies(cookies);
      console.log(`[watchcount] Loaded ${cookies.length} cookies from ${COOKIE_FILE_WATCHCOUNT}`);
      return true;
    }
  } catch (err) {
    console.log('[watchcount] Cookie load error:', err.message || 'No cookie file found');
  }
  return false;
}

/**
 * Detect if WatchCount is showing a captcha/challenge page.
 */
async function detectCaptcha(page) {
  const result = await page.evaluate(() => {
    const html = document.documentElement.innerHTML.toLowerCase();
    const bodyText = (document.body?.innerText || '').substring(0, 2000);
    const matches = [];
    if (html.includes('g-recaptcha')) matches.push('g-recaptcha');
    if (html.includes('challenge-form')) matches.push('challenge-form');
    if (html.includes('verify you are human')) matches.push('verify you are human');
    // Only flag 'recaptcha' if it appears in a visible context, not just a script tag
    if (html.includes('recaptcha') && !html.includes('g-recaptcha')) {
      // Check if it's just in a script src or actually rendered
      const visibleRecaptcha = bodyText.toLowerCase().includes('recaptcha') ||
        !!document.querySelector('.recaptcha, #recaptcha, [class*="recaptcha"]');
      if (visibleRecaptcha) matches.push('recaptcha-visible');
    }
    return { detected: matches.length > 0, matches, bodyPreview: bodyText.substring(0, 500) };
  });
  console.log(`[watchcount] Captcha check: detected=${result.detected}, matches=[${result.matches.join(',')}]`);
  if (result.detected) {
    console.log(`[watchcount] Page body preview: ${result.bodyPreview}`);
  }
  return result.detected;
}

/**
 * Parse a WatchCount detail page text block for labeled fields.
 * Uses regex against the full text to avoid brittle CSS selectors.
 */
function parseDetailFields(text) {
  const fields = {};
  const num = (pattern) => {
    const m = text.match(pattern);
    return m ? parseFloat(m[1].replace(/,/g, '')) : null;
  };
  const str = (pattern) => {
    const m = text.match(pattern);
    return m ? m[1].trim() : null;
  };

  fields.watchers = num(/Watchers?\s*[:=]\s*(\d[\d,]*)/i);
  fields.sold_count = num(/Sold\s*[:=]\s*(\d[\d,]*)/i);
  fields.location = str(/Location\s*[:=]\s*(.+?)(?:\n|$)/i);
  fields.sold_date_raw = str(/SoldDate\s*[:=]\s*(.+?)(?:\n|$)/i);
  fields.ran_for_raw = str(/RanFor\s*[:=]\s*(.+?)(?:\n|$)/i);
  fields.price_raw = str(/Price\s*[:=]\s*\$?([\d,.]+)/i);
  fields.type = str(/Type\s*[:=]\s*(.+?)(?:\n|$)/i);
  fields.shipping = str(/Shipping\s*[:=]\s*(.+?)(?:\n|$)/i);
  fields.hist_sold_total = num(/HistSold\s*[:=]\s*(\d[\d,]*)/i);
  fields.hist_last_sold_raw = str(/HistLastSold\s*[:=]\s*\$?([\d,.]+)/i);
  fields.hist_last_sold_date_raw = str(/HistLastSoldDate\s*[:=]\s*(.+?)(?:\n|$)/i);

  // Parse ran_for into minutes
  if (fields.ran_for_raw) {
    let mins = 0;
    const daysM = fields.ran_for_raw.match(/(\d+)\s*d/i);
    const hrsM = fields.ran_for_raw.match(/(\d+)\s*h/i);
    const minsM = fields.ran_for_raw.match(/(\d+)\s*m/i);
    if (daysM) mins += parseInt(daysM[1]) * 24 * 60;
    if (hrsM) mins += parseInt(hrsM[1]) * 60;
    if (minsM) mins += parseInt(minsM[1]);
    fields.ran_for_minutes = mins || null;
  }

  return fields;
}

/**
 * Parse a sold date string into a Date.
 * WatchCount uses formats like "Jan-25-2025" or "01/25/2025 PST"
 */
function parseSoldDate(raw) {
  if (!raw) return null;
  try {
    const d = new Date(raw.replace(/\s*(PST|PDT|EST|EDT|CST|CDT|MST|MDT)\s*/gi, '').trim());
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/**
 * GET /jobs/watchcount/scrape
 *
 * Query params:
 *   q             - search query (required)
 *   days          - lookback period (default: 30days)
 *   expand_history - true/false (default: false)
 *
 * Returns: { ok, query, rows_found, rows_upserted, history_events, errors }
 */
app.get('/jobs/watchcount/scrape', async (req, res) => {
  const lockKey = 'job:watchcount';
  if (!acquireLock(lockKey)) {
    return res.status(409).json({ ok: false, error: 'WatchCount scrape already in progress' });
  }

  const query = (req.query.q || '').trim();
  const days = req.query.days || '30days';
  const expandHistory = req.query.expand_history === 'true';

  if (!query) {
    releaseLock(lockKey);
    return res.status(400).json({ ok: false, error: 'Missing required query param: q' });
  }

  let browser;
  const stats = { query, rows_found: 0, rows_upserted: 0, history_events: 0, errors: [] };

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await newRealisticContext(browser);
    await loadWatchCountCookies(context);

    const page = await context.newPage();
    await applyPoliteRouting(page);

    // Step 1: Navigate to WatchCount results
    const searchUrl = `https://www.watchcount.com/sold/${encodeURIComponent(query).replace(/%20/g, '+')}/-/all?lastSoldDate=${days}&site=EBAY_US`;
    console.log(`[watchcount] Navigating to: ${searchUrl}`);
    await gotoWithRetry(page, searchUrl);

    // Check for captcha
    const hasCaptcha = await detectCaptcha(page);
    if (hasCaptcha) {
      await browser.close();
      releaseLock(lockKey);
      return res.status(403).json({
        ok: false,
        error: 'captcha_detected',
        message: 'WatchCount requires captcha verification. Solve it manually in a browser, export cookies, and place them in cookies_watchcount.json on the server.',
      });
    }

    // Step 2: Collect all result rows across pagination
    const allRows = [];
    let pageNum = 1;

    while (true) {
      console.log(`[watchcount] Scraping results page ${pageNum}...`);

      // Extract rows from current page
      const rows = await page.evaluate(() => {
        const results = [];
        // WatchCount uses table rows or div-based listings
        // Try multiple selectors for resilience
        const items = document.querySelectorAll('.sold-item, .result-item, tr.sold, [class*="sold"]');

        // If specific selectors fail, try looking at all links in the results area
        if (items.length === 0) {
          // Fallback: find all links that look like detail page links
          const links = document.querySelectorAll('a[href*="/sold/"]');
          links.forEach(a => {
            const row = a.closest('tr, div, li');
            if (!row) return;
            const text = row.textContent || '';
            const title = a.textContent?.trim();
            if (!title || title.length < 5) return;

            // Try to extract price from the row text
            const priceMatch = text.match(/\$\s*([\d,.]+)/);
            const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

            results.push({
              title,
              price,
              detail_url: a.href,
              raw_text: text.substring(0, 500),
            });
          });
        } else {
          items.forEach(item => {
            const linkEl = item.querySelector('a[href*="/sold/"], a[href*="/item/"]') || item.querySelector('a');
            const title = linkEl?.textContent?.trim() || item.querySelector('.title, .item-title')?.textContent?.trim();
            if (!title || title.length < 5) return;

            const text = item.textContent || '';
            const priceMatch = text.match(/\$\s*([\d,.]+)/);
            const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

            results.push({
              title,
              price,
              detail_url: linkEl?.href || null,
              raw_text: text.substring(0, 500),
            });
          });
        }
        return results;
      });

      allRows.push(...rows);

      // Check for next page
      const nextUrl = await page.evaluate(() => {
        const nextLink = document.querySelector('a[rel="next"], a:has-text("Next"), a:has-text("»"), .pagination a.next');
        if (!nextLink) {
          // Also check for numbered pagination links
          const paginationLinks = document.querySelectorAll('.pagination a, nav a');
          for (const l of paginationLinks) {
            if (l.textContent?.trim() === 'Next' || l.textContent?.trim() === '›') {
              return l.href;
            }
          }
          return null;
        }
        return nextLink.href;
      });

      if (!nextUrl) break;
      pageNum++;
      await sleep(jitter(1000, 0.5));
      await gotoWithRetry(page, nextUrl);
    }

    stats.rows_found = allRows.length;
    console.log(`[watchcount] Found ${allRows.length} sold items across ${pageNum} pages`);

    // Step 3: For each row, open detail page and extract structured fields
    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row.detail_url) continue;

      try {
        console.log(`[watchcount] Detail ${i + 1}/${allRows.length}: ${row.title?.substring(0, 50)}...`);
        await sleep(jitter(1200, 0.5));

        const detailPage = await context.newPage();
        await applyPoliteRouting(detailPage);

        try {
          await gotoWithRetry(detailPage, row.detail_url, { attempts: 2, delayMs: 2000 });

          // Extract text content and links from detail page
          const detail = await detailPage.evaluate(() => {
            const text = document.body?.innerText || '';

            // Find eBay purchase history link
            let ebayUrl = null;
            const allLinks = document.querySelectorAll('a');
            for (const a of allLinks) {
              if ((a.textContent || '').toLowerCase().includes('purchase history') ||
                  (a.textContent || '').toLowerCase().includes('see on ebay') ||
                  (a.href || '').includes('ebay.com')) {
                ebayUrl = a.href;
                break;
              }
            }

            // Find primary category
            let categoryPath = null;
            let categoryUrl = null;
            for (const a of allLinks) {
              if ((a.textContent || '').toLowerCase().includes('primary category') ||
                  (a.previousElementSibling?.textContent || '').toLowerCase().includes('category')) {
                categoryPath = a.textContent?.trim();
                categoryUrl = a.href;
                break;
              }
            }

            return { text, ebayUrl, categoryPath, categoryUrl };
          });

          // Parse labeled fields from text
          const fields = parseDetailFields(detail.text);

          // Extract eBay item ID from URL
          let ebayItemId = null;
          if (detail.ebayUrl) {
            const itemIdMatch = detail.ebayUrl.match(/\/itm\/(\d+)/);
            if (itemIdMatch) ebayItemId = itemIdMatch[1];
          }

          // Parse dates
          const soldDateUtc = parseSoldDate(fields.sold_date_raw || row.raw_text?.match(/(\w{3}-\d{1,2}-\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/)?.[0]);
          const histLastSoldDate = fields.hist_last_sold_date_raw ? parseSoldDate(fields.hist_last_sold_date_raw)?.substring(0, 10) : null;

          // Build upsert row
          const upsertRow = {
            query,
            title: row.title || null,
            sold_date_utc: soldDateUtc,
            sold_date_raw: fields.sold_date_raw || null,
            price_usd: fields.price_raw ? parseFloat(fields.price_raw.replace(/,/g, '')) : row.price,
            type: fields.type || null,
            shipping: fields.shipping || null,
            ran_for_minutes: fields.ran_for_minutes || null,
            watchers: fields.watchers || null,
            sold_count: fields.sold_count || null,
            location: fields.location || null,
            ebay_url: detail.ebayUrl || null,
            ebay_item_id: ebayItemId,
            watchcount_url: searchUrl,
            watchcount_detail_url: row.detail_url,
            primary_category_path: detail.categoryPath || null,
            primary_category_url: detail.categoryUrl || null,
            hist_sold_total: fields.hist_sold_total || null,
            hist_last_sold_price_usd: fields.hist_last_sold_raw ? parseFloat(fields.hist_last_sold_raw.replace(/,/g, '')) : null,
            hist_last_sold_date: histLastSoldDate || null,
            scraped_at: new Date().toISOString(),
          };

          // Upsert to Supabase
          const { error: upsertErr } = await supabase
            .from('watchcount_sold_events')
            .upsert([upsertRow], {
              onConflict: ebayItemId ? 'ebay_item_id,sold_date_utc,price_usd' : 'query,sold_date_raw,price_usd,title',
              ignoreDuplicates: false,
            });

          if (upsertErr) {
            // If unique constraint fails on one key, try without onConflict (plain insert)
            const { error: insertErr } = await supabase
              .from('watchcount_sold_events')
              .insert([upsertRow]);
            if (insertErr && !insertErr.message.includes('duplicate')) {
              stats.errors.push(`Upsert failed for "${row.title}": ${insertErr.message}`);
            }
          } else {
            stats.rows_upserted++;
          }

          // Step 4: Expand eBay purchase history if enabled
          if (expandHistory && detail.ebayUrl && ebayItemId) {
            try {
              const histPage = await context.newPage();
              await applyPoliteRouting(histPage);
              await gotoWithRetry(histPage, detail.ebayUrl, { attempts: 2, delayMs: 3000 });

              const transactions = await histPage.evaluate(() => {
                const txns = [];
                // eBay purchase history tables/lists
                const rows = document.querySelectorAll('table tr, .purchase-history-row, [class*="transaction"]');
                rows.forEach(tr => {
                  const cells = tr.querySelectorAll('td, .cell');
                  if (cells.length < 2) return;
                  const text = tr.textContent || '';
                  const priceMatch = text.match(/\$\s*([\d,.]+)/);
                  const dateMatch = text.match(/(\w{3}\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/);
                  const qtyMatch = text.match(/Qty\s*[:=]?\s*(\d+)/i);
                  if (priceMatch) {
                    txns.push({
                      date_raw: dateMatch ? dateMatch[1] : null,
                      price: parseFloat(priceMatch[1].replace(/,/g, '')),
                      quantity: qtyMatch ? parseInt(qtyMatch[1]) : null,
                      country: null, // parse if visible
                    });
                  }
                });
                return txns;
              });

              for (const txn of transactions) {
                const { error: histErr } = await supabase
                  .from('ebay_purchase_history_events')
                  .upsert([{
                    ebay_item_id: ebayItemId,
                    ebay_url: detail.ebayUrl,
                    transaction_date_utc: txn.date_raw ? parseSoldDate(txn.date_raw) : null,
                    transaction_date_raw: txn.date_raw,
                    transaction_price_usd: txn.price,
                    quantity: txn.quantity,
                    buyer_country: txn.country,
                    scraped_at: new Date().toISOString(),
                  }], {
                    onConflict: 'ebay_item_id,transaction_date_raw,transaction_price_usd,quantity',
                    ignoreDuplicates: true,
                  });

                if (!histErr) stats.history_events++;
              }

              await histPage.close();
            } catch (histError) {
              stats.errors.push(`Purchase history failed for ${ebayItemId}: ${histError?.message}`);
            }
          }
        } finally {
          await detailPage.close();
        }
      } catch (detailError) {
        stats.errors.push(`Detail page failed for "${row.title}": ${detailError?.message}`);
      }
    }

    console.log(`[watchcount] Done: ${stats.rows_upserted} upserted, ${stats.history_events} history events, ${stats.errors.length} errors`);
    res.json({ ok: true, ...stats });
  } catch (e) {
    console.error('[watchcount] Fatal error:', e);
    res.status(500).json({ ok: false, error: e?.message || String(e), ...stats });
  } finally {
    if (browser) await browser.close().catch(() => null);
    releaseLock(lockKey);
  }
});

/**
 * GET /jobs/watchcount/save-cookies
 *
 * Opens a non-headless browser to WatchCount so the operator can solve captcha,
 * then saves cookies to cookies_watchcount.json.
 * Pass ?headless=true to save from an existing headless session.
 */
app.get('/jobs/watchcount/save-cookies', async (req, res) => {
  let browser;
  try {
    const headless = req.query.headless === 'true';
    browser = await chromium.launch({
      headless,
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await newRealisticContext(browser);
    const page = await context.newPage();

    await page.goto('https://www.watchcount.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (!headless) {
      // Wait for the operator to solve captcha (up to 5 minutes)
      console.log('[watchcount] Browser opened. Solve captcha if needed, then the cookies will be saved...');
      await page.waitForTimeout(10000); // give 10s for page to fully load
    }

    const cookies = await context.cookies();
    await fs.writeFile(COOKIE_FILE_WATCHCOUNT, JSON.stringify(cookies, null, 2));
    console.log(`[watchcount] Saved ${cookies.length} cookies to ${COOKIE_FILE_WATCHCOUNT}`);

    await browser.close();
    res.json({ ok: true, cookies_saved: cookies.length });
  } catch (e) {
    if (browser) await browser.close().catch(() => null);
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// -------------------- eBay Sold Listings Scraper --------------------

/**
 * Parsing helpers for eBay sold listings search results
 */

function parseEbayPrice(priceText) {
  if (!priceText) return null;
  const cleaned = priceText.replace(/,/g, '');
  const match = cleaned.match(/\$\s*([\d.]+)/);
  return match ? parseFloat(match[1]) : null;
}

function parseShippingCost(shippingText) {
  if (!shippingText) return null;
  const lower = shippingText.toLowerCase();
  if (lower.includes('free')) return 0;
  const match = shippingText.replace(/,/g, '').match(/\$\s*([\d.]+)/);
  return match ? parseFloat(match[1]) : null;
}

function parseEbaySoldDate(raw) {
  if (!raw) return null;
  const dateStr = raw.replace(/^Sold\s+/i, '').trim();
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function parseBidsAndType(bidsText) {
  if (!bidsText) return { bids: null, type: 'buy_it_now' };
  const match = bidsText.match(/(\d+)\s*bid/i);
  if (match) return { bids: parseInt(match[1]), type: 'auction' };
  return { bids: null, type: 'buy_it_now' };
}

function parseSoldCount(qtyText) {
  if (!qtyText) return null;
  const match = qtyText.match(/(\d+)\+?\s*sold/i);
  return match ? parseInt(match[1]) : null;
}

function extractEbayItemId(url) {
  if (!url) return null;
  const match = url.match(/\/itm\/(?:.*\/)?(\d+)/);
  return match ? match[1] : null;
}

/**
 * GET /jobs/ebay-sold/scrape?q={query}&max_pages={1-10}
 *
 * Scrapes eBay sold listings. Spawns a child process (ebay-scrape-worker.js)
 * to run Playwright in isolation — running Chromium in the Express process
 * causes "Target crashed" on EC2 due to memory fragmentation.
 */
app.get('/jobs/ebay-sold/scrape', async (req, res) => {
  const lockKey = 'job:ebay-sold';
  if (!acquireLock(lockKey)) {
    return res.status(409).json({ ok: false, error: 'eBay sold scrape already in progress' });
  }

  const query = (req.query.q || '').trim();
  const maxPages = Math.min(parseInt(req.query.max_pages) || 1, 10);

  if (!query) {
    releaseLock(lockKey);
    return res.status(400).json({ ok: false, error: 'Missing required query param: q' });
  }

  const stats = { query, rows_found: 0, rows_upserted: 0, pages_scraped: 0, errors: [] };

  try {
    // Spawn scrape as a child process to isolate Chromium memory from Express.
    const { execFile } = require('child_process');
    const workerResult = await new Promise((resolve, reject) => {
      const child = execFile('node', ['/app/ebay-scrape-worker.js', query, String(maxPages)], {
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (stderr) console.log(`[ebay-sold] Worker log:\n${stderr}`);
        if (err) {
          console.error(`[ebay-sold] Worker error:`, err.message);
          return reject(new Error(err.message));
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseErr) {
          console.error(`[ebay-sold] Bad worker output: ${stdout.substring(0, 500)}`);
          reject(new Error('Worker returned invalid JSON'));
        }
      });
    });

    if (!workerResult.ok) {
      throw new Error(workerResult.error || 'Worker failed');
    }

    const allRows = workerResult.items || [];
    stats.pages_scraped = workerResult.pages || 0;
    stats.rows_found = allRows.length;
    stats.errors.push(...(workerResult.errors || []));
    console.log(`[ebay-sold] Worker returned ${allRows.length} items`);

    // Parse and upsert each row
    for (const raw of allRows) {
      try {
        const parsed = parseBidsAndType(raw.bidsText);
        const ebayItemId = raw.itemId || extractEbayItemId(raw.url);
        const soldDateUtc = parseEbaySoldDate(raw.soldDateRaw);
        const priceUsd = parseEbayPrice(raw.priceText);

        // Skip rows without a price
        if (priceUsd === null) continue;

        const upsertRow = {
          query,
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

        const conflictKey = ebayItemId
          ? 'ebay_item_id,sold_date_utc,price_usd'
          : 'query,sold_date_raw,price_usd,title';

        const { error: upsertErr } = await supabase
          .from('ebay_sold_events')
          .upsert([upsertRow], { onConflict: conflictKey, ignoreDuplicates: false });

        if (upsertErr) {
          // Fallback: try plain insert, ignore actual duplicates
          const { error: insertErr } = await supabase
            .from('ebay_sold_events')
            .insert([upsertRow]);
          if (insertErr && !insertErr.message?.includes('duplicate')) {
            stats.errors.push(`Row error: ${insertErr.message}`);
          } else {
            stats.rows_upserted++;
          }
        } else {
          stats.rows_upserted++;
        }
      } catch (rowErr) {
        stats.errors.push(`Parse error: ${rowErr?.message || String(rowErr)}`);
      }
    }

    console.log(`[ebay-sold] Done: ${stats.rows_upserted} upserted, ${stats.errors.length} errors`);
    res.json({ ok: true, ...stats });
  } catch (e) {
    console.error('[ebay-sold] Fatal error:', e);
    res.status(500).json({ ok: false, error: e?.message || String(e), ...stats });
  } finally {
    releaseLock(lockKey);
  }
});

// -------------------- Batch classification endpoint --------------------

/**
 * POST /jobs/classify
 * Runs batch classification on unclassified offers via Supabase RPC.
 * Called by n8n after scraping completes.
 */
app.post('/jobs/classify', async (_req, res) => {
  const lockKey = 'job:classify';
  if (!acquireLock(lockKey)) {
    return res.status(409).json({ ok: false, error: 'Classification already in progress' });
  }

  try {
    const { data, error } = await supabase.rpc('run_batch_classification');
    if (error) throw new Error(`RPC error: ${error.message}`);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  } finally {
    releaseLock(lockKey);
  }
});

// -------------------- Start server --------------------

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});