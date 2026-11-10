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
  'openai/widgetDescription':
    'Launch the ODDBOUT browser game inside ChatGPT when browser embedding permits; game authentication and readiness are checked separately.',
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
<section id="stage"><iframe id="game" title="ODDBOUT game" allow="fullscreen; gamepad" referrerpolicy="no-referrer"></iframe></section>
</main>
<script>
(function(){
'use strict';
const GAME_URL = ${JSON.stringify(GAME_URL)};
const GAME_ORIGIN = new URL(GAME_URL).origin;
const CHANNEL = 'oddbout-launcher-v1';
const frame = document.getElementById('game');
const stage = document.getElementById('stage');
const start = document.getElementById('start');
const back = document.getElementById('back');
const full = document.getElementById('full');
const message = document.getElementById('message');
let state = 'idle';
let hostModes = null;
let nonce = null;
let watchdog = null;
function note(value){message.textContent=value}
function resetTimer(){if(watchdog!==null){clearTimeout(watchdog);watchdog=null}}
function armWatchdog(){
  resetTimer();
  armWatchdog();
}
function stop(){
  state='idle';nonce=null;resetTimer();
  stage.style.display='none';
  frame.removeAttribute('src');
  start.hidden=false;back.hidden=true;
  note('런처로 돌아왔습니다. 게임 시작을 눌러 다시 실행할 수 있습니다.');
}
function requestFullscreen(showError=false){
  if(!hostModes?.has('fullscreen')||typeof window.openai?.requestDisplayMode!=='function'){
    if(showError)note('ChatGPT 호스트가 전체화면 지원을 확인하지 않았습니다.');return;
  }
  try{
    Promise.resolve(window.openai.requestDisplayMode({mode:'fullscreen'}))
      .then(result=>{
        if(showError&&result?.mode&&result.mode!=='fullscreen')note('호스트가 전체화면 대신 다른 표시 모드를 선택했습니다.');
      },()=>{if(showError)note('전체화면 요청이 거부되었습니다.');});
  }catch{if(showError)note('전체화면 요청이 거부되었습니다.');}
}
function begin(){
  if(state!=='idle')return;
  if(typeof crypto==='undefined'||typeof crypto.getRandomValues!=='function'){
    note('보안 난수 생성 기능이 없어 게임 실행을 중단했습니다.');return;
  }
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  nonce=Array.from(bytes, n=>n.toString(16).padStart(2,'0')).join('');
  state='loading';
  start.hidden=true;back.hidden=false;stage.style.display='block';
  note('게임을 불러오는 중…');
  requestFullscreen();
  frame.src=GAME_URL;
  watchdog=setTimeout(()=>{
    if(state==='loading'||state==='document-loaded'){
      state='unverified';
      note('게임 실행을 확인하지 못했습니다. 화면이 보이지 않으면 iframe 정책, 네트워크 또는 로그인을 확인하세요.');
    }
  },20000);
}
frame.addEventListener('load',()=>{
  if(state==='idle')return;
  state='document-loaded';
  if(watchdog===null)armWatchdog();
  note('페이지 로드 이벤트 수신. Phaser 실행은 아직 확인되지 않았습니다.');
  try{frame.contentWindow?.postMessage({channel:CHANNEL,type:'launcher:hello',nonce},GAME_ORIGIN)}
  catch{/* Cross-origin navigation can prevent the optional readiness handshake. */}
});
frame.addEventListener('error',()=>{
  if(state==='idle')return;
  resetTimer();state='unverified';
  note('게임 프레임에서 오류가 감지되었습니다. iframe 허용 설정을 확인하세요.');
});
start.addEventListener('click',begin);
back.addEventListener('click',stop);
full.addEventListener('click',()=>requestFullscreen(true));
window.addEventListener('pagehide',resetTimer);
const post=message=>parent.postMessage({jsonrpc:'2.0',...message},'*');
window.addEventListener('message',event=>{
  if(event.source===frame.contentWindow){
    const data=event.data;
    if(event.origin!==GAME_ORIGIN||!data||data.channel!==CHANNEL||
      typeof data.nonce!=='string'||data.nonce!==nonce||state==='idle')return;
    if(data.type==='game:ready'){
      resetTimer();state='ready';
      note('Phaser 실행 준비 신호를 확인했습니다. 실제 조작 및 로그인 상태는 별도로 확인하세요.');
    }else if(data.type==='game:auth-required'){
      resetTimer();state='auth-required';
      note('게임에서 로그인이 필요하다고 알렸습니다. ChatGPT 로그인과 게임 로그인은 자동으로 공유되지 않습니다.');
    }else if(data.type==='game:error'){
      resetTimer();state='unverified';
      note('ODDBOUT 게임에서 실행 오류를 보고했습니다.');
    }
    return;
  }
  if(event.source!==parent||event.data?.jsonrpc!=='2.0')return;
  if(event.data.method==='ui/notifications/host-context-changed'){
    const modes=event.data.params?.availableDisplayModes;
    if(Array.isArray(modes))hostModes=new Set(modes.filter(m=>m==='inline'||m==='fullscreen'));
  }
  if(event.data.id===1 && event.data.result){
    const modes=event.data.result.hostContext?.availableDisplayModes;
    if(Array.isArray(modes))hostModes=new Set(modes.filter(m=>m==='inline'||m==='fullscreen'));
    const locale=event.data.result.hostContext?.locale;
    if(typeof locale==='string'&&locale.length<=20)document.documentElement.lang=locale;
    post({method:'ui/notifications/initialized',params:{}});
  }
});
if(typeof ResizeObserver==='function'){
  new ResizeObserver(()=>post({method:'ui/notifications/size-changed',params:{height:document.body.scrollHeight}})).observe(document.body);
}
post({id:1,method:'ui/initialize',params:{
  appInfo:{name:'ODDBOUT launcher',version:'1.0.1'},
  appCapabilities:{availableDisplayModes:['inline','fullscreen']},
  protocolVersion:'2026-01-26'
}});
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
    'Show an interactive iframe launcher for ODDBOUT in ChatGPT, when the user explicitly asks to launch or play. Rendering and game sign-in depend on browser and iframe policy. Calling this read-only tool does not start a match, spend resources or change a fighter.',
    {},
    async () => ({
      ok: true,
      game: 'ODDBOUT',
      launchMode: 'embedded-iframe',
      gameUrl: GAME_URL,
      note: 'Launcher UI supplied. No game session or Phaser rendering has been verified.',
    }),
    { openWorld: false },
  );
}
