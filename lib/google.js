import fs from 'node:fs';
import { google } from 'googleapis';
import { env, required } from './env.js';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/youtube.upload',
];

// Sheet layout. A–G are yours; H–K are written by this script.
export const COL = {
  file: 0, ytTitle: 1, ytTags: 2, ytDescription: 3,
  igCaption: 4, fbCaption: 5, tiktokCaption: 6,
};
export const STATUS_COLS = { youtube: 'H', instagram: 'I', facebook: 'J', tiktok: 'K' };
const STATUS_HEADERS = ['yt_status', 'ig_status', 'fb_status', 'tiktok_status'];

function authClient() {
  const auth = new google.auth.OAuth2(required('GOOGLE_CLIENT_ID'), required('GOOGLE_CLIENT_SECRET'));
  auth.setCredentials({ refresh_token: required('GOOGLE_REFRESH_TOKEN') });
  return auth;
}

const sheetName = () => env('SHEET_NAME', 'reels_schedule.csv');
const range = (a1) => `'${sheetName().replace(/'/g, "''")}'!${a1}`;

export async function readRows({ writeHeaders = true } = {}) {
  const sheets = google.sheets({ version: 'v4', auth: authClient() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: required('SPREADSHEET_ID'),
    range: range('A1:K'),
  });
  const [header = [], ...data] = res.data.values || [];

  // Add the status headers once so the columns are labelled in the sheet.
  if (writeHeaders && STATUS_HEADERS.some((h, i) => header[7 + i] !== h)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: required('SPREADSHEET_ID'),
      range: range('H1:K1'),
      valueInputOption: 'RAW',
      requestBody: { values: [STATUS_HEADERS] },
    });
  }

  return data.map((cells, i) => ({
    rowNumber: i + 2,
    cells,
    get: (col) => (cells[col] ?? '').toString().trim(),
    status: {
      youtube: cells[7] ?? '',
      instagram: cells[8] ?? '',
      facebook: cells[9] ?? '',
      tiktok: cells[10] ?? '',
    },
  }));
}

export async function writeStatus(rowNumber, platform, value) {
  const sheets = google.sheets({ version: 'v4', auth: authClient() });
  await sheets.spreadsheets.values.update({
    spreadsheetId: required('SPREADSHEET_ID'),
    range: range(`${STATUS_COLS[platform]}${rowNumber}`),
    valueInputOption: 'RAW',
    requestBody: { values: [[value.slice(0, 1000)]] },
  });
}

export function parseTags(raw) {
  return raw
    .split(/[,\n]/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean)
    .slice(0, 30);
}

export async function uploadToYouTube({ filePath, title, description, tags }) {
  const youtube = google.youtube({ version: 'v3', auth: authClient() });
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    notifySubscribers: true,
    requestBody: {
      snippet: {
        title: title.slice(0, 100),
        description: description.slice(0, 5000),
        tags,
        categoryId: env('YT_CATEGORY_ID', '27'),
      },
      status: {
        privacyStatus: env('YT_PRIVACY', 'public'),
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: false,
      },
    },
    media: { body: fs.createReadStream(filePath) },
  });
  return res.data.id;
}

// Needs a phone-verified channel (youtube.com/verify) for custom thumbnails. Max 2 MB.
export async function setYouTubeThumbnail(videoId, imagePath) {
  const youtube = google.youtube({ version: 'v3', auth: authClient() });
  await youtube.thumbnails.set({
    videoId,
    media: {
      mimeType: /\.png$/i.test(imagePath) ? 'image/png' : 'image/jpeg',
      body: fs.createReadStream(imagePath),
    },
  });
}

// Static posts and carousels live in a second sheet (POSTS_SPREADSHEET_ID, tab "Publish").
// A–K are yours; L–O are written by this script.
export const POST_COL = { file: 0, id: 1, type: 3, igCaption: 8, fbCaption: 9, tiktokCaption: 10 };
const POST_STATUS_COLS = { youtube: 'L', instagram: 'M', facebook: 'N', tiktok: 'O' };

// Accepts a bare ID or whatever was pasted from the address bar ("<id>/edit?gid=…" or the full URL).
const postsSheetId = () => required('POSTS_SPREADSHEET_ID').match(/[-\w]{25,}/)?.[0] ?? required('POSTS_SPREADSHEET_ID');
const postsRange = (a1) => `'${env('POSTS_SHEET_NAME', 'Publish').replace(/'/g, "''")}'!${a1}`;

export async function readPostRows() {
  const sheets = google.sheets({ version: 'v4', auth: authClient() });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: postsSheetId(), range: postsRange('A2:O') });
  return (res.data.values || []).map((cells, i) => ({
    rowNumber: i + 2,
    cells,
    get: (col) => (cells[col] ?? '').toString().trim(),
    status: {
      youtube: cells[11] ?? '',
      instagram: cells[12] ?? '',
      facebook: cells[13] ?? '',
      tiktok: cells[14] ?? '',
    },
  }));
}

export async function writePostStatus(rowNumber, platform, value) {
  const sheets = google.sheets({ version: 'v4', auth: authClient() });
  await sheets.spreadsheets.values.update({
    spreadsheetId: postsSheetId(),
    range: postsRange(`${POST_STATUS_COLS[platform]}${rowNumber}`),
    valueInputOption: 'RAW',
    requestBody: { values: [[value.slice(0, 1000)]] },
  });
}
