import { publish } from '../index.js';
import { publishPosts } from '../posts.js';

// Vercel Cron runs in UTC; vercel.json fires each job at its Pakistan time (no daylight saving).
// Each job also checks the local hour (and weekday) here, so a stray or early call does nothing.
const TZ = process.env.POST_TIMEZONE || 'Asia/Karachi';
const list = (v) => v.split(',').map((s) => s.trim());

const JOBS = {
  // Reels: 3pm and 7pm daily.
  reels: {
    hours: list(process.env.POST_HOURS || '15,19').map(Number),
    run: (dryRun) => publish({ dryRun }),
  },
  // One static post: 6pm daily.
  static: {
    hours: list(process.env.STATIC_HOURS || '18').map(Number),
    run: (dryRun) => publishPosts({ type: 'static', dryRun }),
  },
  // One carousel: 3pm on Tuesday and Saturday.
  carousel: {
    hours: list(process.env.CAROUSEL_HOURS || '15').map(Number),
    days: list(process.env.CAROUSEL_DAYS || 'Tue,Sat'),
    run: (dryRun) => publishPosts({ type: 'carousel', dryRun }),
  },
};

function localTime() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return { hour: Number(get('hour')), day: get('weekday') };
}

export async function GET(request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const url = new URL(request.url);
  const name = url.searchParams.get('job') || 'reels';
  const job = JOBS[name];
  if (!job) return Response.json({ error: `unknown job "${name}"` }, { status: 400 });

  const { hour, day } = localTime();
  if (!url.searchParams.has('force')) {
    if (!job.hours.includes(hour)) {
      return Response.json({ skipped: true, job: name, reason: `${hour}:00 in ${TZ} is not a ${name} hour` });
    }
    if (job.days && !job.days.includes(day)) {
      return Response.json({ skipped: true, job: name, reason: `${day} is not a ${name} day` });
    }
  }
  await job.run(url.searchParams.has('dry'));
  return Response.json({ ok: true, job: name, hour, day, tz: TZ });
}
