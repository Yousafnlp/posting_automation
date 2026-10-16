import crypto from 'node:crypto';
import path from 'node:path';
import { env, required, fetchJson } from './env.js';

// Cloudinary signs requests with sha1("k1=v1&k2=v2…" + secret), params sorted by name.
function sign(params) {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + required('CLOUDINARY_API_SECRET')).digest('hex');
}

// Cloudinary copies the file from sourceUrl (it fetches it itself, nothing is uploaded from here)
// and returns a direct public https link. Re-running for the same file overwrites it.
async function host(sourceUrl, fileName, resourceType) {
  const params = {
    overwrite: 'true',
    public_id: `${env('CLOUDINARY_FOLDER', 'reels')}/${path.parse(fileName).name}`,
    timestamp: Math.floor(Date.now() / 1000),
  };
  const body = await fetchJson(
    `https://api.cloudinary.com/v1_1/${required('CLOUDINARY_CLOUD_NAME')}/${resourceType}/upload`,
    {
      method: 'POST',
      body: new URLSearchParams({
        ...params,
        file: sourceUrl,
        api_key: required('CLOUDINARY_API_KEY'),
        signature: sign(params),
      }),
    },
    'Cloudinary upload',
  );
  return body.secure_url;
}

export const hostVideo = (sourceUrl, fileName) => host(sourceUrl, fileName, 'video');
export const hostImage = (sourceUrl, fileName) => host(sourceUrl, fileName, 'image');
