#!/usr/bin/env node
/**
 * jev-route — print the model Jev picks for a task.
 *   dotenvx run -- node scripts/jev-route.mjs "<task title>" ["<description>"] --public-work-order
 * Prints a routing receipt. Only status=ready may be dispatched.
 * A lead assigns the structural role and verifies the complete work order.
 * Exit 3 means needs_review; an uncertain route is not an executable fallback.
 */
import { routeTask } from './lib/jev-route.mjs';

const args = process.argv.slice(2);
const publicWorkOrder = args.includes('--public-work-order');
const [title, description] = args.filter(value => value !== '--public-work-order');
if (!title) {
  console.error('usage: jev-route.mjs "<task title>" ["<description>"]');
  process.exit(2);
}
const result = await routeTask({ title, description, publicWorkOrder });
console.log(JSON.stringify(result));
if (result.status !== 'ready') process.exitCode = 3;
