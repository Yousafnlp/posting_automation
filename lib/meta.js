import fs from 'node:fs';
import path from 'node:path';
import { env, required, fetchJson, sleep } from './env.js';

const graph = (p) => `https://graph.facebook.com/${env('META_GRAPH_VERSION', 'v23.0')}/${p}`;

function post(p, params, label) {
  return fetchJson(
    graph(p),
    { method: 'POST', body: new URLSearchParams({ ...params, access_token: required('FB_PAGE_TOKEN') }) },
    label,
  );
}

// coverUrl (optional) must be a public link to a JPEG.
export async function postInstagramReel({ videoUrl, caption, coverUrl }) {
  const igUser = required('IG_USER_ID');
  const container = await post(
    `${igUser}/media`,
    {
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      share_to_feed: 'true',
      ...(coverUrl && { cover_url: coverUrl }),
    },
    'Instagram create container',
  );

  // Instagram downloads and transcodes the video; wait up to ~10 minutes.
  await waitForContainer(container.id);
  const pub = await post(`${igUser}/media_publish`, { creation_id: container.id }, 'Instagram publish');
  return pub.id;
}

async function waitForContainer(id, { intervalMs = 10_000, tries = 60 } = {}) {
  for (let i = 0; i < tries; i++) {
    await sleep(intervalMs);
    const s = await fetchJson(
      graph(`${id}?fields=status_code,status&access_token=${encodeURIComponent(required('FB_PAGE_TOKEN'))}`),
      {},
      'Instagram container status',
    );
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      throw new Error(`Instagram processing ${s.status_code}: ${s.status ?? ''}`);
    }
  }
  throw new Error(`Instagram processing timed out after ${Math.round((intervalMs * tries) / 60_000)} minutes`);
}

// One URL posts a single image, several post a carousel (Instagram allows 10 at most).
// The URLs must be public links to JPEGs.
export async function postInstagramImages({ imageUrls, caption }) {
  const igUser = required('IG_USER_ID');
  const fast = { intervalMs: 3_000, tries: 40 };
  let containerId;
  if (imageUrls.length === 1) {
    containerId = (await post(`${igUser}/media`, { image_url: imageUrls[0], caption }, 'Instagram create container')).id;
  } else {
    const children = [];
    for (const url of imageUrls) {
      const item = await post(`${igUser}/media`, { image_url: url, is_carousel_item: 'true' }, 'Instagram carousel item');
      children.push(item.id);
    }
    for (const id of children) await waitForContainer(id, fast);
    containerId = (
      await post(
        `${igUser}/media`,
        { media_type: 'CAROUSEL', children: children.join(','), caption },
        'Instagram create carousel',
      )
    ).id;
  }
  await waitForContainer(containerId, fast);
  const pub = await post(`${igUser}/media_publish`, { creation_id: containerId }, 'Instagram publish');
  return pub.id;
}

// Each photo is uploaded unpublished, then one Page post shows them all (one photo or an album-style post).
export async function postFacebookPhotos({ imageUrls, message }) {
  const page = required('FB_PAGE_ID');
  const ids = [];
  for (const url of imageUrls) {
    ids.push((await post(`${page}/photos`, { url, published: 'false' }, 'Facebook photo upload')).id);
  }
  const attached = Object.fromEntries(ids.map((id, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: id })]));
  const res = await post(`${page}/feed`, { message: message || '', ...attached }, 'Facebook page post');
  return res.id;
}

// thumbPath (optional) is a local image file; Facebook needs it sent as a file, not a link.
export async function postFacebookVideo({ videoUrl, description, thumbPath }) {
  const form = new FormData();
  form.set('file_url', videoUrl);
  form.set('description', description || '');
  form.set('access_token', required('FB_PAGE_TOKEN'));
  if (thumbPath) {
    const type = /\.png$/i.test(thumbPath) ? 'image/png' : 'image/jpeg';
    form.set('thumb', new Blob([fs.readFileSync(thumbPath)], { type }), path.basename(thumbPath));
  }
  const res = await fetchJson(
    graph(`${required('FB_PAGE_ID')}/videos`),
    { method: 'POST', body: form },
    'Facebook page video upload',
  );
  return res.id;
}
