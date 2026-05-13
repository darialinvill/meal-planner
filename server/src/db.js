import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL is not set — server will fail to query.');
}

function shouldUseSsl() {
  const url = process.env.DATABASE_URL || '';
  if (!url) return false;
  if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('sslmode=disable')) {
    return false;
  }
  // Managed providers (Railway, Render, Heroku, Supabase, Neon) all need this:
  // self-signed cert chain, but the connection itself must be encrypted.
  return { rejectUnauthorized: false };
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSsl(),
  max: 10,
});

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});

// Run schema.sql at boot. Uses CREATE TABLE IF NOT EXISTS so it's idempotent.
export async function initSchema() {
  const sql = readFileSync(resolve(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

// Helper for routes that just want the rows array.
export async function query(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

// First row or null.
export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}

// Run a series of statements in a transaction. The callback receives a
// dedicated client; use client.query(...) inside it.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
