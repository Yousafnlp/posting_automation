import { fileURLToPath } from 'node:url';
import { env, has } from './lib/env.js';
import { readPostRows, writePostStatus, POST_COL } from './lib/google.js';
import { listImages, getDirectLink } from './lib/dropbox.js';
import { postInstagramImages, postFacebookPhotos } from './lib/meta.js';
import { postTikTokPhotosViaBuffer } from './lib/buffer.js';
import { hostImage } from './lib/cloudinary.js';

// Static posts and carousels from the "Publish" tab. Each row's images are in
// Dropbox <POSTS_DROPBOX_FOLDER>/<post_id>/ (S1/S1_01.jpeg, C1/C1_01.jpeg … C1_11.jpeg).
// YouTube has no API for image posts, so it isn't posted to.

// Instagram and Buffer's TikTok posts both take 10 images at most; extra slides are left off.
const MAX_SLIDES = 10;
const capped = (id, total) => (total > MAX_SLIDES ? `${id} (first ${MAX_SLIDES} of ${total} slides)` : id);

const PLATFORMS = {
  instagram: {
    enabled: () => has('FB_PAGE_TOKEN', 'IG_USER_ID'),
    run: async (row, ctx) => {
      const urls = await ctx.links();
      const id = await postInstagramImages({ imageUrls: urls.slice(0, MAX_SLIDES), caption: row.get(POST_COL.igCaption) });
      return capped(id, urls.length);
    },
  },
  facebook: {
    enabled: () => has('FB_PAGE_TOKEN', 'FB_PAGE_ID'),
    run: async (row, ctx) =>
      postFacebookPhotos({ imageUrls: await ctx.links(), message: row.get(POST_COL.fbCaption) }),
  },
  // Buffer can't read Dropbox links, so the images are copied to Cloudinary first.
  tiktok: {
    enabled: () =>
      has('BUFFER_API_KEY', 'BUFFER_TIKTOK_CHANNEL_ID', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'),
    run: async (row, ctx) => {
      const urls = await ctx.hostedLinks();
      const id = await postTikTokPhotosViaBuffer({ imageUrls: urls.slice(0, MAX_SLIDES), caption: row.get(POST_COL.tiktokCaption) });
      return capped(id, urls.length);
    },
  },
};

const isDone = (s) => s.toLowerCase().startsWith('done');

async function publishRow(row, platforms) {
  const folder = `${env('POSTS_DROPBOX_FOLDER', '/instagram-calander').replace(/\/$/, '')}/${row.get(POST_COL.id)}`;
  console.log(`\n▶ Row ${row.rowNumber}: ${row.get(POST_COL.id)} (${row.get(POST_COL.type)})`);

  const images = await listImages(folder);
  if (!images.length) throw new Error(`no images in Dropbox ${folder}`);
  console.log(`  🖼 ${images.length} image(s) in ${folder}`);

  let linksPromise = null;
  let hostedPromise = null;
  const ctx = {
    links: () =>
      (linksPromise ??= (async () => {
        const urls = [];
        for (const p of images) urls.push(await getDirectLink(p));
        return urls;
      })()),
    hostedLinks: () =>
      (hostedPromise ??= (async () => {
        const links = await ctx.links();
        const urls = [];
        // TikTok takes images up to 1080×1920 pixels, so Cloudinary scales them down (4:5 stays 4:5).
        for (let i = 0; i < Math.min(images.length, MAX_SLIDES); i++) {
          const url = await hostImage(links[i], images[i], 'posts');
          urls.push(url.replace('/image/upload/', '/image/upload/c_limit,w_1080,h_1920/'));
        }
        return urls;
      })()),
  };

  for (const p of platforms.filter((p) => !isDone(row.status[p]))) {
    try {
      console.log(`  → ${p}…`);
      const id = await PLATFORMS[p].run(row, ctx);
      console.log(`  ✓ ${p}: ${id}`);
      await writePostStatus(row.rowNumber, p, `done ${new Date().toISOString()} ${id}`);
    } catch (err) {
      console.error(`  ✗ ${p}: ${err.message}`);
      await writePostStatus(row.rowNumber, p, `error ${new Date().toISOString()} ${err.message}`);
    }
  }
}

// type is "static" or "carousel". Publishes the next unfinished row of that type, in sheet order.
export async function publishPosts({ type, dryRun = false }) {
  const platforms = Object.keys(PLATFORMS).filter((p) => PLATFORMS[p].enabled());
  console.log(`[${type}] Platforms enabled: ${platforms.join(', ') || 'none'}`);

  const rows = await readPostRows();
  const todo = rows.filter(
    (r) =>
      r.get(POST_COL.type).toLowerCase() === type &&
      r.get(POST_COL.id) &&
      platforms.some((p) => !isDone(r.status[p])),
  );
  const limit = Number(env('POSTS_PER_RUN', '1'));
  const batch = limit > 0 ? todo.slice(0, limit) : todo;
  console.log(`${todo.length} ${type} row(s) waiting, publishing ${batch.length} this run.`);

  if (dryRun) {
    for (const r of batch) {
      const pending = platforms.filter((p) => !isDone(r.status[p]));
      console.log(`  row ${r.rowNumber}: ${r.get(POST_COL.id)} → ${pending.join(', ')}`);
    }
    return;
  }
  for (const row of batch) {
    try {
      await publishRow(row, platforms);
    } catch (err) {
      console.error(`  ✗ row ${row.rowNumber} failed: ${err.message}`);
    }
  }
  console.log('\nFinished.');
}

// node posts.js static|carousel [--dry-run]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const type = process.argv[2];
  if (!['static', 'carousel'].includes(type)) {
    console.error('Usage: node posts.js static|carousel [--dry-run]');
    process.exit(1);
  }
  publishPosts({ type, dryRun: process.argv.includes('--dry-run') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
