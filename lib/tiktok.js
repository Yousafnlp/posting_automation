import fs from 'node:fs';
import { env, required, fetchJson, readTokens, writeTokens, sleep } from './env.js';

const API = 'https://open.tiktokapis.com/v2';
const MB = 1024 * 1024;

export async function tiktokAccessToken() {
  const t = readTokens().tiktok;
  if (!t?.refresh_token) throw new Error('No TikTok token yet — run: npm run auth:tiktok');
  if (t.access_token && t.expires_at > Date.now() + 5 * 60_000) return t.access_token;

  const body = await fetchJson(
    `${API}/oauth/token/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: required('TIKTOK_CLIENT_KEY'),
        client_secret: required('TIKTOK_CLIENT_SECRET'),
        grant_type: 'refresh_token',
        refresh_token: t.refresh_token,
      }),
    },
    'TikTok token refresh',
  );
  if (!body.access_token) throw new Error(`TikTok token refresh failed: ${JSON.stringify(body)}`);
  saveTikTokTokens(body);
  return body.access_token;
}

export function saveTikTokTokens(body) {
  writeTokens({
    tiktok: {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      open_id: body.open_id,
      expires_at: Date.now() + body.expires_in * 1000,
    },
  });
}

async function api(path, payload, label) {
  const body = await fetchJson(
    `${API}${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await tiktokAccessToken()}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(payload),
    },
    label,
  );
  if (body.error && body.error.code !== 'ok') throw new Error(`${label}: ${body.error.code} ${body.error.message}`);
  return body.data;
}

export const AUTH_SCOPES = 'user.info.basic,video.publish';

export function authUrl(state) {
  return (
    'https://www.tiktok.com/v2/auth/authorize/?' +
    new URLSearchParams({
      client_key: required('TIKTOK_CLIENT_KEY'),
      scope: AUTH_SCOPES,
      response_type: 'code',
      redirect_uri: required('TIKTOK_REDIRECT_URI'),
      state,
    })
  );
}

export async function exchangeCode(code) {
  const body = await fetchJson(
    `${API}/oauth/token/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: required('TIKTOK_CLIENT_KEY'),
        client_secret: required('TIKTOK_CLIENT_SECRET'),
        code: decodeURIComponent(code),
        grant_type: 'authorization_code',
        redirect_uri: required('TIKTOK_REDIRECT_URI'),
      }),
    },
    'TikTok token exchange',
  );
  if (!body.refresh_token) throw new Error(`TikTok auth failed: ${JSON.stringify(body)}`);
  saveTikTokTokens(body);
}

export async function revokeTikTok() {
  const t = readTokens().tiktok;
  if (t?.access_token) {
    await fetch(`${API}/oauth/revoke/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: required('TIKTOK_CLIENT_KEY'),
        client_secret: required('TIKTOK_CLIENT_SECRET'),
        token: t.access_token,
      }),
    }).catch(() => {});
  }
  writeTokens({ tiktok: undefined });
}

export const hasTikTokLogin = () => Boolean(readTokens().tiktok?.refresh_token);

export async function userInfo() {
  const body = await fetchJson(
    `${API}/user/info/?fields=open_id,avatar_url,display_name`,
    { headers: { Authorization: `Bearer ${await tiktokAccessToken()}` } },
    'TikTok user info',
  );
  return body.data.user;
}

export const creatorInfo = () => api('/post/publish/creator_info/query/', {}, 'TikTok creator info');

export async function postTikTok({ filePath, caption }) {
  const creator = await creatorInfo();
  const wanted = env('TIKTOK_PRIVACY', 'SELF_ONLY');
  const privacy = creator.privacy_level_options?.includes(wanted) ? wanted : 'SELF_ONLY';
  const publishId = await publishVideo({
    filePath,
    postInfo: {
      title: caption.slice(0, 2200),
      privacy_level: privacy,
      disable_comment: false,
      disable_duet: false,
      disable_stitch: false,
    },
  });
  for (let i = 0; i < 60; i++) {
    await sleep(10_000);
    const s = await publishStatus(publishId);
    if (s.status === 'PUBLISH_COMPLETE') return `${publishId} (${privacy})`;
    if (s.status === 'FAILED') throw new Error(`TikTok publish failed: ${s.fail_reason}`);
  }
  return `${publishId} (still processing, ${privacy})`;
}

export const publishStatus = (publishId) =>
  api('/post/publish/status/fetch/', { publish_id: publishId }, 'TikTok status');

// Starts a Direct Post and uploads the file; returns the publish_id.
export async function publishVideo({ filePath, postInfo }) {
  // Files ≤64MB go in one chunk; bigger files in 10MB chunks (last chunk takes the remainder).
  const size = fs.statSync(filePath).size;
  const chunkSize = size <= 64 * MB ? size : 10 * MB;
  const chunkCount = Math.floor(size / chunkSize);

  const init = await api(
    '/post/publish/video/init/',
    {
      post_info: postInfo,
      source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: chunkCount },
    },
    'TikTok init upload',
  );

  const fd = fs.openSync(filePath, 'r');
  try {
    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSize;
      const end = i === chunkCount - 1 ? size - 1 : start + chunkSize - 1;
      const buf = Buffer.alloc(end - start + 1);
      fs.readSync(fd, buf, 0, buf.length, start);
      const res = await fetch(init.upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(buf.length),
          'Content-Range': `bytes ${start}-${end}/${size}`,
        },
        body: buf,
      });
      if (!res.ok) throw new Error(`TikTok chunk ${i + 1}/${chunkCount} failed (${res.status}): ${await res.text()}`);
    }
  } finally {
    fs.closeSync(fd);
  }
  return init.publish_id;
}
