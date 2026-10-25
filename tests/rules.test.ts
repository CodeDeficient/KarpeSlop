import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { analyzeSource, findUnsafeAssertions, isTestPath } from '../rules.ts';
import { checkImports, isBarePackageSpecifier, type RegistryLookup } from '../imports.ts';

function typesIn(code: string, fileName = 'sample.ts'): string[] {
  return analyzeSource(code, fileName).map(finding => finding.type);
}

function countOf(code: string, type: string, fileName = 'sample.ts'): number {
  return typesIn(code, fileName).filter(found => found === type).length;
}

// ---------------------------------------------------------------------------
// placeholder_implementation
// ---------------------------------------------------------------------------

test('placeholder: comment plus dummy return is reported', () => {
  const code = 'export function parse(input: string): number {\n  // Implementation goes here\n  return 0;\n}\n';
  assert.equal(countOf(code, 'placeholder_implementation'), 1);
});

test('placeholder: "throw new Error(\'Not implemented\')" is reported', () => {
  assert.equal(countOf('class A { run() { throw new Error("Not implemented"); } }', 'placeholder_implementation'), 1);
});

test('placeholder: TODO inside a placeholder body is reported once, as the placeholder', () => {
  const types = typesIn('function f() {\n  // TODO: implement this\n  return null;\n}\n');
  assert.deepEqual(types, ['placeholder_implementation']);
});

test('placeholder: a real body with a TODO is only a TODO', () => {
  const code = 'function total(xs: number[]) {\n  // TODO: handle overflow\n  return xs.reduce((a, b) => a + b, 0);\n}\n';
  assert.deepEqual(typesIn(code), ['todo_comment']);
});

test('TODO and FIXME comments that link a tracking issue are not reported', () => {
  for (const comment of ['// FIXME https://github.com/reduxjs/redux-devtools/issues/1097', '// TODO(#1234): drop after the migration',
    '// TODO: remove once PROJ-88 ships', '// HACK: see issue 42']) {
    assert.equal(countOf(`${comment}\nexport {};\n`, 'todo_comment'), 0, comment);
  }
  assert.equal(countOf('// TODO(alice): tidy this up\nexport {};\n', 'todo_comment'), 1);
  assert.equal(countOf('// TODO: handle utf-8 input\nexport {};\n', 'todo_comment'), 1);
  assert.equal(countOf('// TODO: switch to SHA-256\nexport {};\n', 'todo_comment'), 1);
});

test('placeholder: comments that merely mention "placeholder" or "stub" are not placeholders', () => {
  assert.equal(countOf("class I { get placeholder() {\n  // placeholder text for the input\n  return 'Search...';\n} }", 'placeholder_implementation'), 0);
  assert.equal(countOf('function stub() { /* stub for tests */ }', 'placeholder_implementation'), 0);
  assert.equal(countOf('function f() {\n  // placeholder implementation\n  return [];\n}', 'placeholder_implementation'), 1);
});

test('placeholder: a TODO, "for now" or "placeholder" in a body that returns a constant is reported', () => {
  for (const code of [
    'function rate(kg: number): number {\n  // TODO: add shipping rate calculation\n  return 0;\n}',
    'function enabled(flag: string): boolean {\n  // For now, enable everything\n  return true;\n}',
    'function perms(role: string): string[] {\n  return []; // placeholder\n}',
    'class Log { record(e: string) {\n    // Logic to persist the event goes here\n  } }',
    'async function orders(id: string) {\n  // TODO\n  return [{ id: 1, total: 42 }];\n}'
  ]) {
    assert.equal(countOf(code, 'placeholder_implementation'), 1, code);
  }
});

test('placeholder: a comment that says the real code is elsewhere is reported on a short body', () => {
  for (const code of [
    'async function invoice(id: string) {\n  // Simulate API call\n  await new Promise(resolve => setTimeout(resolve, 500));\n  return { success: true };\n}',
    'function verify(a: string, b: string) {\n  // In a real application, you would use bcrypt here\n  return a === b;\n}',
    'function hash(p: string) {\n  // NOTE: replace with a proper hashing algorithm in production\n  return p;\n}',
    'async function orders(id: string) {\n  // Mock data\n  const rows = [{ id: 1 }];\n  return rows;\n}'
  ]) {
    assert.equal(countOf(code, 'placeholder_implementation'), 1, code);
  }
});

