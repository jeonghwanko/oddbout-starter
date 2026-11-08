import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectCampaignMp4, createCampaignMedia } from '../api/commerce/campaign-media.mjs';
import { programSlot } from '../web/broadcast/program.mjs';
test('the purchased hours include exactly ten minutes of ads each and end at the purchased duration', () => {
  for (const hours of [1, 2, 3]) {
    const duration = hours * 3600;
    let ads = 0;
    for (let second = 0; second < duration; second++) if (programSlot(second, duration).kind === 'advertisement') ads++;
    assert.equal(ads, hours * 600);
    assert.equal(programSlot(duration, duration).kind, 'ended');
    for (let hour = 0; hour < hours; hour++)
      for (const offset of [0, 1800]) {
        assert.equal(programSlot(hour * 3600 + offset + 299.9, duration).kind, 'advertisement');
        assert.equal(programSlot(hour * 3600 + offset + 300, duration).kind, 'exhibition');
      }
  }
});
test('server reads actual MP4 metadata and rejects truncated or disguised uploads', async () => {
  const bytes = await readFile(new URL('./fixtures/campaign-sponsor.mp4', import.meta.url));
  assert.deepEqual(inspectCampaignMp4(bytes), { durationSeconds: 3, bytes: bytes.length, mimeType: 'video/mp4' });
  assert.throws(() => inspectCampaignMp4(bytes.subarray(0, bytes.length - 20)), /invalid-video/);
  assert.throws(() => inspectCampaignMp4(Buffer.from('<html>This is not video.</html>'.repeat(10))), /invalid-video/);
});
test('signed media survives a three-hour program and upload recovery retains its original immutable path', async () => {
  const calls = [],
    id = '11111111-1111-4111-8111-111111111111',
    path = `campaigns/${id}/22222222-2222-4222-8222-222222222222.mp4`;
  const service = createCampaignMedia({
    db: {
      storage: {
        from: () => ({
          createSignedUrl: async (path, seconds) => {
            calls.push(seconds);
            return { data: { signedUrl: 'https://storage.example/owned' } };
          },
          createSignedUploadUrl: async (path, options) => {
            calls.push(options);
            return { data: { path, token: 'fixture' } };
          },
        }),
      },
    },
    modelCall: null,
  });
  const signed = await service.signMedia(id, { videoPath: path });
  assert.ok(Date.parse(signed.expiresAt) - Date.now() > 10800000);
  assert.equal(calls[0], 14400);
  assert.equal((await service.upload(id, { videoPath: path, size: 100, contentType: 'video/mp4' })).path, path);
  assert.deepEqual(calls[1], { upsert: false });
  await assert.rejects(service.upload('33333333-3333-4333-8333-333333333333', { videoPath: path, size: 100, contentType: 'video/mp4' }), /invalid-media-path/);
});
