#!/usr/bin/env node
// @ts-check
import { createClient } from '@supabase/supabase-js';
import { createCommerceStore } from '../api/commerce/store.mjs';
import { UUID } from '../api/http.mjs';
import { commerceFromEnvironment } from '../api/commerce/config.mjs';
import { validateOrderBinding } from '../api/commerce/paypal.mjs';

const [command, id, ...noteParts] = process.argv.slice(2);
if (!['status','inspect','retry-payment','link-order'].includes(command) || (command !== 'status' && !UUID.test(id ?? ''))) {
  throw new Error('Usage: paid-operation-admin.mjs status | inspect <operation UUID> | retry-payment <operation UUID> <review note> | link-order <operation UUID> <PayPal order ID> <review note>');
}
const {SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:key}=process.env;
if (!url || !key) throw new Error('sandbox-operator-environment-required');
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),store=createCommerceStore(db);
if (command==='status') console.log(JSON.stringify({metrics:await store.recovery(null,'metrics'),attention:await store.recovery(null,'attention')},null,2));
else {
  const operation=await store.recovery(null,'inspect',{operationId:id});
  if (command==='retry-payment') {
    const note=noteParts.join(' ').trim();if (!note || note.length>500) throw new Error('operator-review-note-required');
    await store.recovery(null,'retry',{operationId:id,note});
  } else if (command==='link-order') {
    const [orderId,...words]=noteParts,note=words.join(' ').trim();
    if(!orderId||!note||note.length>500||!/^[A-Za-z0-9_-]{1,128}$/.test(orderId))throw new Error('operator-order-and-note-required');
    const commerce=commerceFromEnvironment({db,get:name=>process.env[name]});
    if(!commerce?.paypal||!operation.payment)throw new Error('sandbox-paypal-required');
    const order=await commerce.paypal.getOrder(orderId);
    validateOrderBinding(order,{orderId,referenceId:operation.payment.intentId,amountMinor:operation.payment.amountCents,
      currency:operation.payment.currency,merchantId:commerce.merchantId});
    await store.recovery(null,'link_order',{operationId:id,providerOrderId:orderId,note});
  }
  console.log(JSON.stringify({operation,events:await store.operation(operation.owner,'events',{operationId:id})},null,2));
}
