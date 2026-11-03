-- Isolated Sandbox only. Add linked media without altering existing MP4 records or purchase semantics.
create function public.commerce_campaign_link(p_owner text,p_order_id uuid,p_request_key uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o commerce.campaign_orders%rowtype;m commerce.campaign_media%rowtype;s jsonb;v_url text;
begin
  if p_owner is null or length(p_owner) not between 1 and 128 then raise exception 'commerce:owner-required'; end if;
  if p_request_key is null or jsonb_typeof(p_input) is distinct from 'object'
    or (p_input-'source'-'targetUrl'-'aiIntro'-'verification')<>'{}'::jsonb
    or length(coalesce(p_input->>'aiIntro','')) not between 1 and 1000
    or coalesce(p_input->>'targetUrl','') not like 'https://%'
    or p_input->>'verification' is distinct from 'link-format-only' then raise exception 'commerce:invalid-input'; end if;
  s:=p_input->'source';
  if jsonb_typeof(s) is distinct from 'object' or (s-'kind'-'id'-'url')<>'{}'::jsonb then raise exception 'commerce:invalid-input'; end if;
  if s->>'kind'='youtube' and s->>'id' ~ '^[A-Za-z0-9_-]{11}$' then v_url:='https://www.youtube.com/watch?v='||(s->>'id');
  elsif s->>'kind'='twitch-video' and s->>'id' ~ '^[0-9]{1,20}$' then v_url:='https://www.twitch.tv/videos/'||(s->>'id');
  elsif s->>'kind'='twitch-clip' and s->>'id' ~ '^[A-Za-z0-9_-]{5,100}$' then v_url:='https://clips.twitch.tv/'||(s->>'id');
  elsif s->>'kind'='twitch-live' and s->>'id' ~ '^[a-z0-9_]{3,25}$' then v_url:='https://www.twitch.tv/'||(s->>'id');
  else raise exception 'commerce:invalid-input'; end if;
  if s->>'url' is distinct from v_url then raise exception 'commerce:invalid-input'; end if;
  perform id from commerce.mutex where id=true for update;
  select * into o from commerce.campaign_orders where owner=p_owner and id=p_order_id;
  if not found then raise exception 'commerce:not-found'; end if;
  select * into m from commerce.campaign_media where order_id=o.id and request_key=p_request_key;
  if found then
    if m.input<>(p_input||jsonb_build_object('requestKey',p_request_key)) then raise exception 'commerce:idempotency-conflict'; end if;
    return commerce.campaign_snapshot(o);
  end if;
  if o.started_at is not null then raise exception 'commerce:campaign-already-started'; end if;
  insert into commerce.campaign_media(order_id,request_key,input)
    values(o.id,p_request_key,p_input||jsonb_build_object('requestKey',p_request_key)) returning * into m;
  update commerce.campaign_orders set media_id=m.id,status='ready' where id=o.id returning * into o;
  insert into commerce.campaign_events(order_id,kind,detail) values(o.id,'media_saved',jsonb_build_object('mediaId',m.id,'provider',s->>'kind'));
  return commerce.campaign_snapshot(o);
end;
$$;
revoke all on function public.commerce_campaign_link(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_campaign_link(text,uuid,uuid,jsonb) to service_role;
