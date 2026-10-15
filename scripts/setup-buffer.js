// Lists the channels connected to your Buffer account so you can copy the TikTok channel id.
import { listChannels } from '../lib/buffer.js';

const channels = await listChannels();
if (!channels.length) {
  console.log('No channels found. Connect TikTok in Buffer first: https://publish.buffer.com');
  process.exit(1);
}
for (const c of channels) {
  console.log(`${c.service.padEnd(10)} ${c.id}  ${c.displayName || c.name} (${c.organization})${c.isQueuePaused ? '  [queue paused]' : ''}`);
}
const tiktok = channels.find((c) => c.service.toLowerCase() === 'tiktok');
if (tiktok) console.log(`\nAdd to .env:\nBUFFER_TIKTOK_CHANNEL_ID=${tiktok.id}`);
else console.log('\nNo TikTok channel connected to Buffer yet.');