test('placeholder: a body that only logs and reports success is reported', () => {
  assert.equal(countOf('async function send(to: string) {\n  console.log(`Sending to ${to}`);\n  return true;\n}', 'placeholder_implementation'), 1);
  assert.equal(countOf('function warn(msg: string) {\n  console.log(msg);\n}', 'placeholder_implementation'), 0);
  assert.equal(countOf('function ready() {\n  console.log("ready");\n  return true;\n}', 'placeholder_implementation'), 0);
});

test('placeholder: real code near a stand-in comment, and explained throws, are not placeholders', () => {
  const mockInterceptor = 'const i = (req: R) => {\n  if (req.url) {\n    const data = load();\n    // Simulate network latency\n    const ms = Math.random() * 400;\n    return of(data).pipe(delay(ms));\n  }\n  return next(req);\n};';
  assert.equal(countOf(mockInterceptor, 'placeholder_implementation'), 0);
  assert.equal(countOf('const s = { set(): never {\n  throw new Error("read-only store: not implemented by design");\n} };', 'placeholder_implementation'), 0);
  assert.equal(countOf('class A { run() { throw new Error("Method not implemented."); } }', 'placeholder_implementation'), 1);
  assert.equal(countOf('class A { run() { throw new Error("TODO: integrate Twilio"); } }', 'placeholder_implementation'), 1);
  assert.equal(countOf('class NullRepo { async load(): Promise<null> { return null; } }', 'placeholder_implementation'), 0);
  assert.equal(countOf('function defaults() {\n  // Defaults for local development\n  return { port: 3000 };\n}', 'placeholder_implementation'), 0);
});

test('placeholder: empty no-op callbacks are not placeholders', () => {
  assert.equal(countOf('const noop = () => {};\nfunction onIdle() {}\n', 'placeholder_implementation'), 0);
});

// ---------------------------------------------------------------------------
// elided_code_comment
// ---------------------------------------------------------------------------

test('elided code comments are reported', () => {
  for (const comment of ['// ... rest of the code', '// ...existing code...', '// ...', '// rest of implementation', '// existing methods remain unchanged']) {
    assert.equal(countOf(`${comment}\nexport {};\n`, 'elided_code_comment'), 1, comment);
  }
});

test('elided code in other wordings, block comments and JSX is reported', () => {
  for (const comment of ['// Add more cases as needed', '// [existing code here]', '// ... other methods remain the same',
    '/* Handle other actions similarly */', '/* ... more routes */', '// (code omitted for brevity)', '// rest of the checkout form']) {
    assert.equal(countOf(`${comment}\nexport {};\n`, 'elided_code_comment'), 1, comment);
  }
  assert.equal(countOf('const f = () => <form>\n  {/* ... other fields ... */}\n</form>;', 'elided_code_comment', 'x.tsx'), 1);
});

test('ordinary comments mentioning "rest" are not elided-code comments', () => {
  assert.equal(countOf('// Spread the rest of the props onto the input\nexport {};\n', 'elided_code_comment'), 0);
  for (const comment of ['// The other fields here are optional', '// Rest of the array is already sorted',
    '// ...props,', '/** ... rest of the code */', '// ... then we retry with backoff', '/* ... see RFC 7231 */', '// Retry the remaining items after a delay']) {
    assert.equal(countOf(`${comment}\nexport {};\n`, 'elided_code_comment'), 0, comment);
  }
  assert.equal(countOf('// We batch requests here\n// ... and flush them on idle\nexport {};\n', 'elided_code_comment'), 0);
});

// ---------------------------------------------------------------------------
// empty_catch
// ---------------------------------------------------------------------------

