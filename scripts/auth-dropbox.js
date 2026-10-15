// One-time: prints DROPBOX_REFRESH_TOKEN.
import readline from 'node:readline/promises';
import { exec } from 'node:child_process';
import { required, fetchJson } from '../lib/env.js';

const key = required('DROPBOX_APP_KEY');
const secret = required('DROPBOX_APP_SECRET');
const url = `https://www.dropbox.com/oauth2/authorize?client_id=${key}&response_type=code&token_access_type=offline`;

console.log('Open this URL, click Allow, then copy the code Dropbox shows you:\n');
console.log(url + '\n');
exec(`open "${url}"`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const code = (await rl.question('Paste code here: ')).trim();
rl.close();

const body = await fetchJson(
  'https://api.dropboxapi.com/oauth2/token',
  {
    method: 'POST',
    body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: key, client_secret: secret }),
  },
  'Dropbox token exchange',
);
console.log('\nAdd this line to .env:\n');
console.log(`DROPBOX_REFRESH_TOKEN=${body.refresh_token}\n`);
