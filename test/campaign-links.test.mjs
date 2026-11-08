import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseMediaLink, mediaEmbedUrl } from '../api/commerce/media-links.mjs';
import { createCampaignService } from '../api/commerce/campaigns.mjs';
import { createCampaignMedia } from '../api/commerce/campaign-media.mjs';
import { commerceDatabase } from './helpers/commerce-database.mjs';
import { OWNER, OTHER } from './helpers/paid-operations.mjs';

test('only official YouTube and Twitch identities become embed URLs, with no arbitrary origins or parent overrides', () => {
  const youtube = 'M7lc1UVf-VE';
  for (const url of [
    `https://youtu.be/${youtube}?si=tracking`,
    `https://www.youtube.com/watch?v=${youtube}&list=ignored`,
    `https://www.youtube.com/shorts/${youtube}`,
    `https://www.youtube.com/live/${youtube}`,
  ]) {
    const source = parseMediaLink(url);
    assert.equal(source.kind, 'youtube');
    assert.equal(source.id, youtube);
    assert.equal(new URL(mediaEmbedUrl(source, 'broadcast.oddbout.com', true)).hostname, 'www.youtube-nocookie.com');
  }
  for (const [url, kind, id] of [
    ['https://www.twitch.tv/videos/40464143', 'twitch-video', '40464143'],
    ['https://clips.twitch.tv/IncredulousAbstemiousFennelImGlitch', 'twitch-clip', 'IncredulousAbstemiousFennelImGlitch'],
    ['https://www.twitch.tv/twitchdev/clip/IncredulousAbstemiousFennelImGlitch', 'twitch-clip', 'IncredulousAbstemiousFennelImGlitch'],
    ['https://www.twitch.tv/TwitchDev?parent=evil.test', 'twitch-live', 'twitchdev'],
  ]) {
    const source = parseMediaLink(url);
    assert.equal(source.kind, kind);
    assert.equal(source.id, id);
    const embed = new URL(mediaEmbedUrl(source, 'broadcast.oddbout.com'));
    assert.equal(embed.searchParams.get('parent'), 'broadcast.oddbout.com');
  }
  for (const bad of [
    'https://youtube.com.evil.test/watch?v=' + youtube,
    'https://youtube.com@evil.test/watch?v=' + youtube,
    'https://localhost/video.mp4',
    'https://www.youtube.com/playlist?list=x',
    'javascript:alert(1)',
    'http://youtu.be/' + youtube,
    'https://www.twitch.tv/directory',
    'https://www.twitch.tv/videos/not-a-number',
    'https://clips.twitch.tv/%3Cscript%3E',
  ])
    assert.throws(() => parseMediaLink(bad));
  assert.throws(() => mediaEmbedUrl({ ...parseMediaLink('https://youtu.be/' + youtube), id: 'evil' }, 'broadcast.oddbout.com'));
});

test('linked media is owned, immutable and recoverable without storage downloads, duplicate introduction or another debit', async t => {
  const f = await commerceDatabase();
  t.after(() => f.db.close());
  for (const file of ['20261103154930_commerce_campaigns.sql', '20261103170232_commerce_campaign_links.sql', '20261103180002_commerce_campaign_schedule.sql'])
    await f.db.exec(await readFile(new URL('../supabase/sandbox/' + file, import.meta.url), 'utf8'));
  const rpc = async (name, args) => {
    try {
      return {
        data: await f.db.transaction(async tx => {
          await tx.exec('set local role service_role');
          if (name === 'commerce_campaign_link')
            return (
              await tx.query('select public.commerce_campaign_link($1,$2,$3,$4::jsonb) value', [
                args.p_owner,
                args.p_order_id,
                args.p_request_key,
                JSON.stringify(args.p_input),
              ])
            ).rows[0].value;
          if (name === 'commerce_campaign_planning')
            return (
              await tx.query('select public.commerce_campaign_planning($1,$2,$3::jsonb) value', [args.p_owner, args.p_command, JSON.stringify(args.p_input)])
            ).rows[0].value;
          assert.equal(name, 'commerce_campaign');
          return (await tx.query('select public.commerce_campaign($1,$2,$3::jsonb) value', [args.p_owner, args.p_command, JSON.stringify(args.p_input)]))
            .rows[0].value;
        }),
        error: null,
      };
    } catch (error) {
      return { data: null, error };
    }
  };
  let introductions = 0;
  const media = createCampaignMedia({
    db: {
      storage: {
        from: () => ({
          info: () => {
            throw new Error('External links are not stored MP4s');
          },
        }),
      },
    },
    fetchImpl: async url => {
      assert.match(url, /oddbout-broadcast-arena/);
      return new Response('spotlight-player.mjs');
    },
    modelCall: async () => {
      introductions++;
      return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'This is a paid sponsor break. Visit oddbout.com.' }] }], observation: {} };
    },
  });
  const service = createCampaignService({ db: { rpc }, ...media });
  const funding = await f.store.createTopup(OWNER, { requestKey: randomUUID(), amountCents: 1000, credits: 1000, currency: 'USD' });
  await f.store.attachOrder(OWNER, funding.id, 'LINKFUNDS');
  await f.store.creditCapture(OWNER, funding.id, {
    providerOrderId: 'LINKFUNDS',
    captureId: 'LINKCAPTURE',
    amountCents: 1000,
    currency: 'USD',
    status: 'COMPLETED',
  });
  const order = await service.purchase(OWNER, { requestKey: randomUUID(), productId: 'spotlight-hour' });
  const input = { requestKey: randomUUID(), mediaUrl: 'https://youtu.be/M7lc1UVf-VE', targetUrl: 'https://oddbout.com/' };
  await assert.rejects(service.saveLink(OTHER, order.id, input), /not-found/);
  const result = await service.saveLink(OWNER, order.id, input);
  assert.equal(result.status, 'ready');
  assert.equal(result.media.verification, 'link-format-only');
  assert.equal(result.media.videoPath, undefined);
  await service.saveLink(OWNER, order.id, { ...input, mediaUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE' });
  assert.equal(introductions, 1);
  await assert.rejects(service.saveLink(OWNER, order.id, { ...input, targetUrl: 'https://different.example/' }), /idempotency-conflict/);
  const preview = await service.preview(OWNER, order.id);
  assert.equal(preview.source.kind, 'youtube');
  await service.schedule(OWNER, order.id, {
    requestKey: randomUUID(),
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    timezone: 'Asia/Seoul',
    expectedRevision: 0,
  });
  const started = await service.start(OWNER, order.id, { requestKey: randomUUID() });
  const manifest = await service.manifest(started.watchToken);
  assert.equal(manifest.media.source.kind, 'youtube');
  assert.equal(manifest.media.durationSeconds, undefined);
  await assert.rejects(service.saveLink(OWNER, order.id, { ...input, requestKey: randomUUID() }), /campaign-already-started/);
  assert.equal((await f.store.wallet(OWNER)).balanceCredits, 700);
  assert.equal(
    (await f.db.query("select has_function_privilege('anon','public.commerce_campaign_link(text,uuid,uuid,jsonb)','execute') allowed")).rows[0].allowed,
    false,
  );
});