test('empty catch block is reported', () => {
  assert.equal(countOf('try { a(); } catch (e) {}', 'empty_catch'), 1);
  assert.equal(countOf('p.catch(() => {});', 'empty_catch'), 1);
});

test('catch block with an explanatory comment is not reported', () => {
  assert.equal(countOf('try { a(); } catch {\n  // ignored: storage may be unavailable\n}', 'empty_catch'), 0);
  assert.equal(countOf('try { a(); } catch { /* best effort */ }', 'empty_catch'), 0);
});

test('empty catch that falls through to a fallback is not reported', () => {
  assert.equal(countOf('function f(c: string) {\n  try { return new TextDecoder(c); } catch {}\n  return new TextDecoder();\n}', 'empty_catch'), 0);
  assert.equal(countOf('function f(c?: string) {\n  if (c) {\n    try { return decode(c); } catch (_) {}\n  }\n  return null;\n}', 'empty_catch'), 0);
  assert.equal(countOf('function f(xs: string[]) {\n  for (const x of xs) {\n    try { return load(x); } catch {}\n  }\n  throw new Error("none");\n}', 'empty_catch'), 0);
});

test('empty catch with nothing after it, or a try that does not return, is reported', () => {
  assert.equal(countOf('function f() {\n  try { return load(); } catch {}\n}', 'empty_catch'), 1);
  assert.equal(countOf('function f() {\n  try { save(); } catch {}\n  return 1;\n}', 'empty_catch'), 1);
  assert.equal(countOf('function f() {\n  const g = () => { try { return load(); } catch {} };\n  return g;\n}', 'empty_catch'), 1);
});

test('swallowed error: a catch that only logs is reported', () => {
  assert.equal(countOf('async function f() {\n  try { await save(); } catch (err) {\n    console.error("Failed to save", err);\n  }\n}', 'swallowed_error'), 1);
  assert.equal(countOf('try { a(); } catch (e) { console.log(e); console.warn("again"); }', 'swallowed_error'), 1);
});

test('swallowed error: rethrowing, reporting, returning or commenting is not swallowing', () => {
  for (const code of [
    'try { a(); } catch (e) { console.error(e); throw e; }',
    'try { a(); } catch (e) { console.error(e); setError(e); }',
    'function f() { try { return a(); } catch { return null; } }',
    'function f(s: string) {\n  try { return JSON.parse(s); } catch (e) { console.warn(e); }\n  return {};\n}',
    'try { a(); } catch (e) {\n  // Analytics is best effort; never block the page on it.\n  console.warn(e);\n}',
    'p.catch(err => console.error(err));'
  ]) {
    assert.equal(countOf(code, 'swallowed_error'), 0, code);
  }
});

// ---------------------------------------------------------------------------
// placeholder_value
// ---------------------------------------------------------------------------

test('placeholder credentials are reported', () => {
  for (const value of ['YOUR_API_KEY', 'your-api-key-here', '<your-token>', 'sk-xxxxxxxxxxxx', 'changeme', 'replace-with-your-secret']) {
    assert.equal(countOf(`const key = '${value}';`, 'placeholder_value'), 1, value);
  }
});

test('placeholder values in more forms are reported', () => {
  for (const value of ['<API_KEY>', 'Bearer <API_KEY>', 'INSERT_API_KEY_HERE', 'postgres://user:password@localhost:5432/app',
    'noreply@yourdomain.com', 'https://hooks.slack.com/services/XXX/YYY/ZZZ']) {
    assert.equal(countOf(`const v = '${value}';`, 'placeholder_value'), 1, value);
  }
  assert.equal(countOf("const API_BASE = 'https://api.example.com/v1';", 'placeholder_value'), 1);
  assert.equal(countOf("export const cfg = { baseUrl: 'https://example.org' };", 'placeholder_value'), 1);
});

