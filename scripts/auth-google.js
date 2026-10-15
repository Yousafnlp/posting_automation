// One-time: opens Google consent and prints GOOGLE_REFRESH_TOKEN.
import http from 'node:http';
import { exec } from 'node:child_process';
import { google } from 'googleapis';
import { required } from '../lib/env.js';
import { GOOGLE_SCOPES } from '../lib/google.js';

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}`;
const client = new google.auth.OAuth2(required('GOOGLE_CLIENT_ID'), required('GOOGLE_CLIENT_SECRET'), redirectUri);
const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GOOGLE_SCOPES });

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, redirectUri).searchParams.get('code');
  if (!code) return res.end('No code in request.');
  try {
    const { tokens } = await client.getToken(code);
    res.end('Done — you can close this tab and go back to the terminal.');
    console.log('\nAdd this line to .env:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (err) {
    res.end('Error: ' + err.message);
    console.error(err.message);
  }
  server.close();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Sign in with the Google account that owns the YouTube channel AND the sheet:\n');
  console.log(url + '\n');
  exec(`open "${url}"`);
});
