# ManaMargin scraper

Playwright/Express scraper that used to run on EC2 behind n8n; now runs on
GitHub Actions schedules (see `.github/workflows/`). All jobs write to
Supabase using `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (repo Actions
secrets in CI, `.env` locally — never commit it).

## Schedules (UTC)

| Workflow | Cadence | What it does |
|---|---|---|
| `scrape-retailers.yml` | every 8h | Crawls TradingCardMarket, CollectorStore, MinMaxGames, GeekeryGames, SagaConcepts, GameNerdz + Forge & Fire tracked products (`/run`), then batch classification |
| `scrape-mtgstocks.yml` | every 12h | MTGStocks sealed prices |
| `botbox-ev.yml` | every 12h | BotBox EV calculations API -> `botbox_ev_calculations` |
| `mtgjson-daily.yml` | daily 11:00 | MTGJSON AllPricesToday + AllPrintings sets/cards imports |

## Layout

- `server.js` — the original scraper server (unchanged); exposes `/jobs/...`
  endpoints and `/run`
- `jobs/run-jobs.mjs` — CI runner: starts `server.js`, hits the given job
  endpoints, exits nonzero if any fail
- `jobs/botbox-ev.mjs`, `jobs/mtgjson-*.mjs` — standalone jobs ported from
  the old n8n workflows (originals archived in `../n8n/` and in the offline
  backup)

## Run locally

```
cd scraper
npm install
npx playwright install chromium
node jobs/run-jobs.mjs /jobs/mtgstocks/scrape   # needs .env vars exported
```