test('a hard-coded fallback for a secret environment variable is reported', () => {
  assert.equal(countOf("const s = process.env.SESSION_PASSWORD ?? 'supersecretpassword';", 'placeholder_value'), 1);
  assert.equal(countOf("const s = import.meta.env.VITE_API_KEY || 'abc';", 'placeholder_value'), 1);
  assert.equal(countOf("const s = process.env.SESSION_PASSWORD ?? '';", 'placeholder_value'), 0);
  assert.equal(countOf("const port = process.env.PORT || '3000';", 'placeholder_value'), 0);
  assert.equal(countOf("const k = process.env.CACHE_KEY || 'v1';", 'placeholder_value'), 0);
  assert.equal(countOf("const s = process.env.JWT_SECRET || process.env.OLD_SECRET || 'secret';", 'placeholder_value'), 1);
});

test('example domains passed to a call and usage text are not placeholder values', () => {
  assert.equal(countOf("const u = new URL(path, 'http://example.com');", 'placeholder_value'), 0);
  assert.equal(countOf("const usage = 'Usage: tool --token <your-token>';", 'placeholder_value'), 0);
  assert.equal(countOf("const f = format(d, 'HH:mm xxx');", 'placeholder_value'), 0);
  for (const value of ['insert_id', 'ADD_USER_ID', 'REPLACE_TOKEN', 'add_key']) {
    assert.equal(countOf(`const t = '${value}';`, 'placeholder_value'), 0, value);
  }
});

test('ordinary status values are not placeholder values', () => {
  assert.equal(countOf("const s = 'todo'; if (t.status === 'fixme') {}", 'placeholder_value'), 0);
});

test('UI copy and JSX placeholders are not placeholder values', () => {
  assert.equal(countOf('const label = "Your API key";', 'placeholder_value'), 0);
  assert.equal(countOf('const x = <input placeholder="your-email" />;', 'placeholder_value', 'x.tsx'), 0);
});

// ---------------------------------------------------------------------------
// any / casts
// ---------------------------------------------------------------------------

test('any: annotations are reported once per line, strings are not', () => {
  assert.equal(countOf('type T = (data: any) => any;', 'any_type_usage'), 1);
  assert.equal(countOf('const a: Record<string,\n  any> = {};', 'any_type_usage'), 1);
  assert.equal(countOf('const s = "expected : any here";', 'any_type_usage'), 0);
});

test('any: generic constraints, conditional extends and fully erased generics are not reported', () => {
  assert.equal(countOf('function f<T extends (...args: any[]) => any>(fn: T) { return fn; }', 'any_type_usage'), 0);
  assert.equal(countOf('type R<T> = T extends Promise<any> ? 1 : 0;', 'any_type_usage'), 0);
  assert.equal(countOf('const observers: Array<Observer<any, any, any>> = [];', 'any_type_usage'), 0);
  assert.equal(countOf('const p: Promise<any> = load();', 'any_type_usage'), 1);
});

test('casts: every cast is reported, `as const` and `as unknown` are not', () => {
  assert.equal(countOf('const a = b as Foo;', 'type_assertion'), 1);
  assert.equal(countOf('const a = <Foo>b;', 'type_assertion'), 1);
  assert.equal(countOf('const a = [1] as const;', 'type_assertion'), 0);
  assert.equal(countOf('const a = b as unknown;', 'type_assertion'), 0);
  // `as any` is reported by findUnsafeAssertions as unsafe_type_assertion, not here.
  assert.equal(countOf('const a = b as any;', 'type_assertion'), 0);
  assert.equal(countOf('const a = b as any;', 'any_type_usage'), 0);
});

test('casts: cast-like text in strings and comments is not code', () => {
  assert.deepEqual(typesIn('const s = "x as any"; // v as any'), []);
});

test('casts: a parenthesized two-cast chain is one chained-cast finding', () => {
  assert.deepEqual(typesIn('const y = (x as unknown) as Foo;'), ['unsafe_double_type_assertion']);
  assert.deepEqual(typesIn('const y = x as A as B;'), ['unsafe_double_type_assertion']);
});

