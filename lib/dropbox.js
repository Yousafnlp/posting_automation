import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env, required, fetchJson } from './env.js';

let cached = null;

async function accessToken() {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const body = await fetchJson(
    'https://api.dropboxapi.com/oauth2/token',
    {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: required('DROPBOX_REFRESH_TOKEN'),
        client_id: required('DROPBOX_APP_KEY'),
        client_secret: required('DROPBOX_APP_SECRET'),
      }),
    },
    'Dropbox token refresh',
  );
  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

export const dropboxPath = (fileName) =>
  `${env('DROPBOX_FOLDER', '/reels').replace(/\/$/, '')}/${fileName}`;

export async function downloadFile(dbxPath, destDir) {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dbxPath }).replace(
        /[\u007f-￿]/g,
        (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
      ),
    },
  });
  if (!res.ok) throw new Error(`Dropbox download of ${dbxPath} failed (${res.status}): ${await res.text()}`);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(dbxPath));
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  return dest;
}

// Returns a direct-download URL that Instagram/Facebook servers can fetch.
// Reuses the existing link if one was already created (Make failed on reruns here).
export async function getDirectLink(dbxPath) {
  const headers = { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' };
  let url;
  try {
    const body = await fetchJson(
      'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ path: dbxPath, settings: { requested_visibility: 'public' } }),
      },
      'Dropbox create shared link',
    );
    url = body.url;
  } catch (err) {
    if (err.status !== 409) throw err;
    const existing = err.body?.error?.shared_link_already_exists?.metadata?.url;
    if (existing) {
      url = existing;
    } else {
      const list = await fetchJson(
        'https://api.dropboxapi.com/2/sharing/list_shared_links',
        { method: 'POST', headers, body: JSON.stringify({ path: dbxPath, direct_only: true }) },
        'Dropbox list shared links',
      );
      url = list.links?.[0]?.url;
      if (!url) throw err;
    }
  }
  const direct = new URL(url.replace('www.dropbox.com', 'dl.dropboxusercontent.com'));
  direct.searchParams.set('dl', '1');
  return direct.toString();
}
