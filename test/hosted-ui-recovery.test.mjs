import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { registerLookUi } from '../mcp/cloud/hosted-look-ui.mjs';
import { hostedStatus } from '../mcp/cloud/hosted-tools.mjs';
import { CLOUD_RESOURCE } from '../mcp/cloud/resources.mjs';

function widget() {
  let html;
  registerLookUi({ registerResource: (_n, _u, _m, read) => { html = read().contents[0].text; } });
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    get text() { return this.textContent + this.children.map(x => x.text).join(' '); }
    get all() { return [this, ...this.children.flatMap(x => x.all)]; }
  }
  const root = new El('main'), window = { addEventListener() {} };
  const context = vm.createContext({ URL, window, document: { querySelector: () => root, createElement: tag => new El(tag),
    documentElement: { lang: 'ko' }, body: {} }, navigator: { language: 'ko' },
    parent: { postMessage() {} }, ResizeObserver: class { observe() {} } });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { root, window, globals: () => vm.runInContext('fromGlobals()', context),
    render: result => { context.result = result; vm.runInContext('render(result)', context); } };
}
function result(id, status, at) {
  const job = { id, status, submission: status === 'submitted' ? { stage: 'registered' } : null };
  return { structuredContent: { job, statusSummary: { ...hostedStatus(job), updatedAt: at, checkedAt: at }, siteUrl: 'https://oddbout.com/' } };
}

test('signed previews still render when the server could not attach inline images', () => {
  const ui = widget(), id = crypto.randomUUID(), output = result(id, 'appearance_ready', '2026-11-07T12:00:00Z');
  output.structuredContent.job.candidates = ['a', 'b'].map(key => ({ key,
    url: `${new URL(CLOUD_RESOURCE).origin}/storage/v1/object/sign/af-generation/jobs/${id}/front-${key}-0.webp?token=fixture` }));
  // No previewPair: the MCP returns its ordinary signed-link fallback when inline download fails.
  ui.render(output);
  assert.match(ui.root.text, /두 외형 비교/);
  assert.equal(ui.root.all.filter(n => n.tag === 'img').length, 2);
  output.structuredContent.job.candidates[1].url = 'https://untrusted.example/picture.webp';
  ui.render(output); assert.equal(ui.root.all.filter(n => n.tag === 'img').length, 0);
});

test('current toolOutput wins over stale response metadata in the ChatGPT globals bridge', () => {
  const ui = widget();
  ui.window.openai = { locale: 'ko', toolOutput: result('a', 'submitted', '2026-11-07T12:00:00Z').structuredContent,
    toolResponseMetadata: { mcp_tool_result: result('a', 'motions', '2026-11-07T11:00:00Z') } };
  ui.globals(); assert.match(ui.root.text, /등록 완료/); assert.doesNotMatch(ui.root.text, /모션 제작 중/);
});

test('stale metadata images cannot be paired with the current appearance candidates', () => {
  const ui = widget(), id = crypto.randomUUID(), current = result(id, 'appearance_ready', '2026-11-07T12:00:00Z');
  current.structuredContent.previewPair = true;
  current.structuredContent.job.candidates = ['a', 'b'].map(key => ({ key,
    url: `${new URL(CLOUD_RESOURCE).origin}/storage/v1/object/sign/af-generation/jobs/${id}/front-${key}-1.webp?token=fixture` }));
  const old = result(id, 'appearance_ready', '2026-11-07T11:00:00Z');
  old.structuredContent.previewPair = true;
  old.content = ['YWJj', 'ZGVm'].map(data => ({ type: 'image', mimeType: 'image/webp', data }));
  ui.window.openai = { locale: 'ko', toolOutput: current.structuredContent, toolResponseMetadata: { mcp_tool_result: old } };
  ui.globals();
  assert.deepEqual(ui.root.all.filter(n => n.tag === 'img').map(n => n.src), current.structuredContent.job.candidates.map(c => c.url));
  // Metadata images remain usable when they actually belong to the current output.
  ui.window.openai.toolResponseMetadata.mcp_tool_result = { ...current, content: old.content };
  ui.globals();
  assert.deepEqual(ui.root.all.filter(n => n.tag === 'img').map(n => n.src), old.content.map(b => 'data:image/webp;base64,' + b.data));
});

test('returning to a previous job with a delayed read shows that job, not the last different job', () => {
  const ui = widget();
  ui.render(result('a', 'submitted', '2026-11-07T12:00:00Z'));
  ui.render(result('b', 'needs_review', '2026-11-07T12:00:00Z'));
  ui.render(result('a', 'motions', '2026-11-07T11:00:00Z'));
  assert.match(ui.root.text, /등록 완료/); assert.doesNotMatch(ui.root.text, /운영자 확인 필요|모션 제작 중/);
});

test('final submission receipts beat response completion clocks in either arrival order and in lists', () => {
  for (const stage of ['registered', 'rejected']) for (const reversed of [false, true]) {
    const ui = widget(), job = { id: 'a', status: 'submitted', updatedAt: '2026-11-07T10:00:00Z' };
    const receipt = (stage, checkedAt) => {
      const snapshot = { ...job, submission: { id: 'immutable-submission', stage } };
      return { structuredContent: { job: snapshot, statusSummary: { ...hostedStatus(snapshot), checkedAt }, siteUrl: 'https://oddbout.com/' } };
    };
    // The earlier read of validation takes longer to finish. The job timestamp never changes when its submission finishes.
    const final = receipt(stage, '2026-11-07T12:00:00Z'), pending = receipt('validating', '2026-11-07T12:00:01Z');
    for (const response of reversed ? [pending, final] : [final, pending]) ui.render(response);
    const label = stage === 'registered' ? /등록 완료/ : /작업 종료·중단/;
    assert.match(ui.root.text, label); assert.doesNotMatch(ui.root.text, /등록 파일 검사 중/);
    ui.render({ structuredContent: { jobs: [{ ...pending.structuredContent.job,
      statusSummary: pending.structuredContent.statusSummary, siteUrl: pending.structuredContent.siteUrl }] } });
    assert.match(ui.root.text, label); assert.doesNotMatch(ui.root.text, /등록 파일 검사 중/);
    const listFirst = widget();
    listFirst.render({ structuredContent: { jobs: [{ ...final.structuredContent.job,
      statusSummary: final.structuredContent.statusSummary, siteUrl: final.structuredContent.siteUrl }] } });
    listFirst.render(pending); assert.match(listFirst.root.text, label);
  }
});

test('a current list preserves same-version previews and a resumed operator review may still advance', () => {
  const ui = widget(), id = crypto.randomUUID(), appearance = result(id, 'appearance_ready', '2026-11-07T12:00:00Z');
  appearance.structuredContent.job.candidates = ['a', 'b'].map(key => ({ key,
    url: `${new URL(CLOUD_RESOURCE).origin}/storage/v1/object/sign/af-generation/jobs/${id}/front-${key}-0.webp?token=fixture` }));
  ui.render(appearance);
  ui.render({ structuredContent: { jobs: [{ id, status: 'appearance_ready',
    statusSummary: { ...appearance.structuredContent.statusSummary, checkedAt: '2026-11-07T12:01:00Z' } }] } });
  ui.render(appearance); assert.equal(ui.root.all.filter(n => n.tag === 'img').length, 2);
  ui.render(result('recoverable', 'needs_review', '2026-11-07T12:00:00Z'));
  ui.render(result('recoverable', 'motions', '2026-11-07T12:01:00Z'));
  assert.match(ui.root.text, /모션 제작 중/); assert.doesNotMatch(ui.root.text, /운영자 확인 필요/);
});
