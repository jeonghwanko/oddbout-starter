// @ts-check
// ChatGPT Apps SDK component for starting the existing ODDBOUT game in an iframe.
import { gameArt } from './game-card-art.mjs';
import { recommendationSchema, recommendGames } from './recommend-games.mjs';
import { webGames } from './web-game-catalog.mjs';
import { z } from 'zod';
import { UUID_ARG } from './common.mjs';

export const GAME_LAUNCHER_UI = 'ui://oddbout/game-launcher-v4.html';
const RECOMMENDATIONS_UI = 'ui://oddbout/game-recommendations-v2.html';
const arcadeGames = webGames.filter(game => game.studio === 'ODDBOUT');
const logoUrl = 'https://broadcast.oddbout.com/broadcast/assets/oddbout-logo.webp';
const imageOrigins = [...new Set([logoUrl, ...Object.values(gameArt)].map(url => new URL(url).origin))];
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

/** @param {string | undefined} gameOrigin */
export function gameLauncherMetadata(gameOrigin) {
  const frameDomains = [...new Set([...(gameOrigin ? [gameOrigin] : []), ...arcadeGames.map(game => new URL(game.url).origin)])];
  return {
    ui: {
      domain: widgetDomain,
      prefersBorder: false,
      csp: { connectDomains: [], resourceDomains: imageOrigins, frameDomains },
    },
    'openai/widgetDomain': widgetDomain,
    'openai/widgetCSP': { connect_domains: [], resource_domains: imageOrigins, frame_domains: frameDomains },
    'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'] },
    'openai/widgetDescription': 'Choose Pudding Escape, Legendary Forge or Bounce Ball and play inside the launcher.',
  };
}

/** @param {string} value */
function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** @param {(typeof webGames)[number]} game */
function gameCard(game) {
  const owned = game.studio === 'ODDBOUT';
  const source = owned
    ? 'ODDBOUT 오리지널'
    : 'Poki 평가 ' + new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(game.votes) + '건';
  const title = escapeHtml(game.title);
  const play = owned
    ? `<button id="${game.id}" class="cta" aria-label="${title} 여기서 플레이">여기서 플레이 ▶</button>`
    : `<a class="cta" href="${escapeHtml(game.url)}" target="_blank" rel="noopener noreferrer" aria-label="${title} Poki에서 플레이">Poki에서 플레이 ↗</a>`;
  return `<article><img class="art" alt="" src="${escapeHtml(gameArt[game.id])}"><div class="copy">
    <small>${escapeHtml(source)}</small><h2>${title}</h2><p>${escapeHtml(game.description)}</p>${play}</div></article>`;
}

