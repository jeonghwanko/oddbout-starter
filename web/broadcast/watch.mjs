import {programSlot} from './program.mjs';
import {mountExternal} from './external-player.mjs';
const $=id=>document.getElementById(id);
const show=new URLSearchParams(location.search).get('show');
const arenaOrigin='https://oddbout-broadcast-arena.onrender.com';
let manifest,clockOffset=0,current='',timer,arenaReadyTimer,spoken=false,waitingForResult=false,disposeExternal=()=>{};
const names={kuma:'Kuma',yume:'Yume',bravow:'Bravow',beotim:'Beotim',quickcat:'Quickcat',kungjjak:'Kungjjak',sikeundung:'Sikeundung',duldul:'Duldul',eoridung:'Eoridung'};
function nowSeconds(){return(Date.now()+clockOffset-Date.parse(manifest.startedAt))/1000;}
function clear(){ clearTimeout(arenaReadyTimer);$('open-player').hidden=true;$('open-player').removeAttribute('href');$('video').pause();disposeExternal();$('arena').removeAttribute('src');$('arena').hidden=true;$('sponsor').hidden=true;$('play').hidden=true;globalThis.speechSynthesis?.cancel(); }
function offerPlayer(){if($('arena').hidden)return;$('open-player').hidden=false;$('playback-error').textContent='Player not responding. Open this bout in a new tab.';}
function tick(){
  if(!manifest)return;
  const elapsed=nowSeconds(),stopped=manifest.execution?.stoppedAt&&Date.parse(manifest.execution.stoppedAt)<Date.parse(manifest.startedAt)+manifest.durationSeconds*1000;
  const slot=stopped?{kind:'ended',id:'ended'}:programSlot(elapsed,manifest.durationSeconds),bounded=Math.max(0,Math.min(manifest.durationSeconds,Math.floor(elapsed)));
  const produced=manifest.execution?.cups?.flatMap(cup=>cup.bouts.map((bout,i)=>({...bout,id:cup.id+'-'+i})))??[];
  $('clock').textContent=`${String(Math.floor(bounded/60)).padStart(2,'0')}:${String(bounded%60).padStart(2,'0')} / ${manifest.durationSeconds/60}:00`;
  if(slot.id!==current||(waitingForResult&&produced.length)){
    waitingForResult=false;
    current=slot.id;clear();$('playback-error').textContent='';spoken=false;
    if(slot.kind==='ended'){$('status').textContent=stopped?'The host ended this broadcast.':'This broadcast’s scheduled time has ended.';$('player').hidden=true;return;}
    if(slot.kind==='waiting'){$('status').textContent='This broadcast has not started yet.';return;}
    $('player').hidden=false;
    if(slot.kind==='advertisement'){
      $('status').textContent='Sponsor break · your host’s introduction';$('sponsor').hidden=false;
      $('intro').textContent=manifest.media.aiIntro;$('video').hidden=Boolean(manifest.media.source);
      $('sponsor-link').href=manifest.media.targetUrl;$('sponsor-link').textContent='Visit '+new URL(manifest.media.targetUrl).hostname+' ↗';
      if(manifest.media.source){disposeExternal=mountExternal($('external-video'),manifest.media.source,{autoplay:true});$('play').textContent='Hear introduction';$('play').hidden=false;}
      else{$('video').src=manifest.media.videoUrl;$('play').textContent='Play broadcast with sound';$('video').play().catch(()=>{$('play').hidden=false;});}
    }else{
      if(manifest.execution&&!produced.length){$('status').textContent='The On-Air Agent is preparing the first cup.';waitingForResult=true;return;}
      const pairs=[[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]],pair=pairs[slot.index%pairs.length];
      const replay=produced.length?produced[slot.index%produced.length]:null;
      const a=replay?.leftId??manifest.fighterIds[pair[0]],b=replay?.rightId??manifest.fighterIds[pair[1]];
      $('status').textContent=`${replay?'Agent-produced bout · Replay':'Exhibition '+(slot.index+1)} · ${names[a]??a} vs ${names[b]??b}`;
      const url=new URL('/spotlight.html',arenaOrigin);url.search=new URLSearchParams({id:replay?.id??manifest.id+'-'+slot.index,a,b,seed:String(replay?.seed??((manifest.programSeed+slot.index)>>>0))}).toString();
      $('open-player').href=url.href;$('arena').src=url.href;$('arena').hidden=false;arenaReadyTimer=setTimeout(offerPlayer,20000);
    }
  }
  if(slot.kind==='advertisement'&&!manifest.media.source&&Number.isFinite($('video').duration)&&$('video').duration>0){
    const target=slot.offset%$('video').duration;if(Math.abs($('video').currentTime-target)>3)$('video').currentTime=target;
  }
}
$('play').addEventListener('click',async()=>{try{if(!manifest.media.source)await $('video').play();$('play').hidden=true;if(!spoken&&globalThis.speechSynthesis){const utterance=new SpeechSynthesisUtterance(manifest.media.aiIntro);utterance.lang='en-US';speechSynthesis.speak(utterance);spoken=true;}}catch{$('playback-error').textContent='Playback could not start. Try the video’s play control.';}});
$('video').addEventListener('error',()=>{$('playback-error').textContent='Sponsor video could not play. Refresh to get a new playback link.';});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
window.addEventListener('message',event=>{
  if(event.origin!==arenaOrigin||event.source!==$('arena').contentWindow||!event.data)return;
  if(event.data.type==='oddbout:spotlight:error'){clearTimeout(arenaReadyTimer);offerPlayer();}
  if(event.data.type==='oddbout:spotlight:ready'){clearTimeout(arenaReadyTimer);$('open-player').hidden=true;$('playback-error').textContent='';}
});
async function load(){
  if(!/^[a-f0-9]{64}$/.test(show??''))throw new Error('This broadcast link is invalid.');
  const response=await fetch('/campaigns/watch/'+show,{signal:AbortSignal.timeout(55000)}),body=await response.json();
  if(!response.ok||!body.ok)throw new Error('This broadcast is unavailable. Try again shortly.');
  manifest=body.data;clockOffset=Date.parse(manifest.serverNow)-Date.now();
  if(!Number.isFinite(clockOffset)||![3600,7200,10800].includes(manifest.durationSeconds)||!Array.isArray(manifest.fighterIds)||manifest.fighterIds.length!==4||!manifest.fighterIds.every(id=>Object.hasOwn(names,id)))throw new Error('The broadcast program could not be verified.');
  $('title').textContent=manifest.productName;$('lineup').replaceChildren(...manifest.fighterIds.map(id=>{const item=document.createElement('span'),img=document.createElement('img'),name=document.createElement('span');item.className='watch-fighter';img.src='/broadcast/assets/'+id+'.webp';img.alt='';img.width=40;img.height=40;name.textContent=names[id];item.append(img,name);return item;}));
  tick();clearInterval(timer);timer=setInterval(tick,1000);
}
load().catch(error=>{$('status').textContent=error.message;});
setInterval(()=>{if(manifest?.execution&&!document.hidden)load().catch(()=>{$('playback-error').textContent='Updates are unavailable. Showing the last verified program.';});},15000);
