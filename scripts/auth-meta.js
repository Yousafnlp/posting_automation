// One-time: turns a short-lived user token from Graph API Explorer into a
// never-expiring Page token, and finds the linked Instagram account ID.
import readline from 'node:readline/promises';
import { env, required, fetchJson } from '../lib/env.js';

const v = env('META_GRAPH_VERSION', 'v23.0');
const appId = required('META_APP_ID');
const appSecret = required('META_APP_SECRET');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const shortToken = (await rl.question('Paste the User access token from Graph API Explorer: ')).trim();
rl.close();

const long = await fetchJson(
  `https://graph.facebook.com/${v}/oauth/access_token?` +
    new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    }),
  {},
  'Exchange for long-lived user token',
);

const pages = await fetchJson(
  `https://graph.facebook.com/${v}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${long.access_token}`,
  {},
  'List pages',
);

if (!pages.data?.length) {
  console.log('No Pages found. Make sure you ticked your Page when granting permissions.');
  process.exit(1);
}

console.log('\nPages this token can manage:\n');
for (const p of pages.data) {
  console.log(`# ${p.name}`);
  console.log(`FB_PAGE_ID=${p.id}`);
  console.log(`FB_PAGE_TOKEN=${p.access_token}`);
  if (p.instagram_business_account) {
    console.log(`IG_USER_ID=${p.instagram_business_account.id}   # @${p.instagram_business_account.username}`);
  } else {
    console.log('# (no Instagram professional account linked to this Page)');
  }
  console.log('');
}
console.log('Copy the lines for your Page into .env. This Page token does not expire.');