/** @param {{url: string, origin: string} | null} game */
export function gameLauncherHtmlFor(game, recommendations = false) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>ODDBOUT · Game Launcher</title>
<style>
:root{color-scheme:dark;font:15px/1.5 system-ui,sans-serif;color:#faf8ff;background:#141323}*{box-sizing:border-box}[hidden]{display:none!important}
body{margin:0;background:radial-gradient(ellipse at top right,#30223f,transparent 65%)}main{max-width:960px;margin:auto;padding:14px}
header{display:flex;align-items:center;gap:12px;margin:0 0 14px}header img{width:152px;height:34px;object-fit:contain}
header span{color:#dac4ff;background:#392c4c;padding:3px 7px;border-radius:5px;font:700 11px/1.3 monospace;letter-spacing:.15em}
#arcade{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
article{--tint:#38304d;isolation:isolate;position:relative;overflow:hidden;display:flex;align-items:flex-end;min-height:165px;border-radius:16px;background:var(--tint)}
article:first-child{--tint:#282248;grid-column:1/-1;min-height:clamp(225px,37vw,315px)}
article:nth-child(2){--tint:#194440}article:only-of-type,article:nth-child(2):last-child{grid-column:1/-1}
.art{position:absolute;z-index:-2;right:0;top:0;width:64%;height:100%;object-fit:cover}
article:before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(90deg,var(--tint) 33%,transparent 85%),linear-gradient(0deg,#10102180,transparent 65%)}
.copy{padding:18px;width:75%;word-break:keep-all}.copy small{font-size:12px;color:#e1d9ec}
.copy h2{margin:5px 0;font:900 26px/1.04 Arial,sans-serif;letter-spacing:-.04em;overflow-wrap:anywhere}
article:first-child .copy{width:60%;padding:clamp(19px,4vw,36px)}
article:first-child h2{font:1000 italic clamp(36px,7vw,68px)/.93 "Arial Black",Arial,sans-serif;text-transform:uppercase;letter-spacing:-.06em}
.copy p{margin:8px 0 12px;font-size:14px}.cta,button{cursor:pointer;border:0;border-radius:20px;font:700 13px/1.5 system-ui,sans-serif;padding:9px 16px}
.cta{display:inline-block;background:white;color:#171620;text-decoration:none}.cta:after{content:"";position:absolute;inset:0}article:first-child .cta{background:#caff63}
article:focus-within{outline:3px solid #fff;outline-offset:2px}.cta:hover{background:#e8ffc2}
.controls{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.secondary{background:#302c40;color:white}#message{color:#cec7da;font-size:12px}
#stage{display:none}iframe{width:100%;height:min(74dvh,800px);min-height:300px;border:0;border-radius:12px}
@media(max-width:580px){main{padding:10px}.copy p{font-size:13px}article:first-child .copy{width:72%}article:not(:first-child){flex-direction:column;align-items:stretch}article:not(:first-child) .art{position:static;width:100%;height:105px;z-index:0}article:not(:first-child) .copy{width:100%;padding:12px;flex:1;display:flex;align-items:flex-start;flex-direction:column}article:not(:first-child) .cta{margin-top:auto}.copy h2{font-size:21px}}
</style></head><body><main>
<header><img src="${logoUrl}" alt="ODDBOUT"><span>ARCADE</span></header>
<div id="arcade">${recommendations ? '' : arcadeGames.map(gameCard).join('')}</div>
${recommendations ? webGames.map(game => `<template id="card-${game.id}">${gameCard(game)}</template>`).join('') : ''}
<div class="controls"><button id="start" class="secondary"${game ? '' : ' hidden'}>ODDBOUT 연습 경기</button><button id="reload" class="secondary" hidden>다시 시작</button>
<button id="full" class="secondary" hidden>전체화면</button><button id="back" class="secondary" hidden>런처로 돌아가기</button></div>
<p id="message" role="status" aria-live="polite">게임을 시작하면 ODDBOUT 로그인을 확인합니다.</p>
<section id="stage"></section></main>
<script>
(function(){'use strict';
const GAME_URL=${JSON.stringify(game?.url ?? null)}, GAME_ORIGIN=${JSON.stringify(game?.origin ?? null)}, CHANNEL='oddbout-launcher-v2';
const stage=document.getElementById('stage'), start=document.getElementById('start'), reload=document.getElementById('reload');
const back=document.getElementById('back'), full=document.getElementById('full'), message=document.getElementById('message');
let state='idle', frame=null, nonce=null, attemptId=null, watchdog=null, helloTimer=null, helloCount=0, grantRequestGeneration=0, hostModes=null, gameReady=false, gameAuthenticated=false;
const arcade=document.getElementById('arcade');
function openArcade(game){
  stop();
  arcade.hidden=true;start.hidden=true;back.hidden=false;
  const player=document.createElement('iframe');
  player.title=game.title;player.allow='fullscreen; gamepad';player.referrerPolicy='no-referrer';
  player.src=game.url;stage.append(player);stage.style.display='block';
  note(game.title,game.title);requestFullscreen(false);
}
for(const game of ${JSON.stringify(recommendations ? [] : arcadeGames)}){
  document.getElementById(game.id).addEventListener('click',()=>openArcade(game));
}
${recommendations ? recommendationClient() : ''}
function localizeControls(){const locale=(window.openai?.locale||document.documentElement.lang||'ko').toLowerCase(),english=locale.startsWith('en');
  start.textContent=english?'ODDBOUT practice':'ODDBOUT 연습 경기';reload.textContent=english?'Restart':'다시 시작';
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
function stop(){grantRequestGeneration++;resetTimer();resetHello();removeFrame();state='idle';nonce=null;attemptId=null;gameReady=false;gameAuthenticated=false;arcade.hidden=false;start.hidden=!GAME_URL;reload.hidden=true;back.hidden=true;
  note('The game was closed. Choose a game to play.','게임을 닫았습니다. 플레이할 게임을 선택하세요.')}
function updateModes(modes){
  if(Array.isArray(modes))hostModes=new Set(modes);
  full.hidden=!hostModes?.has('fullscreen')||typeof window.openai?.requestDisplayMode!=='function';
}
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
  const thisAttempt=attemptId;state='loading';arcade.hidden=true;start.hidden=true;reload.hidden=false;back.hidden=false;stage.style.display='block';
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
      if(state==='authenticated')resetTimer();
      if(firstReady&&state==='ready'&&!gameAuthenticated)armWatchdog(attemptId,'ready',['Sign-in was not confirmed. Try starting again.','로그인을 확인하지 못했습니다. 다시 시작해 주세요.']);
      reportGameStatus();
    }else if(data.type==='game:authenticated'&&['grant-sent','ready','authenticated'].includes(state)){
      resetTimer();gameAuthenticated=true;state='authenticated';
      if(!gameReady)armWatchdog(attemptId,'authenticated',['The game did not finish loading. Try starting again.','게임 로딩이 끝나지 않았습니다. 다시 시작해 주세요.']);
      reportGameStatus();
    }else if(data.type==='game:error'&&typeof data.code==='string'){
      // The game's codes (ChatGptGame.fail/fatal). Only boot-failed is final; the game recovers the others itself.
      if(data.code==='boot-failed'){
        grantRequestGeneration++;resetTimer();removeFrame();state='unverified';gameReady=false;gameAuthenticated=false;arcade.hidden=false;start.hidden=true;reload.hidden=false;back.hidden=true;
        note('The game could not start. Select Restart to try again.','게임을 시작하지 못했습니다. 다시 시작을 눌러 다시 시도해 주세요.');return}
      if(data.code==='auth-required'){
        // Expiry or a rejected credential: the game asks again with game:auth-required when the user selects Connect in it.
        resetTimer();gameAuthenticated=false;state=gameReady?'ready':'handshake';
        note('The ODDBOUT sign-in ended. Select Connect in the game to continue.','ODDBOUT 로그인이 끝났습니다. 게임에서 연결을 눌러 계속하세요.');return}
      if(gameAuthenticated&&data.code==='request-failed'){
        note('A game request did not finish. Check the game’s records, or restart if it does not continue.','게임 요청이 끝나지 않았습니다. 게임의 기록을 확인하고, 이어지지 않으면 다시 시작해 주세요.');return}
      if(gameAuthenticated&&data.code==='incompatible-match'){
        note('That match does not fit this game version. Check the game’s records, or restart to update.','이 경기는 현재 게임 버전과 맞지 않습니다. 게임의 기록을 확인하거나 다시 시작해 주세요.');return}
      const errors={
        'request-failed':['The game could not finish signing in. Try starting again.','게임 로그인을 마치지 못했습니다. 다시 시작해 주세요.'],
        'incompatible-match':['This game version does not match the server. Restart the game.','게임 버전이 서버와 맞지 않습니다. 게임을 다시 시작해 주세요.'],
        'invalid-grant':['The game sign-in expired. Start again.','게임 로그인 정보가 만료됐습니다. 다시 시작해 주세요.'],
        'sign-in-required':['Sign in to ODDBOUT in the game.','게임에서 ODDBOUT에 로그인해 주세요.'],
        'launch-failed':['The game could not start. Try again.','게임을 시작하지 못했습니다. 다시 시도해 주세요.']};
      failAttempt(errors[data.code]||['The game reported a problem. Try again.','게임에서 문제가 발생했습니다. 다시 시도해 주세요.']);
    }else if(data.type==='game:close'){stop()}
    return;
  }
  // This message listener handles only the ChatGPT Apps SDK host bridge; it never handles game messages.
  if(event.source!==parent||event.data?.jsonrpc!=='2.0')return;
  ${recommendations ? "if(event.data.method==='ui/notifications/tool-result')renderPicks(event.data.params?.structuredContent);" : ''}
  if(event.data.method==='ui/notifications/host-context-changed'){
    updateModes(event.data.params?.availableDisplayModes);
  }
  if(event.data.id===1&&event.data.result){
    updateModes(event.data.result.hostContext?.availableDisplayModes);
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
say('Choose a game to play.','플레이할 게임을 선택하세요.');
${recommendations ? 'renderPicks(window.openai?.toolOutput);' : ''}
})();
</script></body></html>`;
}

// The widget resolves IDs against the reviewed catalog, never a URL supplied in a tool result.
function recommendationClient() {
  return `
const catalog=new Map(${JSON.stringify(webGames)}.map(g=>[g.id,g]));
function renderPicks(result){
  if(result?.kind!=='web-game-recommendations'||!Array.isArray(result.games))return;
  const rows=[];
  for(const pick of result.games.slice(0,3)){
    const game=catalog.get(pick.id);if(!game)continue;
    const row=document.getElementById('card-'+game.id).content.firstElementChild.cloneNode(true);
    if(game.studio==='ODDBOUT')row.querySelector('button').addEventListener('click',()=>openArcade(game));
    else row.querySelector('a').addEventListener('click',event=>{
      if(typeof window.openai?.openExternal==='function'){event.preventDefault();window.openai.openExternal({href:game.url})}
    });
    rows.push(row);
  }
  arcade.replaceChildren(...rows);
  if(!rows.length)note('No verified match. Try relaxing a condition.','모든 조건을 확인한 게임이 없습니다. 바꿔도 되는 조건을 알려주세요.');
}
window.addEventListener('openai:set_globals',()=>renderPicks(window.openai?.toolOutput));
`;
}

/** @param {import('@modelcontextprotocol/server').McpServer} server @param {{url:string,origin:string} | null} game */
export function registerGameLauncherUi(server, game) {
  const meta = gameLauncherMetadata(undefined);
  meta['openai/widgetDescription'] = 'Choose a reviewed web game matching your preferences. ODDBOUT games open here, partner-site links open on Poki.';
  server.registerResource('oddbout-game-recommendations', RECOMMENDATIONS_UI, { mimeType, _meta: meta }, () => ({
    contents: [{ uri: RECOMMENDATIONS_UI, mimeType, text: gameLauncherHtmlFor(null, true), _meta: meta }],
  }));
  server.registerResource('oddbout-game-launcher', GAME_LAUNCHER_UI, { mimeType, _meta: gameLauncherMetadata(game?.origin) }, () => ({
    contents: [{ uri: GAME_LAUNCHER_UI, mimeType, text: gameLauncherHtmlFor(game), _meta: gameLauncherMetadata(game?.origin) }],
  }));
}

/** @typedef {{ nonce: string, attemptId: string, challenge: string }} GameLaunchGrantArgs */
/** @typedef {(args: GameLaunchGrantArgs) => Promise<{ grant: string, expiresAt: string }>} IssueGameLaunchGrant */
/**
 * @param {import('./common.mjs').Register} register
 * @param {{url:string,origin:string} | null} game
 * @param {IssueGameLaunchGrant} issueGrant
 */
export function registerGameLauncherTools(register, game, issueGrant) {
  register(
    'open_game_launcher',
    'Open ODDBOUT game launcher',
    'Open the ODDBOUT launcher to play Pudding Escape, Legendary Forge or Bounce Ball inside this conversation.',
    {},
    async () => ({ ok: true, game: 'ODDBOUT', launchMode: 'embedded-iframe', note: 'Launcher is ready. No game session or rendering has been verified.' }),
    { openWorld: false, uiResourceUri: GAME_LAUNCHER_UI },
  );
  register(
    'recommend_web_games',
    'Recommend playable web games',
    'Translate the user’s natural-language conditions into required and preferred tags. Recommend 2–3 reviewed browser games including ODDBOUT and popular Poki games. Pass unsupported hard constraints in unverifiedRequirements. Never fill a shortlist with non-matches. Expose official play links to text-only clients.',
    recommendationSchema,
    async args => recommendGames(args),
    { publicTool: true, openWorld: true, uiResourceUri: RECOMMENDATIONS_UI },
  );
  if (!game) return;
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
