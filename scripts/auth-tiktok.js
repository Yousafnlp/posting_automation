// One-time: authorizes your TikTok account and saves tokens to .tokens.json
// (TikTok rotates refresh tokens, so they are kept there instead of .env).
import readline from 'node:readline/promises';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { authUrl, exchangeCode } from '../lib/tiktok.js';

const url = authUrl(crypto.randomBytes(8).toString('hex'));

console.log('Open this URL and approve. You will land on your redirect URI —');
console.log('copy the FULL address from the browser bar (the page has a Copy button).\n');
console.log(url + '\n');
exec(`open "${url}"`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pasted = (await rl.question('Paste the full redirected URL: ')).trim();
rl.close();

const code = new URL(pasted).searchParams.get('code');
if (!code) throw new Error('No ?code= found in that URL');

await exchangeCode(code);
console.log('\nSaved TikTok tokens to .tokens.json. They refresh automatically.');