test('casts: each link of a longer chain is reported; any is reported too; plain parentheses are not a chain', () => {
  assert.deepEqual(typesIn('const y = (x as unknown) as any;'), ['unsafe_double_type_assertion', 'unsafe_type_assertion']);
  assert.deepEqual(typesIn('const y = ((x as A) as B) as C;'), ['unsafe_double_type_assertion', 'unsafe_double_type_assertion']);
  assert.deepEqual(typesIn('const y = (x as A) as B as C;'), ['unsafe_double_type_assertion', 'unsafe_double_type_assertion']);
  assert.deepEqual(typesIn('const y = (x) as any;'), ['unsafe_type_assertion']);
  assert.deepEqual(typesIn('const y = <B>(<A>x);'), ['unsafe_double_type_assertion']);
  // `as const` is not a cast, so it does not start a chain.
  assert.deepEqual(typesIn('const y = (x as const) as B;'), ['type_assertion']);
  assert.deepEqual(findUnsafeAssertions('const y = (x as A) as B;', 'x.ts').map(cast => cast.assertionForm), ['chained_as']);
});

test('cast, any and non-null rules run on TypeScript files only', () => {
  const code = 'const a = v as any;\nconst b = v as Foo;\nlet c: any;\nconst d = m.get(k)!;\n';
  const typeRules = ['unsafe_type_assertion', 'type_assertion', 'any_type_usage', 'non_null_assertion'];
  for (const fileName of ['x.ts', 'x.tsx', 'x.mts', 'x.cts']) {
    assert.deepEqual(typesIn(code, fileName).filter(type => typeRules.includes(type)).sort(), [...typeRules].sort(), fileName);
  }
  for (const fileName of ['x.js', 'x.jsx', 'x.mjs', 'x.cjs']) {
    assert.deepEqual(typesIn(code, fileName).filter(type => typeRules.includes(type)), [], fileName);
  }
});

test('casts: a cast followed by as unknown is still reported', () => {
  assert.deepEqual(typesIn('const y = x as Foo as unknown;'), ['type_assertion']);
  assert.deepEqual(typesIn('const y = (x as Foo) as unknown;'), ['type_assertion']);
  assert.deepEqual(typesIn('const y = x as Foo[] as unknown;'), ['unsafe_array_assertion']);
  // Through `as unknown` into a further cast, it is one chain again.
  assert.deepEqual(typesIn('const y = x as Foo as unknown as Bar;'), ['unsafe_double_type_assertion']);
  assert.deepEqual(typesIn('const y = (x as Foo as unknown) as Bar;'), ['unsafe_double_type_assertion']);
});

test('non-null assertions are reported', () => {
  assert.equal(countOf('const a = map.get(k)!;', 'non_null_assertion'), 1);
  assert.equal(countOf('if (a !== b) {}', 'non_null_assertion'), 0);
});

// ---------------------------------------------------------------------------
// unchecked_fetch_response
// ---------------------------------------------------------------------------

test('fetch body read without a status check is reported', () => {
  assert.equal(countOf('async function f() { const res = await fetch(u); return res.json(); }', 'unchecked_fetch_response'), 1);
  assert.equal(countOf('fetch(u).then(r => r.json());', 'unchecked_fetch_response'), 1);
  assert.equal(countOf('async function f() { return (await fetch(u)).json(); }', 'unchecked_fetch_response'), 1);
});

test('logging a fetch response is not a status check', () => {
  assert.equal(countOf('async function f() {\n  const res = await fetch("/a");\n  console.log(res);\n  return res.json();\n}', 'unchecked_fetch_response'), 1);
});

