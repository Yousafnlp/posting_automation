# Social Video Publisher (Node.js)

A Node.js version of the Make.com scenario "Social Media Video Publisher".

**Flow:** Google Sheet row → download the video from Dropbox `/reels/<file name>` → upload to **YouTube**, post a **Instagram Reel**, post a **Facebook Page video**, post to **TikTok** (through Buffer, with the video copied to Cloudinary). The result for each platform is written back to the sheet.

## Sheet layout (`reels_schedule.csv` tab)

| A | B | C | D | E | F | G | H–K (the script fills these) |
|---|---|---|---|---|---|---|---|
| file name | yt_title | yt tags (comma separated) | yt description | ig_caption | fb_caption | tiktok_caption | yt_status, ig_status, fb_status, tiktok_status |

* A row is published only if one of its platforms isn't `done` yet.
* If one platform fails, the error goes in its status cell. The next run retries only that platform.
* To re-post a platform, clear its status cell.

## Install & run

```bash
cd ~/Desktop/posting
npm install
touch .env                # then fill it in (steps below)
npm run dry-run           # shows what would be posted; changes nothing
npm start                 # publishes MAX_POSTS_PER_RUN rows
```

Leave any platform's keys empty and the script skips that platform. You can set up one platform at a time.

### Other settings in `.env`

| Key | Default | What it does |
|---|---|---|
| `SPREADSHEET_ID` | (required) | The Google Sheet ID, from its URL |
| `SHEET_NAME` | `reels_schedule.csv` | The tab to read |
| `START_ROW` | `2` | First sheet row to post; rows above it are ignored |
| `MAX_POSTS_PER_RUN` | `1` | Rows published per run (`0` = all) |
| `DROPBOX_FOLDER` | `/reels` | Dropbox folder that holds the videos |
| `YT_PRIVACY` | `public` | YouTube privacy (`public`, `unlisted`, `private`) |
| `YT_CATEGORY_ID` | `27` (Education) | YouTube category |

---

## Credentials: what you need and where to get it

### 1. Google (Sheets + YouTube): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`

1. Go to https://console.cloud.google.com, then create a project (e.g. "reels-publisher").
2. **APIs & Services → Library:** enable **YouTube Data API v3** and **Google Sheets API**.
3. **OAuth consent screen:** choose External and fill in the app name and your email. Add yourself (`yousafijazoffical@gmail.com`) as a test user.
   Then click **Publish app → In production**. If you leave it in "Testing", the refresh token **expires every 7 days**. You don't need verification for your own use; you'll just see an "unverified app" warning, so click *Advanced → Continue*.
4. **Credentials → Create credentials → OAuth client ID:** choose type **Desktop app**. Copy the Client ID and Secret into `.env`.
5. Run `npm run auth:google`. Sign in with the account that owns **both the YouTube channel and the sheet**, then paste the printed `GOOGLE_REFRESH_TOKEN` into `.env`.

> ⚠️ **YouTube rule:** videos uploaded by a new, unaudited API project are **locked to private**. To post public videos you must submit the free **YouTube API Services audit form** (search "YouTube API audit and quota extension form"). Approval takes a few days to weeks. Until then, uploads work but stay private.
> Default quota is 10,000 units per day, and one upload costs about 1,600 units, so you can do about 6 uploads a day.

### 2. Dropbox: `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`

1. Go to https://www.dropbox.com/developers/apps, then **Create app → Scoped access → Full Dropbox**.
2. **Permissions tab:** tick `files.metadata.read`, `files.content.read`, `sharing.read`, `sharing.write`, then click **Submit**. Do this *before* step 4.
3. **Settings tab:** copy the App key and App secret into `.env`.
4. Run `npm run auth:dropbox`, click Allow, paste the code, then paste the printed `DROPBOX_REFRESH_TOKEN` into `.env`. This token doesn't expire.

### 3. Meta (Instagram + Facebook Page): `META_APP_ID`, `META_APP_SECRET`, `FB_PAGE_TOKEN`, `FB_PAGE_ID`, `IG_USER_ID`

Before you start: your Instagram account must be a **Professional (Business/Creator)** account **linked to your Facebook Page**.

