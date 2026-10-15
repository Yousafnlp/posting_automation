import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, env, has } from './lib/env.js';
import { readRows, writeStatus, parseTags, uploadToYouTube, COL } from './lib/google.js';
import { dropboxPath, downloadFile, getDirectLink } from './lib/dropbox.js';
import { postInstagramReel, postFacebookVideo } from './lib/meta.js';
import { postTikTok } from './lib/tiktok.js';

// Vercel's filesystem is read-only except /tmp.
const TMP = process.env.VERCEL ? path.join(os.tmpdir(), 'posting') : path.join(ROOT, 'tmp');

const PLATFORMS = {
  youtube: {
    enabled: () => has('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'),
    run: (row, ctx) =>
      uploadToYouTube({
        filePath: ctx.filePath(),
        title: row.get(COL.ytTitle) || row.get(COL.file),
        description: row.get(COL.ytDescription),
        tags: parseTags(row.get(COL.ytTags)),
      }),
  },
  instagram: {
    enabled: () => has('FB_PAGE_TOKEN', 'IG_USER_ID'),
    run: async (row, ctx) => postInstagramReel({ videoUrl: await ctx.link(), caption: row.get(COL.igCaption) }),
  },
  facebook: {
    enabled: () => has('FB_PAGE_TOKEN', 'FB_PAGE_ID'),
    run: async (row, ctx) => postFacebookVideo({ videoUrl: await ctx.link(), description: row.get(COL.fbCaption) }),
  },
  tiktok: {
    enabled: () => has('TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'),
    run: (row, ctx) => postTikTok({ filePath: ctx.filePath(), caption: row.get(COL.tiktokCaption) }),
  },
};

const isDone = (s) => s.toLowerCase().startsWith('done');

async function publishRow(row, platforms) {
  const fileName = row.get(COL.file);
  const dbxPath = dropboxPath(fileName);
  console.log(`\n▶ Row ${row.rowNumber}: ${fileName}`);

  const pending = platforms.filter((p) => !isDone(row.status[p]));
  const needsFile = pending.some((p) => p === 'youtube' || p === 'tiktok');

  let localFile = null;
  if (needsFile) {
    console.log(`  ↓ downloading ${dbxPath}`);
    localFile = await downloadFile(dbxPath, TMP);
  }
  let linkPromise = null;
  const ctx = {
    filePath: () => localFile,
    link: () => (linkPromise ??= getDirectLink(dbxPath)),
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
