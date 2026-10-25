import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { analyzeSource, isTestPath } from '../rules.ts';
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

test('placeholder: comments that merely mention "placeholder" or "stub" are not placeholders', () => {
  assert.equal(countOf("class I { get placeholder() {\n  // placeholder text for the input\n  return 'Search...';\n} }", 'placeholder_implementation'), 0);
  assert.equal(countOf('function stub() { /* stub for tests */ }', 'placeholder_implementation'), 0);
  assert.equal(countOf('function f() {\n  // placeholder implementation\n  return [];\n}', 'placeholder_implementation'), 1);
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

test('ordinary comments mentioning "rest" are not elided-code comments', () => {
  assert.equal(countOf('// Spread the rest of the props onto the input\nexport {};\n', 'elided_code_comment'), 0);
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

// ---------------------------------------------------------------------------
// placeholder_value
// ---------------------------------------------------------------------------

test('placeholder credentials are reported', () => {
  for (const value of ['YOUR_API_KEY', 'your-api-key-here', '<your-token>', 'sk-xxxxxxxxxxxx', 'changeme', 'replace-with-your-secret']) {
    assert.equal(countOf(`const key = '${value}';`, 'placeholder_value'), 1, value);
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

test('casts: parenthesized chains count as chained casts, reported once', () => {
  assert.deepEqual(typesIn('const y = (x as unknown) as Foo;'), ['unsafe_double_type_assertion']);
  assert.deepEqual(typesIn('const y = x as A as B;'), ['unsafe_double_type_assertion']);
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
  const unsafeIn = (code: string) => typesIn(code).filter(type => type.startsWith('unsafe_') || type === 'non_null_assertion');
  assert.deepEqual(unsafeIn('const a = v as any; // eslint-disable-line'), ['unsafe_type_assertion']);
  assert.deepEqual(unsafeIn('// eslint-disable-next-line\nconst a = v as unknown as Foo;'), ['unsafe_double_type_assertion']);
  assert.deepEqual(unsafeIn('// @ts-ignore\nconst a = v as Record<string, unknown>;'), ['unsafe_object_assertion']);
  assert.deepEqual(unsafeIn('// @ts-expect-error\nconst a = v as Foo[];'), ['unsafe_array_assertion']);
  assert.deepEqual(unsafeIn('// eslint-disable-next-line no-non-null-assertion\nconst a = m.get(k)!;'), ['non_null_assertion']);
  // Cast-like text in strings and comments is not code.
  assert.deepEqual(typesIn('const s = "x as any"; // v as any'), []);
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

test('restating comment: explanations and documented assumptions are not reported', () => {
  assert.equal(countOf('// Retry because the API rate-limits bursts\nretry(call);', 'restating_comment'), 0);
  assert.equal(countOf('// Assumes the input is sorted; binary search depends on it.\nfind(xs, t);', 'restating_comment'), 0);
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
