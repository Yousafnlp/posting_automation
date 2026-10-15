import { env, required, fetchJson, sleep } from './env.js';

const graph = (p) => `https://graph.facebook.com/${env('META_GRAPH_VERSION', 'v23.0')}/${p}`;

function post(p, params, label) {
  return fetchJson(
    graph(p),
    { method: 'POST', body: new URLSearchParams({ ...params, access_token: required('FB_PAGE_TOKEN') }) },
    label,
  );
}

export async function postInstagramReel({ videoUrl, caption }) {
  const igUser = required('IG_USER_ID');
  const container = await post(
    `${igUser}/media`,
    { media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: 'true' },
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

export async function postFacebookVideo({ videoUrl, description }) {
  const res = await post(
    `${required('FB_PAGE_ID')}/videos`,
    { file_url: videoUrl, description },
    'Facebook page video upload',
  );
  return res.id;
}
