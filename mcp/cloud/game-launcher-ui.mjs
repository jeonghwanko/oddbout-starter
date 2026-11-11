// @ts-check
// ChatGPT Apps SDK component for starting the existing ODDBOUT game in an iframe.
import { z } from 'zod';
import { UUID_ARG } from './common.mjs';

export const GAME_LAUNCHER_UI = 'ui://oddbout/game-launcher-v2.html';
const mimeType = 'text/html;profile=mcp-app';
const widgetDomain = 'https://hosted-looks.oddbout.com';

/**
 * Only a configured HTTPS URL for the dedicated embed route enables this UI.
 * @param {{enabled?: boolean, gameUrl?: string} | null | undefined} config
 */
export function configuredGameLauncher(config) {
  if (config?.enabled !== true || typeof config.gameUrl !== 'string') return null;
  try {
    const url = new URL(config.gameUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/embed/chatgpt/' ||
      config.gameUrl.includes('?') ||
      config.gameUrl.includes('#') ||
      url.search ||
      url.hash ||
      config.gameUrl !== url.href
    )
      return null;
    return Object.freeze({ url: url.href, origin: url.origin });
  } catch {
    return null;
  }
}

/** @param {string} gameOrigin */
export function gameLauncherMetadata(gameOrigin) {
  return {
    ui: {
      domain: widgetDomain,
      prefersBorder: false,
      csp: { connectDomains: [], resourceDomains: [], frameDomains: [gameOrigin] },
    },
    'openai/widgetDomain': widgetDomain,
    'openai/widgetCSP': { connect_domains: [], resource_domains: [], frame_domains: [gameOrigin] },
    'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'] },
    'openai/widgetDescription': 'Start the ODDBOUT game after the user chooses Start. The game must confirm its own sign-in and readiness.',
  };
}

