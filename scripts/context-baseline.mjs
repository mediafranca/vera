#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const SCHEMA_VERSION = 1;

const asArray = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(values.filter((value) => typeof value === 'string' && value !== ''))];

export function parseArguments(argv) {
  const options = {
    manifest: '',
    baseUrl: process.env['VERA_URL'] ?? 'http://127.0.0.1:4173',
    output: '',
    allowSequenceDrift: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--manifest') options.manifest = argv[++index] ?? '';
    else if (argument === '--base-url') options.baseUrl = argv[++index] ?? '';
    else if (argument === '--output') options.output = argv[++index] ?? '';
    else if (argument === '--allow-sequence-drift') options.allowSequenceDrift = true;
    else throw new Error(`argumento desconocido: ${argument}`);
  }
  if (options.manifest === '') throw new Error('falta --manifest <archivo.json>');
  return options;
}

export function validateManifest(manifest) {
  if (manifest === null || typeof manifest !== 'object') throw new Error('el manifiesto no es un objeto');
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`schemaVersion debe ser ${SCHEMA_VERSION}`);
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    throw new Error('el manifiesto no contiene casos');
  }
  const seen = new Set();
  for (const one of manifest.cases) {
    if (typeof one.id !== 'string' || one.id.trim() === '') throw new Error('cada caso necesita id');
    if (seen.has(one.id)) throw new Error(`id de caso repetido: ${one.id}`);
    seen.add(one.id);
    if (typeof one.question !== 'string' || one.question.trim() === '') {
      throw new Error(`${one.id}: falta question`);
    }
    if (!Array.isArray(one.calls) || one.calls.length === 0) {
      throw new Error(`${one.id}: falta calls`);
    }
    for (const call of one.calls) {
      if (!['search', 'query', 'page', 'neighborhood', 'history'].includes(call.tool)) {
        throw new Error(`${one.id}: herramienta desconocida ${String(call.tool)}`);
      }
    }
  }
  return manifest;
}

const headersFor = (token) => ({
  accept: 'application/json',
  'x-vera-client': 'context-baseline',
  ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
});

async function requestJson(baseUrl, token, path, init = {}) {
  const started = performance.now();
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: { ...headersFor(token), ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text || response.statusText }; }
  return {
    ok: response.ok,
    status: response.status,
    body,
    text,
    characters: text.length,
    latencyMs: performance.now() - started,
  };
}

function identities(tool, body) {
  if (tool === 'search') {
    return unique(asArray(body).flatMap((hit) => [hit?.page, hit?.block]));
  }
  if (tool === 'query') {
    return unique([
      ...asArray(body?.pages).flatMap((page) => [page?.id]),
      ...asArray(body?.blocks).flatMap((block) => [block?.id, block?.page]),
    ]);
  }
  if (tool === 'page') {
    return unique([body?.id, ...asArray(body?.blocks).map((block) => block?.stableId)]);
  }
  if (tool === 'neighborhood') {
    // `vera_vecindario` entrega el mapa de páginas, no las aristas crudas del
    // endpoint visual. La línea base mide esa superficie efectiva.
    return unique(asArray(body?.nodes).flatMap((node) => [node?.id, node?.page]));
  }
  if (tool === 'history') return unique([body?.block]);
  return [];
}

async function executeCall(baseUrl, token, call) {
  let response;
  if (call.tool === 'search') {
    const url = new URL('/search', baseUrl);
    url.searchParams.set('q', String(call.query ?? ''));
    response = await requestJson(baseUrl, token, `${url.pathname}${url.search}`);
    if (response.ok && Number.isFinite(call.limit)) {
      response.body = asArray(response.body).slice(0, Math.max(0, Math.trunc(call.limit)));
      response.text = JSON.stringify(response.body);
      response.characters = response.text.length;
    }
  } else if (call.tool === 'query') {
    response = await requestJson(baseUrl, token, '/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: String(call.source ?? ''),
        cursor: Number(call.cursor ?? 0),
        limit: Number(call.limit ?? 30),
      }),
    });
  } else if (call.tool === 'page') {
    const url = new URL(`/pages/${encodeURIComponent(String(call.page ?? ''))}`, baseUrl);
    url.searchParams.set('stage', 'readable');
    url.searchParams.set('cursor', String(call.cursor ?? 0));
    url.searchParams.set('limit', String(call.limit ?? 80));
    response = await requestJson(baseUrl, token, `${url.pathname}${url.search}`);
  } else if (call.tool === 'neighborhood') {
    const url = new URL(`/graph/${encodeURIComponent(String(call.page ?? ''))}`, baseUrl);
    url.searchParams.set('depth', String(call.depth ?? 1));
    response = await requestJson(baseUrl, token, `${url.pathname}${url.search}`);
  } else {
    response = await requestJson(
      baseUrl,
      token,
      `/blocks/${encodeURIComponent(String(call.block ?? ''))}/history`,
    );
  }
  return {
    tool: call.tool,
    ok: response.ok,
    status: response.status,
    error: response.ok ? null : String(response.body?.error ?? response.body?.reason ?? response.text),
    identities: response.ok ? identities(call.tool, response.body) : [],
    characters: response.characters,
    latencyMs: Math.round(response.latencyMs * 100) / 100,
    text: response.text,
  };
}

