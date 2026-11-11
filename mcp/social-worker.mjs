// @ts-check
import { exportSocial, parseBackground, prepareGrokFace } from '../scripts/social-export.mjs';
try {
  const [mode, raw] = [process.argv[2], JSON.parse(process.argv[3])];
  const background = parseBackground(raw.background ?? 'light') ?? undefined;
  const result =
    mode === 'grok-face'
      ? await prepareGrokFace({ profileSetDir: raw.profileSetDir, face: raw.face, out: raw.out, background, seconds: raw.seconds })
      : await exportSocial({
          packageDir: raw.packageDir,
          profileSetDir: raw.profileSetDir,
          out: raw.out,
          size: raw.size,
          aspect: raw.aspect,
          background,
          endcard: raw.endcard,
          clips: raw.clips ?? null,
          gif: raw.gif,
          addClips: raw.addClips,
        });
  if (process.send) process.send(result);
} catch {
  if (process.send) process.send({ ok: false, stage: 'social-export', code: 'social-export-failed' });
} finally {
  process.disconnect();
}
