import { required, fetchJson } from './env.js';

const API = 'https://api.buffer.com';

// Buffer's API is GraphQL: one endpoint, the query in the body.
export async function bufferQuery(query, variables = {}, label = 'Buffer API') {
  const body = await fetchJson(
    API,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${required('BUFFER_API_KEY')}` },
      body: JSON.stringify({ query, variables }),
    },
    label,
  );
  if (body.errors?.length) throw new Error(`${label}: ${body.errors.map((e) => e.message).join('; ')}`);
  return body.data;
}

export async function listChannels() {
  const { account } = await bufferQuery(
    `query { account { organizations { id name } } }`,
    {},
    'Buffer organizations',
  );
  const channels = [];
  for (const org of account.organizations) {
    const data = await bufferQuery(
      `query ($org: OrganizationId!) {
        channels(input: { organizationId: $org }) { id name displayName service isQueuePaused }
      }`,
      { org: org.id },
      'Buffer channels',
    );
    for (const c of data.channels) channels.push({ ...c, organization: org.name });
  }
  return channels;
}

// Buffer fetches the video from videoUrl itself, so it must be a public direct link.
// The post goes out now (shareNow); Buffer then publishes it to TikTok in the background.
export async function postTikTokViaBuffer({ videoUrl, caption }) {
  const data = await bufferQuery(
    `mutation ($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id } }
        ... on MutationError { message }
      }
    }`,
    {
      input: {
        text: caption || '',
        channelId: required('BUFFER_TIKTOK_CHANNEL_ID'),
        schedulingType: 'automatic',
        mode: 'shareNow',
        assets: [{ video: { url: videoUrl } }],
      },
    },
    'Buffer create post',
  );
  const result = data.createPost;
  if (!result?.post) throw new Error(`Buffer create post: ${result?.message || 'no post returned'}`);
  return `buffer:${result.post.id}`;
}