1. Go to https://developers.facebook.com/apps and create an app of type **Business** (use case: "Other", then "Business").
2. Add the products **Facebook Login for Business** and **Instagram** (the "API setup with Facebook login" option).
3. **App settings → Basic:** copy the App ID and App Secret into `.env`.
4. Open **Graph API Explorer** (Tools menu), select your app, then **Get User Access Token** with these permissions:
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`.
   In the popup, tick your Page and your Instagram account.
5. Copy that token and run `npm run auth:meta`. Paste the token when asked. The script prints `FB_PAGE_ID`, `FB_PAGE_TOKEN` and `IG_USER_ID`; copy them into `.env`. This Page token **does not expire**.

The app can stay in Development mode as long as you are an admin of the app, the Page and the IG account.

### 4. TikTok (through Buffer + Cloudinary): `BUFFER_API_KEY`, `BUFFER_TIKTOK_CHANNEL_ID`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

TikTok posts go through Buffer, the same way the Make scenario did. Buffer can't read Dropbox links, so for each post the script has Cloudinary copy the video from Dropbox (into the `reels/` folder there), then gives Buffer the Cloudinary link. Buffer publishes it straight away.

1. In Buffer (https://publish.buffer.com), connect your TikTok account as a channel.
2. Go to https://publish.buffer.com/settings/api, create an API key, and put it in `BUFFER_API_KEY`.
3. Run `npm run setup:buffer`. It lists your Buffer channels and prints the line `BUFFER_TIKTOK_CHANNEL_ID=…`; copy it into `.env`.
4. Create a free Cloudinary account (https://cloudinary.com/users/register_free). From the dashboard (https://console.cloudinary.com/), copy the cloud name, API key and API secret into `.env`.

> The status cell gets `done … buffer:<post id>` once Buffer accepts the post. Buffer publishes to TikTok about a minute later, so if TikTok rejects the video you'll see the error in Buffer, not in the sheet.
> The Cloudinary free plan has limited storage. If it fills up, delete old videos from the `reels` folder in the Cloudinary media library.

---

## Run it on a schedule (Mac)

`crontab -e`, then add a line like this one (it posts at 10:00 and 18:00 every day):

```
0 10,18 * * * cd /Users/sparkaitruelove/Desktop/posting && /usr/local/bin/node index.js >> publisher.log 2>&1
```

Use the path from `which node` in place of `/usr/local/bin/node`. Your Mac must be awake at those times. To run it 24/7, use Vercel (below).

## Run it on Vercel

[vercel.json](vercel.json) calls `/api/cron` at 10:00 and 14:00 UTC (3pm and 7pm in Pakistan). Each call publishes `MAX_POSTS_PER_RUN` rows.

1. Run `vercel` in this folder to deploy it.
2. In the Vercel project, go to **Settings → Environment Variables** and add every key from your `.env` (Google, Dropbox, Meta, `BUFFER_API_KEY`, `BUFFER_TIKTOK_CHANNEL_ID`, the `CLOUDINARY_*` keys, `SPREADSHEET_ID`, and the rest).
3. Add `CRON_SECRET` (any long random string). Vercel sends it with each cron call, and other requests are refused.
4. Optional: `POST_TIMEZONE` (default `Asia/Karachi`) and `POST_HOURS` (default `15,19`). A cron call is skipped unless it lands on one of those local hours, so change these together with the times in `vercel.json`.

To test it by hand, call `/api/cron?force` (or `?force&dry` for a dry run) with the header `Authorization: Bearer <CRON_SECRET>`.

## Fixes compared to the Make scenario

* **YouTube description** was mapped to `2.yt_description`, which doesn't exist (the field is `2.3`), so it was always empty. Fixed.
* **YouTube tags** used a broken `split("2.yt_tags"…)` expression. Tags now split on commas.
* **Re-runs** reposted every row and failed at "create shared link" (the link already exists). Rows are now tracked in columns H–K, and existing Dropbox links are reused.
* **Instagram** now waits for processing to finish before publishing.
* **TikTok** still goes through Buffer, now via Buffer's API with the TikTok caption from column G. The video is copied to Cloudinary first because Buffer can't read Dropbox links.

## Security

`.env` holds full access to your accounts. It is in `.gitignore`. Never share or commit it.