/** @param {{url: string, origin: string}} game */
export function gameLauncherHtmlFor(game) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>ODDBOUT · Game Launcher</title>
<style>
:root{color-scheme:dark;font:15px/1.5 system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;background:#10141d;color:#f5f7fa}
main{padding:14px;min-height:180px}header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
h1{font-size:1.3rem;letter-spacing:.04em;margin:0}.sub{font-size:12px;color:#a5b0c2}.controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
button{border:0;border-radius:8px;padding:10px 14px;background:#19bda8;color:#071b1a;font:inherit;font-weight:700;cursor:pointer}
button.secondary{background:#2b3443;color:#f5f7fa}button:disabled{opacity:.55}#message{color:#b6c3d4;margin:0 0 12px;font-size:13px}
#stage{display:none;min-height:300px}iframe{width:100%;height:min(74vh,800px);min-height:300px;border:0;background:#05070a;border-radius:10px}
@media(max-width:600px){main{padding:8px}iframe{height:min(72dvh,780px)}}
</style></head><body><main>
<header><h1>ODDBOUT</h1><span class="sub">ChatGPT Game Launcher</span></header>
<div class="controls"><button id="start">게임 시작</button><button id="reload" class="secondary" hidden>다시 시작</button>
<button id="full" class="secondary">전체화면</button><button id="back" class="secondary" hidden>런처로 돌아가기</button></div>
<p id="message" role="status" aria-live="polite">게임을 시작하면 ODDBOUT 로그인을 확인합니다.</p>
<section id="stage"></section></main>
<script>
(function(){'use strict';
const GAME_URL=${JSON.stringify(game.url)}, GAME_ORIGIN=${JSON.stringify(game.origin)}, CHANNEL='oddbout-launcher-v2';
const stage=document.getElementById('stage'), start=document.getElementById('start'), reload=document.getElementById('reload');
const back=document.getElementById('back'), full=document.getElementById('full'), message=document.getElementById('message');
let state='idle', frame=null, nonce=null, attemptId=null, watchdog=null, helloTimer=null, helloCount=0, grantRequestGeneration=0, hostModes=null, gameReady=false, gameAuthenticated=false;
function localizeControls(){const locale=(window.openai?.locale||document.documentElement.lang||'ko').toLowerCase(),english=locale.startsWith('en');
  start.textContent=english?'Start game':'게임 시작';reload.textContent=english?'Restart':'다시 시작';
  back.textContent=english?'Close game':'런처로 돌아가기';full.textContent=english?'Fullscreen':'전체화면';document.documentElement.lang=english?'en':'ko'}
function say(en,ko){const locale=(window.openai?.locale||document.documentElement.lang||'ko').toLowerCase();message.textContent=locale.startsWith('en')?en:ko;localizeControls()}
function note(en,ko){say(en,ko)}
function resetTimer(){if(watchdog!==null){clearTimeout(watchdog);watchdog=null}}
function resetHello(){if(helloTimer!==null){clearTimeout(helloTimer);helloTimer=null}helloCount=0}
function armWatchdog(expectedAttempt, expectedState, text){resetTimer();watchdog=setTimeout(()=>{
  if(attemptId!==expectedAttempt||state!==expectedState)return;resetHello();state='unverified';note(text[0],text[1]);
},20000)}
function freshId(){if(typeof crypto?.randomUUID!=='function')throw Error('secure-random-unavailable');return crypto.randomUUID().toLowerCase()}
function randomNonce(){if(typeof crypto?.getRandomValues!=='function')throw Error('secure-random-unavailable');
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}
function removeFrame(){resetHello();if(frame){sendToGame('launcher:stop',{});frame.removeAttribute('src');frame.remove();frame=null}stage.replaceChildren();stage.style.display='none'}
function stop(){grantRequestGeneration++;resetTimer();resetHello();removeFrame();state='idle';nonce=null;attemptId=null;gameReady=false;gameAuthenticated=false;start.hidden=false;reload.hidden=true;back.hidden=true;
  note('The game was closed. Select Start to open a new game.','게임을 닫았습니다. 새로 시작하려면 게임 시작을 누르세요.')}
function requestFullscreen(showError){if(!hostModes?.has('fullscreen')||typeof window.openai?.requestDisplayMode!=='function'){
  if(showError)note('Fullscreen is not available here.','전체화면을 사용할 수 없습니다.');return}
  Promise.resolve().then(()=>window.openai.requestDisplayMode({mode:'fullscreen'})).then(result=>{
    if(showError&&result?.mode&&result.mode!=='fullscreen')note('The host kept the current view.','현재 화면을 유지했습니다.')
  },()=>{if(showError)note('Fullscreen could not be opened.','전체화면을 열지 못했습니다.')})}
function validBase64url43(value){return typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)}
function reportGameStatus(){
  if(gameReady&&gameAuthenticated)note('ODDBOUT sign-in confirmed. The game is ready.','ODDBOUT 로그인을 확인했고 게임 준비가 끝났습니다.');
  else if(gameAuthenticated)note('ODDBOUT sign-in confirmed. Waiting for the game…','ODDBOUT 로그인을 확인했습니다. 게임을 불러오는 중…');
  else if(gameReady)note('The game is ready. Sign-in is still being confirmed.','게임 준비가 끝났습니다. 로그인은 아직 확인 중입니다.');
}
function sendToGame(type, extra){if(!frame?.contentWindow||!attemptId||!nonce)return;
  frame.contentWindow.postMessage({channel:CHANNEL,type,nonce,attemptId,...extra},GAME_ORIGIN)}
function repeatHello(expectedAttempt){
  if(attemptId!==expectedAttempt||state!=='handshake'||helloCount>=40)return;
  sendToGame('launcher:hello',{});helloCount++;
  helloTimer=setTimeout(()=>repeatHello(expectedAttempt),500);
}
function startAttempt(){
  grantRequestGeneration++;resetTimer();resetHello();removeFrame();gameReady=false;gameAuthenticated=false;
  try{nonce=randomNonce();attemptId=freshId()}catch{nonce=null;attemptId=null;state='idle';note('Secure startup is unavailable in this browser.','이 브라우저에서 보안 실행을 시작할 수 없습니다.');return}
  const thisAttempt=attemptId;state='loading';start.hidden=true;reload.hidden=false;back.hidden=false;stage.style.display='block';
  frame=document.createElement('iframe');frame.title=(window.openai?.locale||document.documentElement.lang||'ko').toLowerCase().startsWith('en')?'ODDBOUT game':'ODDBOUT 게임';
  frame.allow='fullscreen; gamepad';frame.referrerPolicy='no-referrer';
  stage.append(frame);note('Opening ODDBOUT…','ODDBOUT을 여는 중…');requestFullscreen(false);
  frame.addEventListener('load',()=>{
    if(attemptId!==thisAttempt||!frame||state==='idle')return;
    state='handshake';resetHello();repeatHello(thisAttempt);
    armWatchdog(thisAttempt,'handshake',['The game did not respond. Check your connection and try again.','게임 응답이 없습니다. 연결을 확인한 뒤 다시 시도하세요.']);
  });
  frame.addEventListener('error',()=>{if(attemptId!==thisAttempt)return;resetTimer();state='unverified';
    note('The game could not be opened. Try again later.','게임을 열지 못했습니다. 잠시 뒤 다시 시도하세요.')});
  frame.src=GAME_URL;
  armWatchdog(thisAttempt,'loading',['The game is taking too long to open.','게임을 여는 데 시간이 걸립니다.']);
}
function failAttempt(text){resetTimer();state='unverified';note(text[0],text[1])}
async function grantGame(data){
  if(state!=='auth-required'||!attemptId||!nonce||!window.openai||typeof window.openai.callTool!=='function')return;
  const thisAttempt=attemptId, thisNonce=nonce, thisChallenge=data.challenge, thisRequest=++grantRequestGeneration;state='granting';
  armWatchdog(thisAttempt,'granting',['Sign-in is taking too long. Try starting again.','로그인 확인이 오래 걸립니다. 다시 시작해 주세요.']);
  try{
    const result=await window.openai.callTool('issue_game_launch_grant',{nonce:thisNonce,attemptId:thisAttempt,challenge:data.challenge});
    if(attemptId!==thisAttempt||nonce!==thisNonce||state!=='granting'||grantRequestGeneration!==thisRequest)return;
    const envelope=result?.mcp_tool_result||result?.call_tool_result||result;
    const hostEnvelope=window.openai.toolResponseMetadata?.mcp_tool_result||window.openai.toolResponseMetadata?.call_tool_result||{_meta:window.openai.toolResponseMetadata};
    const privateResult=envelope?._meta?.attemptId===thisAttempt&&envelope?._meta?.nonce===thisNonce&&envelope?._meta?.challenge===thisChallenge?envelope._meta:
      hostEnvelope?._meta?.attemptId===thisAttempt&&hostEnvelope?._meta?.nonce===thisNonce&&hostEnvelope?._meta?.challenge===thisChallenge?hostEnvelope._meta:null;
    const grant=privateResult?.gameLaunchGrant;
    if(typeof grant!=='string'||!/^afg_[0-9a-f]{64}$/.test(grant))throw Error('grant-unavailable');
    resetTimer();state=gameReady?'ready':'grant-sent';sendToGame('launcher:grant',{grant});
    if(gameReady)armWatchdog(thisAttempt,'ready',['Sign-in was not confirmed. Try starting again.','로그인을 확인하지 못했습니다. 다시 시작해 주세요.']);
    else armWatchdog(thisAttempt,'grant-sent',['The game did not finish signing in. Try again.','게임 로그인이 끝나지 않았습니다. 다시 시도해 주세요.']);
  }catch{
    if(attemptId!==thisAttempt||nonce!==thisNonce||state!=='granting'||grantRequestGeneration!==thisRequest)return;
    failAttempt(['Sign-in could not be confirmed. Try starting again.','로그인을 확인하지 못했습니다. 다시 시작해 주세요.']);
  }
}
function validGameMessage(data){return data&&data.channel===CHANNEL&&data.nonce===nonce&&data.attemptId===attemptId}
window.addEventListener('message',event=>{
  if(frame&&event.source===frame.contentWindow){const data=event.data;
    if(event.origin!==GAME_ORIGIN||!validGameMessage(data)||state==='idle')return;
    if(['game:ready','game:auth-required','game:authenticated','game:error','game:close'].includes(data.type))resetHello();
    if(data.type==='game:auth-required'&&['handshake','ready','authenticated','unverified'].includes(state)){
      resetTimer();gameAuthenticated=false;
      if(!validBase64url43(data.challenge)){
        failAttempt(['The game sent an invalid sign-in challenge. Restart the game.','게임 로그인 요청이 올바르지 않습니다. 게임을 다시 시작해 주세요.']);
      }else{
        state='auth-required';note('Checking your ODDBOUT sign-in…','ODDBOUT 로그인을 확인하는 중…');void grantGame(data);
      }
    }else if(data.type==='game:ready'&&['handshake','granting','grant-sent','ready','authenticated'].includes(state)){
      const firstReady=!gameReady;gameReady=true;
      if(state==='handshake')state='ready';
      if(firstReady&&state==='ready'&&!gameAuthenticated)armWatchdog(attemptId,'ready',['Sign-in was not confirmed. Try starting again.','로그인을 확인하지 못했습니다. 다시 시작해 주세요.']);
      reportGameStatus();
    }else if(data.type==='game:authenticated'&&['grant-sent','ready','authenticated'].includes(state)){
      resetTimer();gameAuthenticated=true;state='authenticated';
      if(!gameReady)armWatchdog(attemptId,'authenticated',['The game did not finish loading. Try starting again.','게임 로딩이 끝나지 않았습니다. 다시 시작해 주세요.']);
      reportGameStatus();
    }else if(data.type==='game:error'&&typeof data.code==='string'){
      const errors={
        'invalid-grant':['The game sign-in expired. Start again.','게임 로그인 정보가 만료됐습니다. 다시 시작해 주세요.'],
        'sign-in-required':['Sign in to ODDBOUT in the game.','게임에서 ODDBOUT에 로그인해 주세요.'],
        'launch-failed':['The game could not start. Try again.','게임을 시작하지 못했습니다. 다시 시도해 주세요.']};
      failAttempt(errors[data.code]||['The game reported a problem. Try again.','게임에서 문제가 발생했습니다. 다시 시도해 주세요.']);
    }else if(data.type==='game:close'){stop()}
    return;
  }
  // This message listener handles only the ChatGPT Apps SDK host bridge; it never handles game messages.
  if(event.source!==parent||event.data?.jsonrpc!=='2.0')return;
  if(event.data.method==='ui/notifications/host-context-changed'){
    const modes=event.data.params?.availableDisplayModes;if(Array.isArray(modes))hostModes=new Set(modes.filter(m=>m==='inline'||m==='fullscreen'));
  }
  if(event.data.id===1&&event.data.result){
    const modes=event.data.result.hostContext?.availableDisplayModes;if(Array.isArray(modes))hostModes=new Set(modes.filter(m=>m==='inline'||m==='fullscreen'));
    const locale=event.data.result.hostContext?.locale;if(typeof locale==='string'&&locale.length<=20){document.documentElement.lang=locale;localizeControls()}
    post({method:'ui/notifications/initialized',params:{}});
  }
});
function post(value){parent.postMessage({jsonrpc:'2.0',...value},'*')}
start.addEventListener('click',startAttempt);reload.addEventListener('click',startAttempt);back.addEventListener('click',stop);
full.addEventListener('click',()=>requestFullscreen(true));window.addEventListener('pagehide',()=>{grantRequestGeneration++;resetTimer();resetHello();removeFrame()});
if(typeof ResizeObserver==='function')new ResizeObserver(()=>post({method:'ui/notifications/size-changed',params:{height:document.body.scrollHeight}})).observe(document.body);
post({id:1,method:'ui/initialize',params:{appInfo:{name:'ODDBOUT launcher',version:'2.0.0'},
  appCapabilities:{availableDisplayModes:['inline','fullscreen']},protocolVersion:'2026-01-26'}});
say('Select Start game to open ODDBOUT.','ODDBOUT을 열려면 게임 시작을 누르세요.');
})();
</script></body></html>`;
}

/** @param {import('@modelcontextprotocol/server').McpServer} server @param {{url:string,origin:string}} game */
export function registerGameLauncherUi(server, game) {
  server.registerResource('oddbout-game-launcher', GAME_LAUNCHER_UI, { mimeType, _meta: gameLauncherMetadata(game.origin) }, () => ({
    contents: [{ uri: GAME_LAUNCHER_UI, mimeType, text: gameLauncherHtmlFor(game), _meta: gameLauncherMetadata(game.origin) }],
  }));
}

/** @typedef {{ nonce: string, attemptId: string, challenge: string }} GameLaunchGrantArgs */
/** @typedef {(args: GameLaunchGrantArgs) => Promise<{ grant: string, expiresAt: string }>} IssueGameLaunchGrant */
/**
 * @param {import('./common.mjs').Register} register
 * @param {{url:string,origin:string}} game
 * @param {IssueGameLaunchGrant} issueGrant
 */
export function registerGameLauncherTools(register, game, issueGrant) {
  register(
    'open_game_launcher',
    'Open ODDBOUT game launcher',
    'Show the ODDBOUT game launcher. The game starts only after the user selects Start. The launcher checks game sign-in and readiness separately.',
    {},
    async () => ({ ok: true, game: 'ODDBOUT', launchMode: 'embedded-iframe', note: 'Launcher is ready. No game session or rendering has been verified.' }),
    { openWorld: false, uiResourceUri: GAME_LAUNCHER_UI },
  );
  register(
    'issue_game_launch_grant',
    'Confirm ODDBOUT game sign-in',
    'Issue a short-lived, one-use grant for the active ODDBOUT game launch after the game presents its challenge.',
    {
      nonce: z.string().regex(/^[0-9a-f]{32}$/),
      attemptId: UUID_ARG(),
      challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    },
    async args => {
      const { grant, expiresAt } = await issueGrant(args);
      return {
        ok: true,
        attemptId: args.attemptId,
        _uiMeta: { gameLaunchGrant: grant, gameLaunchGrantExpiresAt: expiresAt, attemptId: args.attemptId, nonce: args.nonce, challenge: args.challenge },
      };
    },
    { write: true, idempotent: false, openWorld: false, uiVisibility: ['app'] },
  );
}
