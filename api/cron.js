import { publish } from '../index.js';

// Vercel Cron runs in UTC: 10:00 and 14:00 UTC = 3pm and 7pm in Pakistan (no daylight saving).
// This check skips any run that doesn't land on POST_HOURS local time.
const TZ = process.env.POST_TIMEZONE || 'Asia/Karachi';
const HOURS = (process.env.POST_HOURS || '15,19').split(',').map(Number);

const localHour = () =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));

export async function GET(request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const url = new URL(request.url);
  const hour = localHour();
  if (!url.searchParams.has('force') && !HOURS.includes(hour)) {
    return Response.json({ skipped: true, reason: `${hour}:00 in ${TZ} is not in POST_HOURS` });
  }
  await publish({ dryRun: url.searchParams.has('dry') });
  return Response.json({ ok: true, hour, tz: TZ });
}
