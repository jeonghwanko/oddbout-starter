/** Fixed paid schedule. Ad time is included in (not added to) the purchased duration. */
export function programSlot(seconds,durationSeconds=3600){
  if(!Number.isFinite(seconds)||![3600,7200,10800].includes(durationSeconds))throw new Error('Invalid program time');
  if(seconds<0)return{kind:'waiting',id:'waiting'};
  if(seconds>=durationSeconds)return{kind:'ended',id:'ended'};
  const block=Math.floor(seconds/1800),offset=seconds%1800;
  if(offset<300)return{kind:'advertisement',id:`ad-${block}`,offset};
  const index=block*15+Math.floor((offset-300)/100);
  return{kind:'exhibition',id:`bout-${index}`,index};
}
