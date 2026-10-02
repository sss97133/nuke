#!/usr/bin/env node
/**
 * jev-route — print the model Jev picks for a task.
 *   dotenvx run -- node scripts/jev-route.mjs "<task title>" ["<description>"]
 * Prints one JSON line: {model, runner, confidence, source, reason}.
 * A lead session runs this before spawning an agent and passes `model` to it.
 */
import { routeTask } from './lib/jev-route.mjs';

const [title, description] = process.argv.slice(2);
if (!title) {
  console.error('usage: jev-route.mjs "<task title>" ["<description>"]');
  process.exit(2);
}
console.log(JSON.stringify(await routeTask({ title, description })));
