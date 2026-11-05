#!/usr/bin/env node
// @ts-check
// `npx -y oddbout@latest connect`: see ../lib/connect.mjs and ../README.md.
import { main } from '../lib/connect.mjs';

process.exitCode = await main(process.argv.slice(2));
