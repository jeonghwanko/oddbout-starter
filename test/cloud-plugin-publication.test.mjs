import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCloudPluginSite, prose } from '../scripts/build-cloud-plugin-site.mjs';

test('a clean publication preserves submitted review links and completed registration evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oddbout-review-publication-'));
  try {
    await buildCloudPluginSite(root);
    const dir = join(root, 'cloud-plugin/review-20261024');
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    for (const file of ['evidence.json', 'native-registration-evidence.json', 'walkthrough.mp4', 'logo.webp', 'Pretendard-Regular.woff2',
      'deletion.html', 'deletion-checks.json', 'native-deletion-evidence.json', 'walkthrough-with-deletion.mp4']) {
      assert.ok((await stat(join(dir, file))).size > 0, `Public review file missing: ${file}`);
    }
    assert.match(html, /href="native-registration-evidence.json"/);
    const native = JSON.parse(await readFile(join(dir, 'native-registration-evidence.json'), 'utf8'));
    assert.equal(native.registration.stage, 'registered');
    assert.equal(native.sourcePackage.assetCount, 11);
    assert.equal(native.sourcePackage.newGeneration, false);
    assert.match(html, /review-20261025/);
    const supplement = join(root, 'cloud-plugin/review-20261025');
    for (const file of ['index.html', 'index.ko.html', 'style.css', 'reviewer-sample.zip',
      'walkthrough.mp4', 'walkthrough.en.vtt', 'walkthrough.ko.vtt', 'poster.png', 'video-provenance.json']) {
      assert.ok((await stat(join(supplement, file))).size > 0, `Supplement missing: ${file}`);
    }
    const completed = JSON.parse(await readFile(join(supplement, 'native-registration-evidence.json'), 'utf8'));
    assert.equal(completed.registration.stage, 'registered');
    assert.equal(completed.registration.runtimeApproved, true);
    assert.equal(completed.registration.validation.checkedAssetCount, 11);
    assert.equal(completed.events.filter(e => e.tool === 'upload_fighter_asset' && e.ok).length, 11);
    assert.equal(completed.newGeneration, false);
    for (const [file, expected] of [
      ['privacy.html', ['no scheduled automatic erasure', 'more than 29 days old', 'does not erase files', '10 minutes']],
      ['privacy.ko.html', ['자동 파기 일정이 없습니다', '29일이 지나면 매시간', '파일이 지워지는 것은 아닙니다', '10분']]
    ]) {
      const policy = await readFile(join(root, 'cloud-plugin', file), 'utf8');
      for (const phrase of expected) assert.ok(policy.includes(phrase), `Retention disclosure missing: ${phrase}`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

// The Claude directory (2026-11-01) wants a public setup page, and a privacy notice that names every connected host, what the game
// tools receive, what is public and how long request logs last, plus a place to report vulnerabilities.
test('the connector pages cover every connected app, and the Claude page links its install dialog and the policies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oddbout-connector-pages-'));
  try {
    await buildCloudPluginSite(root);
    const page = file => readFile(join(root, 'cloud-plugin', file), 'utf8');
    const install = 'https://claude.ai/customize/connectors?modal=add-custom-connector&amp;connectorName=ODDBOUT&amp;connectorUrl=https%3A%2F%2Fmcp.oddbout.com%2Fclaude';
    for (const [file, policies] of [['claude.html', ''], ['claude.ko.html', '.ko']]) {
      const html = await page(file);
      assert.ok(html.includes(`<a href="${install}">`), `${file}: install dialog`);
      assert.match(html, /https:\/\/mcp\.oddbout\.com\/claude/);
      for (const name of ['privacy', 'terms', 'support']) assert.ok(html.includes(`href="https://oddbout.com/cloud-plugin/${name}${policies}.html"`), `${file}: ${name}`);
      assert.match(html, /other-address/);
      assert.match(html, /aria-current="page">Claude</);
    }
    for (const [file, phrases] of [
      ['privacy.html', ['Anthropic for Claude', 'Game and community tools', 'Public writing', 'within 30 days', 'declined ones', 'for example Dots or Claude']],
      ['privacy.ko.html', ['Claude는 Anthropic', '게임과 커뮤니티 도구', '공개되는 글', '30일 안에', '거절한 글 포함', '예: Dots, Claude']],
      ['terms.html', ['Community writing', 'Claude directory edition does not generate or upload art', 'My agents']],
      ['terms.ko.html', ['커뮤니티 글', 'Claude 디렉터리판은 그림을 생성하거나 업로드하지 않습니다', '내 에이전트']],
      ['support.html', ['Security reports', 'href="https://oddbout.com/cloud-plugin/claude.html"']],
      ['support.ko.html', ['보안 신고', 'href="https://oddbout.com/cloud-plugin/claude.ko.html"']],
      // Who runs it and what it answers for (2026-11-02 사용자: 개인 팀이 IP를 위해 운영, 책임을 질 수 없다는 명시). An exclusion of
      // liability for intent or gross negligence is void (약관규제법 제7조 1호), so the carve-out stays with every exclusion.
      ['terms.html', ['small independent team of individuals', 'grow the ODDBOUT IP', 'not affiliated with or endorsed by OpenAI, Anthropic, xAI or Google',
        '&quot;as is&quot;', 'Unless caused by our intent or gross negligence', 'liability the law does not allow us to exclude (including under privacy law)']],
      ['terms.ko.html', ['개인으로 이루어진 작은 독립 팀', 'ODDBOUT IP', '운영자의 고의 또는 중대한 과실로 인한 경우가 아니면', '개인정보 보호법 등 법령상 배제할 수 없는 책임']],
      ['privacy.html', ['does not reduce your privacy rights']],
      ['privacy.ko.html', ['개인정보 보호가 줄지는 않습니다']],
      ['support.html', ['best effort', 'href="https://oddbout.com/cloud-plugin/terms.html"']],
      ['support.ko.html', ['가능한 범위에서', 'href="https://oddbout.com/cloud-plugin/terms.ko.html"']],
    ]) {
      const html = await page(file);
      for (const phrase of phrases) assert.ok(html.includes(phrase), `${file}: ${phrase}`);
    }
    // Every page names the connector, not one app's plugin, and no link markup is left as text.
    for (const file of ['index', 'privacy', 'terms', 'support', 'claude'].flatMap(key => [`${key}.html`, `${key}.ko.html`])) {
      const html = await page(file);
      assert.match(html, /ODDBOUT CONNECTOR/, file);
      assert.doesNotMatch(html, /\]\(https?:/, file);
      // No blanket "no liability at all": the FTC has had exactly that rewritten, and it would be void.
      assert.doesNotMatch(html, /일체의? 책임|any responsibility at all|under no circumstances/i, file);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('section text becomes a link only for an https address', () => {
  assert.equal(prose('See [the page](https://oddbout.com/x?a=1&b=2).'), 'See <a href="https://oddbout.com/x?a=1&amp;b=2">the page</a>.');
  assert.equal(prose('[no](javascript:alert(1)) <b>'), '[no](javascript:alert(1)) &lt;b&gt;');
  assert.equal(prose('[quote"](https://x.test/")'), '<a href="https://x.test/&quot;">quote&quot;</a>');
});
