// @ts-check
// Encode captured browser pixels at their actual capture times; no fabricated tool output.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const output = path.resolve(process.argv[2] || 'output/plugin-review-20261022');
const framesDir = path.join(output, 'frames-final'),
  site = path.join(output, 'site');
const evidence = JSON.parse(await readFile(path.join(site, 'evidence.json'), 'utf8'));
if (evidence.status !== 'passed' || evidence.steps.length !== 9) throw Error('A complete passing functional run is required');
const captured = JSON.parse(await readFile(path.join(framesDir, 'frames.json'), 'utf8'));
const wantedStart = Date.parse(evidence.steps[0].startedAt) - 500;
const wantedEnd = Date.parse(evidence.finishedAt) + 4000;
const frames = /** @type {any[]} */ (captured).filter(f => f.timestamp >= wantedStart && f.timestamp <= wantedEnd);
if (frames.length < 50) throw Error('Insufficient real screen captures');
const start = frames[0].timestamp;
const concat =
  frames.map((frame, i) => `file '${frame.file}'\nduration ${((frames[i + 1]?.timestamp ?? frame.timestamp + 1000) - frame.timestamp) / 1000}`).join('\n') +
  `\nfile '${frames.at(-1).file}'\n`;
await writeFile(path.join(framesDir, 'recording.ffconcat'), concat);
const video = path.join(site, 'walkthrough.mp4');
const result = spawnSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    path.join(framesDir, 'recording.ffconcat'),
    '-vf',
    'scale=1280:720:flags=lanczos',
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    video,
  ],
  { stdio: 'inherit' },
);
if (result.status !== 0) throw Error('Video encoding failed');
const duration = (frames.at(-1).timestamp - start) / 1000 + 1;
const ko = [
  '설치된 플러그인을 격리된 폴더에서 실제 실행합니다. 로그인이나 생성은 하지 않습니다.',
  '번들에 포함된 제작 가이드와 로컬 설치 요건을 읽습니다.',
  '대화 전용 프로젝트를 저장합니다. 과정 검토 요청은 생성 권한이 아닙니다.',
  '실제 MCP 프로세스를 종료하고 같은 작업 폴더로 다시 연결합니다.',
  '저장한 설명, 대화 전용 모드와 검토 대기 상태가 복구됩니다.',
  '대화 전용 프로젝트의 생성 요청은 실행 전에 거절됩니다.',
  '작업 폴더 밖 파일을 참조하는 경로는 거절됩니다.',
  '실제 WebP 파일을 검증합니다. 기하학 예제는 생성 작품이나 시각 승인 자료가 아닙니다.',
  '9개 기능 검사가 통과했습니다. 실제 생성·시각 검토·로그인·등록 시연은 별도입니다.',
];
/** @type {(s: number) => string} */
const stamp = s => {
  const ms = Math.max(0, Math.round(s * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};
for (const lang of ['en', 'ko']) {
  const cues = /** @type {{ startedAt: string, description: string }[]} */ (evidence.steps).map((step, i) => {
    const from = Math.max(0, (Date.parse(step.startedAt) - start) / 1000);
    const to = Math.min(duration, i + 1 < evidence.steps.length ? (Date.parse(evidence.steps[i + 1].startedAt) - start) / 1000 : duration);
    return `${i + 1}\n${stamp(from)} --> ${stamp(to)}\n${lang === 'ko' ? ko[i] : step.description}\n`;
  });
  await writeFile(path.join(site, `walkthrough.${lang}.vtt`), 'WEBVTT\n\n' + cues.join('\n'));
}
await copyFile(path.join(framesDir, frames.at(-1).file), path.join(site, 'poster.jpg'));
await writeFile(
  path.join(output, 'video-provenance.json'),
  JSON.stringify(
    {
      run: evidence.run,
      video: 'site/walkthrough.mp4',
      sha256: createHash('sha256')
        .update(await readFile(video))
        .digest('hex'),
      capturedFrames: frames.length,
      totalCapturedFrames: captured.length,
      startCapture: new Date(start).toISOString(),
      endCapture: new Date(frames.at(-1).timestamp).toISOString(),
      durationSeconds: duration,
      capture: 'Actual browser screenshots of live MCP results; timing preserved between captured frames',
      editing: 'Trimmed initial runtime preparation and ending idle; scaled to 1280x720; silent video with English and Korean captions',
      notRecorded: ['Codex conversation UI', 'generation', 'visual motion review', 'login', 'registration'],
      firstAttempt:
        'Retained separately. A demonstration assertion expected dialogue-only instead of the actual dialogue-only-no-execution code; product behavior correctly rejected the request.',
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ video, duration, frames: frames.length }));
