import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, env, has } from './lib/env.js';
import { readRows, writeStatus, parseTags, uploadToYouTube, setYouTubeThumbnail, COL } from './lib/google.js';
import { dropboxPath, downloadFile, getDirectLink, findThumbnail } from './lib/dropbox.js';
import { postInstagramReel, postFacebookVideo } from './lib/meta.js';
import { postTikTokViaBuffer } from './lib/buffer.js';
import { hostVideo, hostImage } from './lib/cloudinary.js';

// Vercel's filesystem is read-only except /tmp.
const TMP = process.env.VERCEL ? path.join(os.tmpdir(), 'posting') : path.join(ROOT, 'tmp');

const PLATFORMS = {
  youtube: {
    enabled: () => has('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'),
    run: async (row, ctx) => {
      const id = await uploadToYouTube({
        filePath: ctx.filePath(),
        title: row.get(COL.ytTitle) || row.get(COL.file),
        description: row.get(COL.ytDescription),
        tags: parseTags(row.get(COL.ytTags)),
      });
      // The video is already up, so a thumbnail failure is noted but doesn't mark the row as failed
      // (that would upload the video again on the next run).
      try {
        const thumb = await ctx.thumbFile();
        if (!thumb) return id;
        await setYouTubeThumbnail(id, thumb);
        return `${id} +thumbnail`;
      } catch (err) {
        console.error(`  ! youtube thumbnail: ${err.message}`);
        return `${id} (thumbnail failed: ${err.message})`;
      }
    },
  },
  instagram: {
    enabled: () => has('FB_PAGE_TOKEN', 'IG_USER_ID'),
    run: async (row, ctx) =>
      postInstagramReel({
        videoUrl: await ctx.link(),
        caption: row.get(COL.igCaption),
        coverUrl: await ctx.thumbLink(),
      }),
  },
  facebook: {
    enabled: () => has('FB_PAGE_TOKEN', 'FB_PAGE_ID'),
    run: async (row, ctx) =>
      postFacebookVideo({
        videoUrl: await ctx.link(),
        description: row.get(COL.fbCaption),
        thumbPath: await ctx.thumbFile(),
      }),
  },
  // TikTok goes through Buffer. Buffer can't read Dropbox links, so the video is copied
  // to Cloudinary first and Buffer pulls it from there.
  tiktok: {
    enabled: () =>
      has('BUFFER_API_KEY', 'BUFFER_TIKTOK_CHANNEL_ID', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'),
    run: async (row, ctx) => {
      const thumbLink = await ctx.thumbLink();
      return postTikTokViaBuffer({
        videoUrl: await hostVideo(await ctx.link(), row.get(COL.file)),
        caption: row.get(COL.tiktokCaption),
        thumbnailUrl: thumbLink ? await hostImage(thumbLink, row.get(COL.file)) : undefined,
      });
    },
  },
};

const isDone = (s) => s.toLowerCase().startsWith('done');

async function publishRow(row, platforms) {
  const fileName = row.get(COL.file);
  const dbxPath = dropboxPath(fileName);
  console.log(`\n▶ Row ${row.rowNumber}: ${fileName}`);

  const pending = platforms.filter((p) => !isDone(row.status[p]));
  const needsFile = pending.includes('youtube');

  let localFile = null;
  if (needsFile) {
    console.log(`  ↓ downloading ${dbxPath}`);
    localFile = await downloadFile(dbxPath, TMP);
  }
  const thumbPath = await findThumbnail(fileName);
  console.log(thumbPath ? `  🖼 thumbnail: ${thumbPath}` : '  (no thumbnail found, posting without one)');

  let linkPromise = null;
  let thumbLinkPromise = null;
  let thumbFilePromise = null;
  const ctx = {
    filePath: () => localFile,
    link: () => (linkPromise ??= getDirectLink(dbxPath)),
    thumbLink: () => (thumbPath ? (thumbLinkPromise ??= getDirectLink(thumbPath)) : null),
    thumbFile: () => (thumbPath ? (thumbFilePromise ??= downloadFile(thumbPath, TMP)) : null),
  };

  try {
    for (const p of pending) {
      try {
        console.log(`  → ${p}…`);
        const id = await PLATFORMS[p].run(row, ctx);
        console.log(`  ✓ ${p}: ${id}`);
        await writeStatus(row.rowNumber, p, `done ${new Date().toISOString()} ${id}`);
      } catch (err) {
        console.error(`  ✗ ${p}: ${err.message}`);
        await writeStatus(row.rowNumber, p, `error ${new Date().toISOString()} ${err.message}`);
      }
    }
  } finally {
    if (localFile) fs.rmSync(localFile, { force: true });
    if (thumbFilePromise) await thumbFilePromise.then((f) => fs.rmSync(f, { force: true }), () => {});
  }
}

export async function publish({ dryRun = false } = {}) {
  const DRY_RUN = dryRun;
  const platforms = Object.keys(PLATFORMS).filter((p) => PLATFORMS[p].enabled());
  const skipped = Object.keys(PLATFORMS).filter((p) => !platforms.includes(p));
  console.log(`Platforms enabled: ${platforms.join(', ') || 'none'}`);
  if (skipped.length) console.log(`Skipped (no credentials in .env): ${skipped.join(', ')}`);

  const rows = await readRows({ writeHeaders: !DRY_RUN });
  // START_ROW skips rows that were already posted by hand (row 2 = first reel).
  const startRow = Number(env('START_ROW', '2'));
  const todo = rows.filter(
    (r) => r.rowNumber >= startRow && r.get(COL.file) && platforms.some((p) => !isDone(r.status[p])),
  );
  const limit = Number(env('MAX_POSTS_PER_RUN', '1'));
  const batch = limit > 0 ? todo.slice(0, limit) : todo;

  console.log(`${todo.length} row(s) waiting, publishing ${batch.length} this run.`);
  if (DRY_RUN) {
    for (const r of batch) {
      const pending = platforms.filter((p) => !isDone(r.status[p]));
      console.log(`  row ${r.rowNumber}: ${r.get(COL.file)} → ${pending.join(', ')}`);
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

// Run from the command line (npm start / npm run dry-run); Vercel imports publish() instead.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  publish({ dryRun: process.argv.includes('--dry-run') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
