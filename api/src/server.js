'use strict';

// The "control plane": creating and listing short links.
// - writes canonical data to Postgres
// - caches code -> url in Redis so the Go redirect service stays fast
// - fetches click totals from the Python analytics service over HTTP

const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('redis');

// Read a value from NAME_FILE (a mounted secret) if present, else from NAME.
function fromFileOrEnv(name, fallback = '') {
  const file = process.env[`${name}_FILE`];
  if (file && fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8').trim();
  }
  return process.env[name] || fallback;
}

const PORT = parseInt(process.env.PORT || '3000', 10);
const ANALYTICS_URL = process.env.ANALYTICS_URL || 'http://analytics:8000';

const pool = new Pool({
  host: process.env.PGHOST || 'postgres',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'shortlink',
  password: fromFileOrEnv('PGPASSWORD'),
  database: process.env.PGDATABASE || 'shortlink',
  max: 5,
});

const redis = createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
redis.on('error', (err) => console.error('redis error:', err.message));

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
function genCode(len = 7) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const app = express();
app.use(express.json());

app.get('/api/healthz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: err.message });
  }
});

// Create a short link.
app.post('/api/links', async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'a valid http(s) url is required' });
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();
    try {
      await pool.query('INSERT INTO links(code, target_url) VALUES($1, $2)', [code, url]);
      await pool.query(
        'INSERT INTO click_stats(code, clicks) VALUES($1, 0) ON CONFLICT DO NOTHING',
        [code],
      );
      await redis.set(`link:${code}`, url, { EX: 3600 });
      return res.status(201).json({ code, target_url: url, short_path: `/r/${code}` });
    } catch (err) {
      if (err.code === '23505') continue; // unique_violation: code collided, try again
      console.error('create error:', err.message);
      return res.status(500).json({ error: 'internal error' });
    }
  }
  res.status(500).json({ error: 'could not allocate a unique code' });
});

// List the most recent links.
app.get('/api/links', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT code, target_url, created_at FROM links ORDER BY created_at DESC LIMIT 50',
    );
    res.json({ links: rows });
  } catch (err) {
    console.error('list error:', err.message);
    res.status(500).json({ error: 'internal error' });
  }
});

// Proxy click stats from the analytics service — a real service-to-service call.
app.get('/api/links/:code/stats', async (req, res) => {
  try {
    const r = await fetch(`${ANALYTICS_URL}/stats/${encodeURIComponent(req.params.code)}`);
    if (!r.ok) return res.status(r.status).json({ error: 'stats unavailable' });
    res.json(await r.json());
  } catch (err) {
    res.status(502).json({ error: 'analytics service unreachable' });
  }
});

async function main() {
  await redis.connect();
  app.listen(PORT, () => console.log(`api listening on ${PORT}`));
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
