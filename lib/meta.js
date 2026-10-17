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
  for (let i = 0; i < 60; i++) {
    await sleep(10_000);
    const s = await fetchJson(
      graph(`${container.id}?fields=status_code,status&access_token=${encodeURIComponent(required('FB_PAGE_TOKEN'))}`),
      {},
      'Instagram container status',
    );
    if (s.status_code === 'FINISHED') {
      const pub = await post(`${igUser}/media_publish`, { creation_id: container.id }, 'Instagram publish');
      return pub.id;
    }
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      throw new Error(`Instagram processing ${s.status_code}: ${s.status ?? ''}`);
    }
  }
  throw new Error('Instagram processing timed out after 10 minutes');
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
