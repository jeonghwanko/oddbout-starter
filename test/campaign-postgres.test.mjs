import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createCommerceStore } from '../api/commerce/store.mjs';
import { createCampaignService } from '../api/commerce/campaigns.mjs';
import { OWNER, OTHER } from './helpers/paid-operations.mjs';

// Real separate backend connections exercise the same mutex, wallet and immutable campaign intent.
test(
  'native PostgreSQL races same-key and competing campaign purchases without reroll, double debit or overspend',
  { skip: !process.env.ODDBOUT_TEST_POSTGRES_BIN, timeout: 120000 },
  async t => {
    const bin = process.env.ODDBOUT_TEST_POSTGRES_BIN;
    const run = (name, args, input = '') =>
      new Promise((done, reject) => {
        const child = spawn(join(bin, name + (process.platform === 'win32' ? '.exe' : '')), args, {
          windowsHide: true,
          stdio: name === 'pg_ctl' ? 'ignore' : ['pipe', 'pipe', 'pipe'],
        });
        let out = '',
          err = '';
        child.stdout?.on('data', value => (out += value));
        child.stderr?.on('data', value => (err += value));
        child.on('error', reject);
        child.on('close', code => (code === 0 ? done(out) : reject(new Error(`${name}(${code}): ${err}`))));
        child.stdin?.end(input);
      });
    await mkdir(resolve('output/campaign-tests'), { recursive: true });
    const directory = await mkdtemp(resolve('output/campaign-tests/postgres-'));
    const probe = createServer();
    await new Promise(done => probe.listen(0, '127.0.0.1', done));
    const port = probe.address().port;
    await new Promise(done => probe.close(done));
    await run('initdb', ['-D', directory, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8']);
    await run('pg_ctl', ['-D', directory, '-l', join(directory, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -F`, '-w', 'start']);
    t.after(() => run('pg_ctl', ['-D', directory, '-m', 'fast', '-w', 'stop']));
    const sql = statement =>
      run('psql', ['-X', '-qAt', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], statement);
    await sql('create role anon;create role authenticated;create role service_role bypassrls;');
    for (const file of ['20261102115107_commerce_broadcast_ledger.sql', '20261103154930_commerce_campaigns.sql'])
      await sql(await readFile(new URL('../supabase/sandbox/' + file, import.meta.url), 'utf8'));
    const literal = value => (value === null ? 'null' : "'" + String(value).replaceAll("'", "''") + "'");
    const db = {
      rpc: async (name, args) => {
        assert.ok(['commerce_command', 'commerce_campaign'].includes(name));
        try {
          const value = (
            await sql(
              `set role service_role;select public.${name}(${literal(args.p_owner)},${literal(args.p_command)},${literal(JSON.stringify(args.p_input))}::jsonb);`,
            )
          ).trim();
          return { data: value ? JSON.parse(value) : null, error: null };
        } catch (error) {
          // psql adds its own ERROR/context wrapper; PostgREST returns the original PostgreSQL message.
          return { data: null, error: { message: error.message.match(/commerce:[a-z_-]+/)?.[0] ?? error.message } };
        }
      },
    };
    const store = createCommerceStore(db),
      service = createCampaignService({ db });
    const topup = await store.createTopup(OWNER, { requestKey: randomUUID(), amountCents: 1000, credits: 900, currency: 'USD' });
    await store.attachOrder(OWNER, topup.id, 'RACEFUNDS');
    await store.creditCapture(OWNER, topup.id, {
      providerOrderId: 'RACEFUNDS',
      captureId: 'RACECAPTURE',
      amountCents: 1000,
      currency: 'USD',
      status: 'COMPLETED',
    });
    const input = { requestKey: randomUUID(), productId: 'spotlight-hour' };
    const same = await Promise.all(Array.from({ length: 16 }, () => service.purchase(OWNER, input)));
    assert.equal(new Set(same.map(order => order.id)).size, 1);
    assert.equal(new Set(same.map(order => JSON.stringify(order.fighterIds))).size, 1);
    assert.equal(new Set(same[0].fighterIds).size, 4);
    assert.equal(Number((await store.wallet(OWNER)).balanceCredits), 600);
    const competing = await Promise.allSettled(
      Array.from({ length: 10 }, () => service.purchase(OWNER, { requestKey: randomUUID(), productId: 'spotlight-hour' })),
    );
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 2);
    assert.ok(competing.filter(result => result.status === 'rejected').every(result => result.reason.status === 402));
    assert.equal(Number((await store.wallet(OWNER)).balanceCredits), 0);
    assert.equal(Number((await store.wallet(OWNER)).reservedCredits), 0);
    assert.equal((await sql('select count(*) from commerce.campaign_orders;')).trim(), '3');
    assert.equal((await sql("select count(*) from commerce.ledger where kind='spend';")).trim(), '3');
    assert.equal((await sql("select sum(balance_delta) from commerce.ledger where kind='spend';")).trim(), '-900');
    assert.equal((await sql('select count(*) from commerce.jobs;')).trim(), '0');
    await assert.rejects(service.get(OTHER, same[0].id), /not-found/);
    assert.equal((await service.purchase(OWNER, input)).id, same[0].id);
    const durationFunds = await store.createTopup(OWNER, { requestKey: randomUUID(), amountCents: 1500, credits: 1500, currency: 'USD' });
    await store.attachOrder(OWNER, durationFunds.id, 'DURATIONFUNDS');
    await store.creditCapture(OWNER, durationFunds.id, {
      providerOrderId: 'DURATIONFUNDS',
      captureId: 'DURATIONCAPTURE',
      amountCents: 1500,
      currency: 'USD',
      status: 'COMPLETED',
    });
    const inputs = ['spotlight-2h', 'spotlight-3h'].map(productId => ({ requestKey: randomUUID(), productId }));
    const durationOrders = await Promise.all(inputs.map(item => service.purchase(OWNER, item)));
    assert.deepEqual(
      durationOrders.map(order => [order.priceCredits, order.durationSeconds, order.adSeconds, order.adSlots.length]),
      [
        [600, 7200, 1200, 4],
        [900, 10800, 1800, 6],
      ],
    );
    assert.deepEqual((await service.purchase(OWNER, inputs[0])).fighterIds, durationOrders[0].fighterIds);
    await assert.rejects(service.purchase(OWNER, { ...inputs[0], productId: 'spotlight-hour' }), /idempotency-conflict/);
    assert.equal(Number((await store.wallet(OWNER)).balanceCredits), 0);
    assert.equal((await sql("select sum(balance_delta) from commerce.ledger where kind='spend';")).trim(), '-2400');
  },
);
