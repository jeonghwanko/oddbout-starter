import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { hostedStatus, hostedNext } from '../mcp/cloud/hosted-tools.mjs';
import { registerLookUi } from '../mcp/cloud/hosted-look-ui.mjs';

test('100% is stage progress; only a registered submission completes creation', () => {
  for (const status of ['motions', 'motion_ready', 'submitting', 'submitted', 'needs_review']) {
    const result = hostedStatus({ id: 'job', status, progress: 100 });
    assert.equal(result.completed, false, status);
    assert.equal(result.stageProgress, 100);
    assert.ok(result.checkedAt);
  }
  const done = hostedStatus({ id: 'job', status: 'submitted', submission: { stage: 'registered' } });
  assert.equal(done.completed, true); assert.equal(done.actionRequired, 'enter_on_site');
  assert.equal(hostedStatus({ id: 'job', status: 'submitted', submission: { stage: 'rejected' } }).state, 'stopped');
  assert.equal(hostedStatus({ id: 'job', status: 'appearance_ready' }).actionRequired, 'choose_look');
  assert.equal(hostedStatus({ id: 'job', status: 'needs_review' }).actionRequired, 'operator');
  assert.equal(hostedStatus({ id: 'job', status: 'motion_ready' }).actionRequired, 'agent_register');
  assert.match(hostedNext({ id: 'job', status: 'motion_ready' }), /without asking for motion approval/);
});

test('chat card shows completion, required action and snapshot time without raw states or unsafe links', () => {
  let html;
  registerLookUi({ registerResource: (_name, _uri, _meta, read) => { html = read().contents[0].text; } });
  class El {
    constructor() { this.children = []; this.textContent = ''; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    get text() { return this.textContent + this.children.map(x => x.text).join(' '); }
  }
  const root = new El();
  const context = vm.createContext({ URL, document: { querySelector: () => root, createElement: () => new El(),
    documentElement: { lang: 'ko' }, body: {} }, navigator: { language: 'ko' },
    window: { addEventListener() {} }, parent: { postMessage() {} }, ResizeObserver: class { observe() {} } });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  const draw = (status, submission, siteUrl = 'https://oddbout.com/') => {
    const job = { id: 'job', status, progress: 100, submission };
    context.result = { structuredContent: { job, statusSummary: hostedStatus(job), siteUrl } };
    vm.runInContext('render(result)', context);
  };
  draw('motions'); assert.match(root.text, /모션 제작 중/); assert.match(root.text, /전체 완료율 아님/);
  assert.match(root.text, /자동 알림이 아닙니다/); assert.match(root.text, /확인 시각/);
  draw('submitted', { stage: 'registered' }); assert.match(root.text, /등록 완료 · 출전 전/);
  draw('needs_review'); assert.match(root.text, /사용자 응답 대기가 아닙니다/);
  draw('motion_ready', null, 'https://oddbout.com.evil.example/');
  assert.match(root.text, /모션 승인은 필요 없습니다/); assert.ok(root.children.every(n => !n.href));
});