test('fetch with a status check, a handed-off response, or a local fetch is not reported', () => {
  assert.equal(countOf('async function f() { const res = await fetch(u); if (!res.ok) throw new Error(); return res.json(); }', 'unchecked_fetch_response'), 0);
  assert.equal(countOf('async function f() { const res = await fetch(u); assertOk(res); return res.json(); }', 'unchecked_fetch_response'), 0);
  assert.equal(countOf('async function f() { const res = await fetch(u); return res; }', 'unchecked_fetch_response'), 0);
  assert.equal(countOf('async function f() { const res = await fetch(u); const { ok } = res; if (!ok) throw e; return res.json(); }', 'unchecked_fetch_response'), 0);
  assert.equal(countOf('const fetch = makeClient();\nfetch(u).then(r => r.json());', 'unchecked_fetch_response'), 0);
  assert.equal(countOf('class Q { run() { return this.fetch(); } }', 'unchecked_fetch_response'), 0);
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

test('suppression comments do not hide findings', () => {
  // The comments themselves are reported by their own rules; drop those to see what they sit next to.
  const hidden = new Set(['blanket_eslint_disable', 'ts_suppression']);
  const findingsNear = (code: string) => typesIn(code).filter(type => !hidden.has(type));
  // Every cast form, plus the non-cast type rules.
  assert.deepEqual(findingsNear('const a = v as any; // eslint-disable-line'), ['unsafe_type_assertion']);
  assert.deepEqual(findingsNear('const a = v as any; // eslint-disable-line @typescript-eslint/no-explicit-any'), ['unsafe_type_assertion']);
  assert.deepEqual(findingsNear('// eslint-disable-next-line\nconst a = v as unknown as Foo;'), ['unsafe_double_type_assertion']);
  assert.deepEqual(findingsNear('// @ts-ignore\nconst a = v as Record<string, unknown>;'), ['unsafe_object_assertion']);
  assert.deepEqual(findingsNear('// @ts-expect-error\nconst a = v as Foo[];'), ['unsafe_array_assertion']);
  assert.deepEqual(findingsNear('// eslint-disable-next-line\nconst a = b as Foo;'), ['type_assertion']);
  assert.deepEqual(findingsNear('// @ts-ignore\nlet c: any;'), ['any_type_usage']);
  assert.deepEqual(findingsNear('// eslint-disable-next-line no-non-null-assertion\nconst a = m.get(k)!;'), ['non_null_assertion']);
  // Rules that are not about types.
  assert.deepEqual(findingsNear('try { x(); } catch {} // eslint-disable-line'), ['empty_catch']);
  assert.deepEqual(findingsNear('console.log(x); // eslint-disable-line no-console'), ['production_console_log']);
  // File-wide directives.
  assert.deepEqual(findingsNear('/* eslint-disable */\nconst a = v as any;'), ['unsafe_type_assertion']);
  assert.deepEqual(findingsNear('// @ts-nocheck\nconst a = v as any;'), ['unsafe_type_assertion']);
});

test('@ts-ignore and blanket eslint-disable are reported; scoped forms are not', () => {
  assert.equal(countOf('// @ts-ignore\nconst a = 1;', 'ts_suppression'), 1);
  assert.equal(countOf('// @ts-expect-error -- wrong upstream types\nconst a = 1;', 'ts_suppression'), 0);
  assert.equal(countOf('/* eslint-disable */\nconst a = 1;', 'blanket_eslint_disable'), 1);
  assert.equal(countOf('// eslint-disable-next-line no-console\nconsole.log(1);', 'blanket_eslint_disable'), 0);
});

test('hedging is narrow: "should work" yes, "probably" and "just" no', () => {
  assert.equal(countOf('// this should work now\nexport {};', 'hedging_comment'), 1);
  assert.equal(countOf('// probably cached already, so skip\nexport {};', 'hedging_comment'), 0);
  assert.equal(countOf('// This just creates a retryer\nexport {};', 'hedging_comment'), 0);
});

test('restating comment: repeats the next line', () => {
  assert.equal(countOf('// Set loading to true\nsetLoading(true);', 'restating_comment'), 1);
  assert.equal(countOf('// Fetch the user data\nconst data = await fetchUser(id);', 'restating_comment'), 1);
});

test('restating comment: one-word section labels are not reported', () => {
  assert.equal(countOf("const rules = {\n  // Imports\n  'import/first': 'error',\n};", 'restating_comment'), 0);
  assert.equal(countOf('// Email\nexport type EmailParams = { email: string };', 'restating_comment'), 0);
  assert.equal(countOf('// ZodEmail\nexport const ZodEmail = 1;', 'restating_comment'), 0);
  assert.equal(countOf('//////////   ZodGUID   //////////\nexport const ZodGUID = 1;', 'restating_comment'), 0);
  assert.equal(countOf('// ZodString.init(inst, def);\nZodString.init(inst, def);', 'restating_comment'), 0);
});

test('restating comment: explanations and documented assumptions are not reported', () => {
  assert.equal(countOf('// Retry because the API rate-limits bursts\nretry(call);', 'restating_comment'), 0);
  assert.equal(countOf('// Assumes the input is sorted; binary search depends on it.\nfind(xs, t);', 'restating_comment'), 0);
});

test('filler opener: reported only when the summary repeats the code that follows', () => {
  assert.equal(countOf('/**\n * This function is used to fetch users.\n */\nexport function fetchUsers() { return 1; }', 'filler_comment'), 1);
  const informative = '/**\n * This function is responsible for retrying a request with exponential backoff.\n * Gives up after `attempts` tries.\n */\nexport function withRetry() { return 1; }';
  assert.equal(countOf(informative, 'filler_comment'), 0);
});

test('filler doc comment: @param/@returns that restate names', () => {
  assert.equal(countOf('/**\n * @param id - the id\n * @returns the result\n */\nfunction get(id: string) { return id; }', 'filler_comment'), 1);
  assert.equal(countOf('/**\n * @param id - row id from the orders table, not the order number\n */\nfunction get(id: string) { return id; }', 'filler_comment'), 0);
});

test('issue numbers in comments are not flagged as anything', () => {
  assert.deepEqual(typesIn('// Fixed in PR #123, see issue #4567\nexport {};'), []);
});

test('JSX text that looks like a comment is not a comment', () => {
  assert.deepEqual(typesIn('const a = <p>// TODO this is copy, not code</p>;', 'a.tsx'), []);
});

test('test paths are recognized', () => {
  assert.equal(isTestPath('src/__tests__/a.ts'), true);
  assert.equal(isTestPath('src/a.test-d.tsx'), true);
  assert.equal(isTestPath('src/a.spec.ts'), true);
  assert.equal(isTestPath('src/attest.ts'), false);
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karpeslop-imports-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const fakeReact = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0', lodash: '^4.0.0' } }),
  'node_modules/react/package.json': JSON.stringify({ name: 'react', version: '18.3.1', types: 'index.d.ts' }),
  'node_modules/react/index.d.ts': 'export declare function useState<T>(v: T): [T, (v: T) => void];\nexport declare function useEffect(f: () => void): void;\n'
};

const registry: RegistryLookup = async name => (name === 'left-padx-utils-ai' ? 'missing' : 'exists');

test('checkImports: names missing from typed modules are reported, including multi-line and aliased imports', async () => {
  const dir = makeProject({
    ...fakeReact,
    'src/a.tsx': "import {\n  useState,\n  useRouter,\n} from 'react';\nimport { useRouter as r } from 'react';\n"
  });
  try {
    const findings = await checkImports([path.join(dir, 'src/a.tsx')], dir, registry);
    assert.deepEqual(findings.map(f => [f.type, f.line]), [['hallucinated_import', 3], ['hallucinated_import', 5]]);
    assert.match(findings[0].fix ?? '', /next\/navigation/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkImports: undeclared and nonexistent packages', async () => {
  const dir = makeProject({
    ...fakeReact,
    'src/a.ts': "import x from 'left-padx-utils-ai';\nimport y from 'some-real-but-undeclared';\nimport _ from 'lodash';\nimport fs from 'node:fs';\nimport p from 'path';\nimport z from '@/lib/z';\n"
  });
  try {
    const findings = await checkImports([path.join(dir, 'src/a.ts')], dir, registry);
    assert.deepEqual(findings.map(f => [f.type, f.line]), [['nonexistent_package', 1], ['undeclared_dependency', 2]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkImports: a known mix-up from an undeclared package reports both problems', async () => {
  const dir = makeProject({ 'package.json': '{"name":"app"}', 'a.ts': "import { useRouter } from 'react';\n" });
  try {
    const findings = await checkImports([path.join(dir, 'a.ts')], dir, registry);
    assert.deepEqual(findings.map(f => f.type).sort(), ['hallucinated_import', 'undeclared_dependency']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkImports: without a package.json, package checks are skipped but known mix-ups still fail', async () => {
  const dir = makeProject({ 'a.ts': "import { useRouter } from 'react';\nimport q from 'whatever';\n" });
  try {
    const findings = await checkImports([path.join(dir, 'a.ts')], dir, registry);
    assert.deepEqual(findings.map(f => f.type), ['hallucinated_import']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkImports: re-exports from an unresolved module are not treated as missing', async () => {
  const dir = makeProject({
    'package.json': JSON.stringify({ name: 'pkg', dependencies: { core: '1.0.0' } }),
    'src/index.ts': "export * from 'core';\nexport const local = 1;\n",
    'src/use.ts': "import { local, fromCore } from './index';\n"
  });
  try {
    const findings = await checkImports([path.join(dir, 'src/index.ts'), path.join(dir, 'src/use.ts')], dir, registry);
    assert.deepEqual(findings, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkImports: aliases from a nested tsconfig or a bundler config are not packages', async () => {
  const lookups: string[] = [];
  const recording: RegistryLookup = async name => {
    lookups.push(name);
    return 'missing';
  };
  const dir = makeProject({
    'package.json': JSON.stringify({ name: 'repo', private: true }),
    'packages/web/package.json': JSON.stringify({ name: 'web' }),
    'packages/web/tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['src/lib/*'] } } }),
    'packages/web/src/a.ts': "import { x } from '@lib/util';\nimport { y } from '@components/Button';\n",
    'packages/web/vite.config.ts': "export default { resolve: { alias: { '@components': '/src/components' } } };\n"
  });
  try {
    const findings = await checkImports([path.join(dir, 'packages/web/src/a.ts')], dir, recording);
    assert.deepEqual(findings, []);
    assert.deepEqual(lookups, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkImports: paths from a solution-style tsconfig\'s references are honored', async () => {
  const dir = makeProject({
    'package.json': JSON.stringify({ name: 'app' }),
    'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }),
    'tsconfig.app.json': JSON.stringify({ compilerOptions: { composite: true, paths: { '@ui/*': ['./ui/*'] } }, include: ['src'] }),
    'src/a.ts': "import { Button } from '@ui/button';\n"
  });
  try {
    assert.deepEqual(await checkImports([path.join(dir, 'src/a.ts')], dir, registry), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkImports: module augmentations in the project\'s .d.ts files count as exports', async () => {
  const dir = makeProject({
    'package.json': JSON.stringify({ name: 'app', dependencies: { lib: '1.0.0' } }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }),
    'node_modules/lib/package.json': JSON.stringify({ name: 'lib', version: '1.0.0', types: 'index.d.ts' }),
    'node_modules/lib/index.d.ts': 'export declare const base: number;\n',
    'src/types/lib.d.ts': "import 'lib';\ndeclare module 'lib' { export const extra: string; }\n",
    'src/a.ts': "import { base, extra } from 'lib';\n"
  });
  try {
    const findings = await checkImports([path.join(dir, 'src/a.ts')], dir, registry);
    assert.deepEqual(findings, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('checkImports: render from react-dom is not a known mix-up', async () => {
  const dir = makeProject({ 'a.ts': "import { render } from 'react-dom';\n" });
  try {
    assert.deepEqual(await checkImports([path.join(dir, 'a.ts')], dir, registry), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isBarePackageSpecifier', () => {
  assert.equal(isBarePackageSpecifier('react'), true);
  assert.equal(isBarePackageSpecifier('@scope/pkg/sub'), true);
  for (const spec of ['./a', '../a', '/abs', '@/alias', '~/x', '#internal', 'node:fs', 'fs', 'virtual:x', '$lib/x']) {
    assert.equal(isBarePackageSpecifier(spec), false, spec);
  }
});
