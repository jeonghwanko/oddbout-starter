import {programSlot} from './program.mjs';
const $=id=>document.getElementById(id);
const show=new URLSearchParams(location.search).get('show');
const arenaOrigin='https://oddbout-broadcast-arena.onrender.com';
let manifest,clockOffset=0,current='',timer,spoken=false;
const names={kuma:'Kuma',yume:'Yume',bravow:'Bravow',beotim:'Beotim',quickcat:'Quickcat',kungjjak:'Kungjjak',sikeundung:'Sikeundung',duldul:'Duldul',eoridung:'Eoridung'};
function nowSeconds(){return(Date.now()+clockOffset-Date.parse(manifest.startedAt))/1000;}
function clear(){ $('video').pause();$('arena').removeAttribute('src');$('arena').hidden=true;$('sponsor').hidden=true;$('play').hidden=true;globalThis.speechSynthesis?.cancel(); }
function tick(){
  if(!manifest)return;
  const elapsed=nowSeconds(),slot=programSlot(elapsed,manifest.durationSeconds),bounded=Math.max(0,Math.min(manifest.durationSeconds,Math.floor(elapsed)));
  $('clock').textContent=`${String(Math.floor(bounded/60)).padStart(2,'0')}:${String(bounded%60).padStart(2,'0')} / ${manifest.durationSeconds/60}:00`;
  if(slot.id!==current){
    current=slot.id;clear();$('playback-error').textContent='';spoken=false;
    if(slot.kind==='ended'){$('status').textContent='This broadcast’s scheduled time has ended.';$('player').hidden=true;return;}
    if(slot.kind==='waiting'){$('status').textContent='This broadcast has not started yet.';return;}
    $('player').hidden=false;
    if(slot.kind==='advertisement'){
      $('status').textContent='Sponsor break · your host’s introduction';$('sponsor').hidden=false;
      $('video').src=manifest.media.videoUrl;$('intro').textContent=manifest.media.aiIntro;
      $('sponsor-link').href=manifest.media.targetUrl;$('sponsor-link').textContent='Visit '+new URL(manifest.media.targetUrl).hostname+' ↗';
      $('video').play().catch(()=>{$('play').hidden=false;});
    }else{
      const pairs=[[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]],pair=pairs[slot.index%pairs.length];
      const a=manifest.fighterIds[pair[0]],b=manifest.fighterIds[pair[1]];
      $('status').textContent=`Exhibition ${slot.index+1} · ${names[a]??a} vs ${names[b]??b}`;
      const url=new URL('/spotlight.html',arenaOrigin);url.search=new URLSearchParams({id:manifest.id+'-'+slot.index,a,b,seed:String((manifest.programSeed+slot.index)>>>0)}).toString();
      $('arena').src=url.href;$('arena').hidden=false;
    }
  }
  if(slot.kind==='advertisement'&&Number.isFinite($('video').duration)&&$('video').duration>0){
    const target=slot.offset%$('video').duration;if(Math.abs($('video').currentTime-target)>3)$('video').currentTime=target;
  }
}
$('play').addEventListener('click',async()=>{try{await $('video').play();$('play').hidden=true;if(!spoken&&globalThis.speechSynthesis){const utterance=new SpeechSynthesisUtterance(manifest.media.aiIntro);utterance.lang='en-US';speechSynthesis.speak(utterance);spoken=true;}}catch{$('playback-error').textContent='Playback could not start. Try the video’s play control.';}});
$('video').addEventListener('error',()=>{$('playback-error').textContent='Sponsor video could not play. Refresh to get a new playback link.';});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
window.addEventListener('message',event=>{
  if(event.origin!==arenaOrigin||event.source!==$('arena').contentWindow||!event.data)return;
  if(event.data.type==='oddbout:spotlight:error')$('playback-error').textContent='This matchup could not play. The next scheduled matchup will still be attempted.';
  if(event.data.type==='oddbout:spotlight:ready')$('playback-error').textContent='';
});
async function load(){
  if(!/^[a-f0-9]{64}$/.test(show??''))throw new Error('This broadcast link is invalid.');
  const response=await fetch('/campaigns/watch/'+show,{signal:AbortSignal.timeout(55000)}),body=await response.json();
  if(!response.ok||!body.ok)throw new Error('This broadcast is unavailable. Try again shortly.');
  manifest=body.data;clockOffset=Date.parse(manifest.serverNow)-Date.now();
  if(!Number.isFinite(clockOffset)||![3600,7200,10800].includes(manifest.durationSeconds)||!Array.isArray(manifest.fighterIds)||manifest.fighterIds.length!==4||!manifest.fighterIds.every(id=>Object.hasOwn(names,id)))throw new Error('The broadcast program could not be verified.');
  $('title').textContent=manifest.productName;$('lineup').textContent='SS lineup · '+manifest.fighterIds.map(id=>names[id]).join(' · ');
  tick();clearInterval(timer);timer=setInterval(tick,1000);
}
load().catch(error=>{$('status').textContent=error.message;});
