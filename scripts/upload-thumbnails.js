// Uploads every .jpg/.jpeg/.png in a local folder (default tmp/thumbnails) to the Dropbox
// thumbnail folder, keeping the file names (reel_01_x.jpg goes next to reel_01_x.mp4).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, env } from '../lib/env.js';
import { uploadFile } from '../lib/dropbox.js';

const dir = path.resolve(process.argv[2] || path.join(ROOT, 'tmp', 'thumbnails'));
const folder = env('DROPBOX_THUMB_FOLDER', env('DROPBOX_FOLDER', '/reels')).replace(/\/$/, '');
const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f));
if (!files.length) console.log(`No images in ${dir}`);
let failed = 0;
for (const f of files) {
  try {
    const out = await uploadFile(path.join(dir, f), `${folder}/${f}`);
    console.log(`✓ ${f} → ${out}`);
  } catch (err) {
    failed++;
    console.error(`✗ ${f}: ${err.message.slice(0, 200)}`);
  }
}
console.log(`${files.length - failed} uploaded, ${failed} failed.`);
if (failed) process.exitCode = 1;
