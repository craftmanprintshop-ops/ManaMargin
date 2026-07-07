// Runs scraper jobs in CI: starts server.js locally, hits the given job
// endpoints in order, then shuts down. Replaces the n8n schedule workflows.
//
// Usage: node jobs/run-jobs.mjs [--classify] <endpoint> [<endpoint> ...]
//   e.g. node jobs/run-jobs.mjs --classify /jobs/tradingcardmarket/crawl /run
//
// --classify calls the run_batch_classification RPC after each successful
// endpoint, matching what the n8n workflows did.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;
const JOB_TIMEOUT_MS = 60 * 60 * 1000;

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const classify = args.includes('--classify');
const endpoints = args.filter((a) => a !== '--classify');
if (endpoints.length === 0) {
  console.error('No job endpoints given');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(proc) {
  for (let i = 0; i < 60; i++) {
    if (proc.exitCode !== null) {
      throw new Error(`server exited early with code ${proc.exitCode}`);
    }
    try {
      const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error('server did not become ready within 60s');
}

// Classify pending offers in bounded batches. The all-in-one
// run_batch_classification() RPC loops until the whole backlog is done inside
// a single SQL statement, which hits Supabase's statement timeout as soon as
// a backlog exists — so we drive the loop from here with the bounded
// classify_pending_offers(batch_limit) RPC instead. On a statement timeout
// the batch size is halved and processing continues.
async function runClassification() {
  let batchLimit = 250;
  let totals = { processed: 0, classified: 0, skipped: 0 };
  for (let i = 0; i < 400; i++) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/classify_pending_offers`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batch_limit: batchLimit }),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    const text = await res.text();
    if (!res.ok) {
      if (text.includes('57014') && batchLimit > 25) {
        batchLimit = Math.floor(batchLimit / 2);
        console.warn(`  classification batch timed out; retrying with batch_limit=${batchLimit}`);
        continue;
      }
      throw new Error(`classify_pending_offers failed: ${res.status} ${text.slice(0, 300)}`);
    }
    const [row] = JSON.parse(text);
    totals.processed += row.total_processed;
    totals.classified += row.total_classified;
    totals.skipped += row.total_skipped;
    if (row.total_processed === 0) break;
  }
  console.log(`  classification done: processed=${totals.processed} classified=${totals.classified} skipped=${totals.skipped}`);
}

const server = spawn(process.execPath, ['server.js'], {
  cwd: SERVER_DIR,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: process.env,
});

let failed = false;
try {
  await waitForServer(server);
  console.log('server ready');

  for (const ep of endpoints) {
    const method = ep === '/run' ? 'POST' : 'GET';
    console.log(`\n=== ${method} ${ep} ===`);
    const started = Date.now();
    try {
      const res = await fetch(`${BASE}${ep}`, {
        method,
        signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
      });
      const text = await res.text();
      const secs = Math.round((Date.now() - started) / 1000);
      console.log(`-> ${res.status} in ${secs}s: ${text.slice(0, 1000)}`);

      let ok = res.ok;
      try {
        const body = JSON.parse(text);
        if (body && body.ok === false) ok = false;
      } catch {}

      if (!ok) {
        failed = true;
        console.error(`JOB FAILED: ${ep}`);
        continue;
      }
      if (classify) await runClassification();
    } catch (err) {
      failed = true;
      console.error(`JOB ERRORED: ${ep}:`, err.message);
    }
  }
} finally {
  server.kill('SIGTERM');
}

process.exit(failed ? 1 : 0);
