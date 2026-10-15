import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
