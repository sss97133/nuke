// Private operator projection. No HTTP listener, database client or production route.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeStudy } from '../src/pages/stacks/bidMeasurements.ts';
import { createBidQuery } from '../src/pages/stacks/bidQuery.ts';
import { expressionFromParams } from '../src/pages/stacks/bidExpression.ts';

export async function loadPopulationQuery(file) {
  const bytes = await fs.readFile(file), receipt = JSON.parse(await fs.readFile(`${file}.receipt.json`,'utf8'));
  const snapshot = createHash('sha256').update(bytes).digest('hex');
  if (receipt.contract !== 'public-bid-population-capture-v1' || receipt.complete !== true || receipt.phase !== 'complete'
    || receipt.outputHash !== snapshot || receipt.outputBytes !== bytes.length) throw new Error('Analytical queries require a complete, hash-verified population artifact.');
  const dataset = decodeStudy(JSON.parse(bytes));
  if (dataset.capped || dataset.candidateN !== receipt.selectedEpisodes || dataset.lots.length !== receipt.usableEpisodes
    || dataset.exclusions.length !== receipt.excludedEpisodes || dataset.lots.length + dataset.exclusions.length !== dataset.candidateN
    || dataset.readAt !== receipt.completedAt) throw new Error('Population receipt and analytical artifact disagree.');
  const query = createBidQuery(dataset,snapshot);
  const coverage = { scope:receipt.scope, startedAt:receipt.startedAt, completedAt:receipt.completedAt,
    selectedEpisodes:receipt.selectedEpisodes, selectedVehicles:receipt.selectedVehicles, readBidRows:receipt.readBidRows,
    usableEpisodes:receipt.usableEpisodes, excludedEpisodes:receipt.excludedEpisodes, exclusionReasons:receipt.exclusionReasons,
    inputHash:receipt.inputHash, foldHash:receipt.foldHash, outputHash:snapshot,
    sourceFreshness:receipt.sourceFreshness, marketDenominator:receipt.marketDenominator,
    eligibility:'captured public eligibility; current eligibility requires revalidation before release' };
  return {
    groups:(...args) => ({ ...query.groups(...args), coverage }),
    contributors:(...args) => ({ ...query.contributors(...args), coverage }),
    references:(...args) => ({ ...query.references(...args), coverage }),
  };
}

export async function analyzePopulation(args) {
  const prefixes = ['--input=','--expression=','--size=','--cursor=','--group=','--group-json='];
  if (args.some(a => !['--analyze','--reference'].includes(a) && !prefixes.some(p => a.startsWith(p)))) throw new Error('Unknown analytical option.');
  for (const prefix of prefixes) if (args.filter(a => a.startsWith(prefix)).length > 1) throw new Error('Duplicate analytical option.');
  const value = name => args.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
  const input = value('--input');
  if (!input) throw new Error('Analysis requires an explicit private --input population artifact.');
  const params = new URLSearchParams(value('--expression') ?? '');
  const allowed = ['by','measure','from','to','make','model','vehicleYear','weight','paired','excludeVehicle'];
  for (const name of params.keys()) if (!allowed.includes(name) || params.getAll(name).length !== 1) throw new Error('Unknown or duplicate expression parameter.');
  if (params.has('paired') && params.get('paired') !== 'entry-outcome') throw new Error('Unknown paired population.');
  const expression = expressionFromParams(params), scope = { paired:expression.grouping === 'participant' && params.get('paired') === 'entry-outcome', excludeVehicle:params.get('excludeVehicle') };
  const options = { size:value('--size') === undefined ? undefined : Number(value('--size')),
    cursor:value('--cursor') === undefined ? undefined : JSON.parse(value('--cursor')) };
  const rawGroup = value('--group'), encodedGroup = value('--group-json');
  if (rawGroup !== undefined && encodedGroup !== undefined) throw new Error('Choose one group selector.');
  const group = encodedGroup === undefined ? rawGroup : JSON.parse(encodedGroup);
  if (group !== undefined && typeof group !== 'string') throw new Error('The JSON group selector must be a string.');
  if (args.includes('--reference') && group !== undefined) throw new Error('Reference and contributor inspection are separate cursor kinds.');
  const query = await loadPopulationQuery(input);
  if (args.includes('--reference')) {
    return query.references(expression,options,scope);
  }
  return group === undefined ? query.groups(expression,options,scope) : query.contributors(expression,group,options,scope);
}
