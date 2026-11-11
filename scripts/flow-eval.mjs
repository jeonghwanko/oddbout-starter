#!/usr/bin/env node
// @ts-check
// Print the dummy flow eval score. Exit 1 when any check fails. No live service.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runFlowEval } from '../tools/flow/eval.mjs';

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const score = await runFlowEval();
  console.log(JSON.stringify(score, null, 2));
  if (!score.ok) process.exitCode = 1;
}
