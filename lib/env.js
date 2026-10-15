import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_FILE = path.join(ROOT, '.tokens.json');

export const env = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
};

export function required(name) {
  const v = env(name);
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

export const has = (...names) => names.every((n) => env(n));

// Tokens that rotate on refresh (TikTok) are persisted here, not in .env.
export function readTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function writeTokens(patch) {
  const next = { ...readTokens(), ...patch };
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
}

export async function fetchJson(url, options = {}, label = url) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${label} failed (${res.status}): ${text.slice(0, 500)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
