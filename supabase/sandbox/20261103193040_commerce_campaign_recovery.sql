-- Isolated Sandbox only. Avoid shadowing the PL/pgSQL broadcast row variable in recovery discovery.
do $migration$
declare definition text:=pg_get_functiondef('public.commerce_campaign_execution(text,text,jsonb)'::regprocedure);
  original text:=$source$jsonb_build_object('id',b.id,'owner',b.owner,'orderId',b.campaign_order_id))
      from commerce.broadcasts b where b.campaign_order_id is not null and b.status<>'completed'$source$;
  replacement text:=$source$jsonb_build_object('id',s.id,'owner',s.owner,'orderId',s.campaign_order_id))
      from commerce.broadcasts s where s.campaign_order_id is not null and s.status<>'completed'$source$;
begin
  definition:=replace(definition,chr(13),'');
  if position(original in definition)=0 then raise exception 'Unexpected campaign recovery function; review current definition'; end if;
  execute replace(definition,original,replacement);
end;
$migration$;
