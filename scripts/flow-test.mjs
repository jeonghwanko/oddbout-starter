#!/usr/bin/env node
// @ts-check
// npm run flow:test — dummy creation flow. Never contacts production.
import { formatReport, runFlows } from '../tools/flow/run.mjs';

const scenarioFlag = process.argv.indexOf('--scenario');
const scenario = scenarioFlag === -1 ? undefined : process.argv[scenarioFlag + 1];
if (scenarioFlag !== -1 && !scenario) {
  console.error('Usage: npm run flow:test -- [--scenario <id>]');
  process.exitCode = 2;
} else {
  runFlows({ scenario }).then(
    result => {
      console.log(formatReport(result));
      if (!result.ok) process.exitCode = 1;
    },
    error => {
      const code = error instanceof Error ? error.message : String(error);
      console.log(JSON.stringify({ ok: false, mode: 'dummy', production: false, code }));
      process.exitCode = 1;
    },
  );
}