export function scoreCase(testCase, calls, defaultBudget) {
  const expected = testCase.expected ?? {};
  const delivered = unique(calls.flatMap((call) => call.identities));
  const required = unique(asArray(expected.requiredIds));
  const relevant = unique(asArray(expected.relevantIds));
  const forbidden = unique(asArray(expected.forbiddenIds));
  const requiredFound = required.filter((id) => delivered.includes(id));
  const relevantFound = relevant.filter((id) => delivered.includes(id));
  const leaked = forbidden.filter((id) => delivered.includes(id));
  const joinedText = calls.map((call) => call.text).join('\n');
  const missingText = asArray(expected.textIncludes).filter((part) => !joinedText.includes(part));
  const forbiddenText = asArray(expected.textExcludes).filter((part) => joinedText.includes(part));
  const characters = calls.reduce((sum, call) => sum + call.characters, 0);
  const latencyMs = calls.reduce((sum, call) => sum + call.latencyMs, 0);
  const budgetCharacters = Number(testCase.budgetCharacters ?? defaultBudget ?? 60_000);
  const callErrors = calls.filter((call) => !call.ok).map((call) => ({
    tool: call.tool, status: call.status, error: call.error,
  }));
  const abstentionFailed = expected.abstain === true && delivered.length > 0;
  const recall = required.length === 0 ? null : requiredFound.length / required.length;
  const precision = relevant.length === 0 || delivered.length === 0
    ? null
    : relevantFound.length / delivered.length;
  const passed = callErrors.length === 0 && requiredFound.length === required.length &&
    leaked.length === 0 && missingText.length === 0 && forbiddenText.length === 0 &&
    !abstentionFailed && characters <= budgetCharacters;
  return {
    id: testCase.id,
    class: testCase.class ?? 'unspecified',
    question: testCase.question,
    passed,
    calls: calls.map(({ text, ...call }) => call),
    delivered,
    required,
    requiredFound,
    recall,
    precision,
    leaked,
    missingText,
    forbiddenText,
    abstentionFailed,
    characters,
    budgetCharacters,
    latencyMs: Math.round(latencyMs * 100) / 100,
    callErrors,
  };
}

export async function runBaseline(manifest, options = {}) {
  validateManifest(manifest);
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:4173';
  const token = options.token ?? '';
  const health = await requestJson(baseUrl, token, '/health');
  if (!health.ok) throw new Error(`Vera no responde: ${health.status}`);
  const observedSequence = Number(health.body?.lastSequence ?? -1);
  const expectedSequence = Number(manifest.corpus?.sequence ?? -1);
  if (expectedSequence >= 0 && observedSequence !== expectedSequence && options.allowSequenceDrift !== true) {
    throw new Error(
      `el corpus está en secuencia ${observedSequence}; el manifiesto fija ${expectedSequence}. ` +
      'Usa el snapshot correcto o --allow-sequence-drift para una exploración no reproducible.',
    );
  }
  const results = [];
  for (const testCase of manifest.cases) {
    const calls = [];
    for (const call of testCase.calls) calls.push(await executeCall(baseUrl, token, call));
    results.push(scoreCase(testCase, calls, manifest.defaults?.budgetCharacters));
  }
  const required = results.reduce((sum, one) => sum + one.required.length, 0);
  const found = results.reduce((sum, one) => sum + one.requiredFound.length, 0);
  const relevant = manifest.cases.reduce(
    (sum, one) => sum + unique(asArray(one.expected?.relevantIds)).length,
    0,
  );
  const precisionCases = results.filter((one) => one.precision !== null);
  const delivered = precisionCases.reduce((sum, one) => sum + one.delivered.length, 0);
  const relevantFound = precisionCases.reduce((sum, one) => {
    const wanted = new Set(unique(asArray(manifest.cases.find((test) => test.id === one.id)?.expected?.relevantIds)));
    return sum + one.delivered.filter((id) => wanted.has(id)).length;
  }, 0);
  return {
    schemaVersion: SCHEMA_VERSION,
    benchmark: manifest.name ?? 'Context baseline',
    corpus: { expectedSequence, observedSequence },
    ranAt: new Date().toISOString(),
    summary: {
      cases: results.length,
      passed: results.filter((one) => one.passed).length,
      failed: results.filter((one) => !one.passed).length,
      evidenceRecall: required === 0 ? null : found / required,
      evidencePrecision: relevant === 0 || delivered === 0 ? null : relevantFound / delivered,
      leakChecks: manifest.cases.reduce(
        (sum, one) => sum + unique(asArray(one.expected?.forbiddenIds)).length,
        0,
      ),
      leaked: results.reduce((sum, one) => sum + one.leaked.length, 0),
      characters: results.reduce((sum, one) => sum + one.characters, 0),
      calls: results.reduce((sum, one) => sum + one.calls.length, 0),
      latencyMs: Math.round(results.reduce((sum, one) => sum + one.latencyMs, 0) * 100) / 100,
    },
    results,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8'));
  const report = await runBaseline(manifest, {
    baseUrl: options.baseUrl,
    token: process.env['VERA_TOKEN'] ?? '',
    allowSequenceDrift: options.allowSequenceDrift,
  });
  if (options.output !== '') await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
  if (report.summary.failed > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${String(error instanceof Error ? error.message : error)}\n`);
    process.exitCode = 1;
  });
}
