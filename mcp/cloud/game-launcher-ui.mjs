// @ts-check
// ChatGPT Apps SDK widget for launching the existing ODDBOUT browser game.
// This module does not fetch private information or create an ODDBOUT session.
export const GAME_LAUNCHER_UI = 'ui://oddbout/game-launcher-v1.html';
export const GAME_URL = 'https://oddbout.com/fighter.html';
const mimeType = 'text/html;profile=mcp-app';
// Reuse the widget origin already declared for ODDBOUT's hosted-look UI.
// A distinct app/widget origin must be registered before switching this value.
const widgetDomain = 'https://hosted-looks.oddbout.com';
const frameDomain = 'https://oddbout.com';
export const gameLauncherMeta = {
  ui: {
    domain: widgetDomain,
    prefersBorder: false,
    csp: {
      connectDomains: [],
      resourceDomains: [],
      frameDomains: [frameDomain],
    },
  },
  'openai/widgetDomain': widgetDomain,
  'openai/widgetCSP': {
    connect_domains: [],
    resource_domains: [],
    frame_domains: [frameDomain],
  },
  'openai/ui': {
    availableDisplayModes: ['inline', 'fullscreen'],
  },
  'openai/widgetDescription': 'ODDBOUT game launcher: opens the existing Phaser game inside this ChatGPT conversation.',
};
export const gameLauncherHtml = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>ODDBOUT · Game Launcher</title>
<style>
:root{color-scheme:dark;font:15px/1.5 system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:#10141d;color:#f5f7fa}
main{padding:14px;min-height:200px}header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
h1{font-size:1.3rem;letter-spacing:.04em;margin:0}.sub{font-size:12px;color:#a5b0c2}
.controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
button{border:0;border-radius:8px;padding:10px 14px;background:#19bda8;color:#071b1a;font:inherit;font-weight:700;cursor:pointer}
button.secondary{background:#2b3443;color:#f5f7fa}button:disabled{opacity:.55}
#message{color:#b6c3d4;margin:0 0 12px;font-size:13px}#stage{display:none;min-height:340px}
#game{width:100%;height:min(74vh,800px);min-height:340px;border:0;background:#05070a;border-radius:10px}
@media(max-width:600px){main{padding:8px}#game{height:min(72dvh,780px)}}
</style></head>
<body><main>
<header><h1>ODDBOUT</h1><span class="sub">ChatGPT Game Launcher</span></header>
<div class="controls">
<button id="start">게임 시작</button>
<button id="full" class="secondary">전체화면</button>
<button id="back" class="secondary" hidden>런처로 돌아가기</button>
</div>
<p id="message" role="status" aria-live="polite">기존 ODDBOUT 게임을 ChatGPT 안에서 실행합니다.</p>
<section id="stage"><iframe id="game" title="ODDBOUT game" allow="autoplay; fullscreen; gamepad" referrerpolicy="no-referrer"></iframe></section>
</main>
<script>
(function(){
'use strict';
const GAME_URL = ${JSON.stringify(GAME_URL)};
const frame = document.getElementById('game');
const stage = document.getElementById('stage');
const start = document.getElementById('start');
const back = document.getElementById('back');
const full = document.getElementById('full');
const message = document.getElementById('message');
let watchdog = null;
let started = false;
function note(text){message.textContent=text}
function stop(){
  clearTimeout(watchdog);watchdog=null;stage.style.display='none';
  frame.removeAttribute('src');start.hidden=false;back.hidden=true;start.disabled=false;
  started=false;note('게임을 종료했습니다. 다시 시작할 수 있습니다.');
}
function begin(){
  if(started)return;
  started=true;start.hidden=true;back.hidden=false;stage.style.display='block';
  note('게임 페이지 연결 중…');
  frame.src=GAME_URL;
  watchdog=setTimeout(()=>note('로딩이 오래 걸립니다. iframe 보안 설정 및 로그인 상태를 확인하세요.'),15000);
}
frame.addEventListener('load',()=>{
  clearTimeout(watchdog);watchdog=null;
  // A load event also fires for some blocked/error pages. It is NOT gameplay success.
  note('페이지 로드 완료. 게임 화면과 로그인을 직접 확인하세요.');
});
frame.addEventListener('error',()=>{clearTimeout(watchdog);note('페이지 로딩 실패. 프레임 차단 설정을 확인하세요.')});
start.addEventListener('click',begin);back.addEventListener('click',stop);
full.addEventListener('click',async()=>{
  if(typeof window.openai?.requestDisplayMode!=='function'){
    note('이 ChatGPT 환경에서는 전체화면 API를 사용할 수 없습니다.');return;
  }
  try{await window.openai.requestDisplayMode({mode:'fullscreen'});}
  catch{note('전체화면 요청이 거부되었습니다.');}
});
window.addEventListener('pagehide',()=>clearTimeout(watchdog));
// MCP Apps initialization handshake, matching the host's required UI bridge.
const post=message=>parent.postMessage({jsonrpc:'2.0',...message},'*');
window.addEventListener('message',event=>{
  if(event.source!==parent || event.data?.jsonrpc!=='2.0')return;
  if(event.data.id===1 && event.data.result){
    const locale=event.data.result.hostContext?.locale;
    if(locale)document.documentElement.lang=locale;
    post({method:'ui/notifications/initialized',params:{}});
  }
});
if(typeof ResizeObserver==='function'){
  new ResizeObserver(()=>post({method:'ui/notifications/size-changed',params:{height:document.body.scrollHeight}})).observe(document.body);
}
post({id:1,method:'ui/initialize',params:{appInfo:{name:'ODDBOUT launcher',version:'1.0.0'},appCapabilities:{},protocolVersion:'2026-01-26'}});
})();
</script></body></html>`;

/** @param {import('@modelcontextprotocol/server').McpServer} server */
export function registerGameLauncherUi(server) {
  server.registerResource('oddbout-game-launcher', GAME_LAUNCHER_UI, { mimeType, _meta: gameLauncherMeta }, () => ({
    contents: [{ uri: GAME_LAUNCHER_UI, mimeType, text: gameLauncherHtml, _meta: gameLauncherMeta }],
  }));
}

/** @param {import('./common.mjs').Register} register */
export function registerGameLauncherTool(register) {
  register(
    'open_game_launcher',
    'Open ODDBOUT game launcher',
    'Display the existing ODDBOUT Phaser web game in a ChatGPT interactive widget. Use when a user asks to launch, open or play ODDBOUT inside ChatGPT. This read-only tool opens a game launcher; it does not start a match or perform account changes. The game may require its own sign-in.',
    {},
    async () => ({
      ok: true,
      game: 'ODDBOUT',
      launchMode: 'embedded-iframe',
      gameUrl: GAME_URL,
      note: 'Launcher available. Page loading is not proof of successful game rendering or authentication.',
    }),
    { openWorld: false },
  );
}
