/**
 * Built-in KarpeSlop rules and the per-file syntax analysis that runs them.
 *
 * Every rule here works on the TypeScript AST (or on real comment ranges taken
 * from it), never on raw lines, so string contents, JSX text and code split
 * across lines are handled the same way the compiler sees them.
 *
 * Import checks that need module resolution live in imports.ts.
 */

import ts from 'typescript';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface RuleInfo {
  id: string;
  severity: Severity;
  /** One-line statement of what was found. Neutral: says nothing about who wrote it. */
  message: string;
  /** Why it matters, or what to check. */
  why: string;
  /** Only present when the fix is certain and mechanical. */
  fix?: string;
  learnMore?: string;
  /** Not reported in test, spec or mock files. */
  skipTests?: boolean;
}

export interface Finding {
  type: string;
  line: number;
  column: number;
  code: string;
  /** Overrides the rule message when the finding has specifics (e.g. the symbol name). */
  message?: string;
  fix?: string;
}

export const RULES: readonly RuleInfo[] = [
  {
    id: 'hallucinated_import',
    severity: 'critical',
    message: 'Imported name is not exported by the module.',
    why: 'This import fails at build time or is undefined at runtime.',
    learnMore: 'https://www.typescriptlang.org/docs/handbook/modules/reference.html'
  },
  {
    id: 'nonexistent_package',
    severity: 'critical',
    message: 'Imported package does not exist on the npm registry.',
    why: 'Names that models invent are a known target for package squatting. Do not install a package with this name without checking who published it.',
    fix: 'Remove the import and use a package you have verified.'
  },
  {
    id: 'undeclared_dependency',
    severity: 'high',
    message: 'Imported package is not declared in package.json and is not installed.',
    why: 'The import cannot resolve on a clean install.',
    fix: 'Add the package to package.json if it is the one you meant, or remove the import.'
  },
  {
    id: 'placeholder_implementation',
    severity: 'high',
    message: 'Function body is a placeholder.',
    why: 'The function returns a dummy value or throws instead of doing its job, so callers get wrong results without an error.',
    skipTests: true
  },
  {
    id: 'elided_code_comment',
    severity: 'high',
    message: 'Comment stands in for code that was left out ("... rest of code").',
    why: 'Code was elided, usually when a snippet was pasted from a chat answer. Whatever it stood for is missing.',
    fix: 'Restore the omitted code or delete the comment if nothing is missing.'
  },
  {
    id: 'placeholder_value',
    severity: 'high',
    message: 'String literal is a placeholder value (e.g. "YOUR_API_KEY").',
    why: 'The real value was never filled in. It usually belongs in configuration or an environment variable.',
    skipTests: true
  },
  {
    id: 'empty_catch',
    severity: 'high',
    message: 'Error is caught and silently discarded.',
    why: 'Failures here leave no trace. If ignoring the error is intended, say why in a comment inside the block.',
    learnMore: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch',
    skipTests: true
  },
  {
    id: 'swallowed_error',
    severity: 'medium',
    message: 'Error is caught, logged and then discarded.',
    why: 'Execution continues as if the operation succeeded, so callers and users never learn it failed. Rethrow, return a result the caller checks, or say in a comment why continuing is safe.',
    learnMore: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch',
    skipTests: true
  },
  {
    id: 'unsafe_type_assertion',
    severity: 'high',
    message: "Value is cast to 'any'.",
    why: 'The cast turns off type checking for every later use of the value.',
    learnMore: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html#using-type-predicates',
    skipTests: true
  },
  {
    id: 'unsafe_double_type_assertion',
    severity: 'high',
    message: 'Value is cast through another type (e.g. "as unknown as T").',
    why: 'A chained cast forces a conversion the compiler rejected. Validate the value at runtime or fix the source type instead.',
    learnMore: 'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions',
    skipTests: true
  },
  {
    id: 'unsafe_object_assertion',
    severity: 'high',
    message: 'Value is cast to an object type.',
    why: 'The compiler takes the shape on trust. If the value comes from outside the program (JSON, an API, storage), validate it instead.',
    learnMore: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
    skipTests: true
  },
  {
    id: 'unsafe_array_assertion',
    severity: 'high',
    message: 'Value is cast to an array type.',
    why: 'The compiler takes the element type on trust. If the value comes from outside the program, validate it instead.',
    learnMore: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
    skipTests: true
  },
  {
    id: 'type_assertion',
    severity: 'medium',
    message: 'Value is cast to another type.',
    why: 'The compiler takes the target type on trust. Prefer a type guard, a typed source, or "satisfies" when you only need to check the shape.',
    learnMore: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
    skipTests: true
  },
  {
    id: 'any_type_usage',
    severity: 'medium',
    message: "Type is declared as 'any'.",
    why: "'any' turns off type checking wherever the value flows. 'unknown' keeps it on and forces a check before use.",
    learnMore: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
    skipTests: true
  },
  {
    id: 'ts_suppression',
    severity: 'medium',
    message: 'Type errors are suppressed with @ts-ignore or @ts-nocheck.',
    why: 'The suppression hides the error permanently, including after the code around it changes.',
    fix: "Use '// @ts-expect-error <reason>' for a single line; it fails once the error is gone.",
    learnMore: 'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-9.html#-ts-expect-error-comments'
  },
  {
    id: 'blanket_eslint_disable',
    severity: 'medium',
    message: 'ESLint is disabled without naming a rule.',
    why: 'Every lint rule is off for this scope, not just the one that fired.',
    fix: 'Name the rule being disabled, e.g. "eslint-disable-next-line no-console".'
  },
  {
    id: 'unchecked_fetch_response',
    severity: 'medium',
    message: 'fetch() response body is read without checking the HTTP status.',
    why: 'fetch() only rejects on network failure. A 404 or 500 response is read as if it succeeded.',
    fix: 'Check response.ok (or response.status) before reading the body.',
    learnMore: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#checking_response_status',
    skipTests: true
  },
  {
    id: 'non_null_assertion',
    severity: 'low',
    message: "Non-null assertion ('!') on a value.",
    why: 'The compiler takes it on trust that the value is not null or undefined. Check it or narrow the type instead.',
    learnMore: 'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#non-null-assertion-operator-postfix-',
    skipTests: true
  },
  {
    id: 'hedging_comment',
    severity: 'low',
    message: 'Comment says the code is unverified ("should work", "hopefully").',
    why: 'Check the behavior and record what you found, or add a test.',
    skipTests: true
  },
  {
    id: 'restating_comment',
    severity: 'low',
    message: 'Comment restates the next line of code.',
    why: 'It repeats what the code already says. Comments are most useful when they explain why.',
    skipTests: true
  },
  {
    id: 'filler_comment',
    severity: 'low',
    message: 'Doc comment restates names ("@param id - the id", "@returns the result", "This function is used to ...").',
    why: 'It adds length without information. Say what is not obvious from the name, or remove it.',
    skipTests: true
  },
  {
    id: 'todo_comment',
    severity: 'low',
    message: 'TODO/FIXME/HACK marker.',
    why: 'Unfinished work. Link a tracking issue so it is not forgotten.'
  },
  {
    id: 'production_console_log',
    severity: 'low',
    message: 'console.log/debug/info call in application code.',
    why: 'Usually leftover debugging output. Use your logger if the output is intended.',
    skipTests: true
  }
];

const RULE_BY_ID = new Map(RULES.map(rule => [rule.id, rule]));

export function getRule(id: string): RuleInfo | undefined {
  return RULE_BY_ID.get(id);
}

export function isTestPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return /(^|\/)(__tests__|__mocks__|__fixtures__|__testfixtures__|tests?|spec|e2e|fixtures?)\//.test(normalized) ||
    /\.(test|spec|stories|bench)(-d)?\.[cm]?[jt]sx?$/.test(normalized) ||
    /(^|\/)test-[^/]*$/.test(normalized);
}

/**
 * `__fixtures__` and `__testfixtures__` (the jscodeshift convention) hold
 * sample input such as codemod before/after files, not code that runs. Plain
 * `fixtures/` folders often hold real test helpers (Playwright), so they are
 * not included.
 */
export function isFixturePath(filePath: string): boolean {
  return /(^|\/)(__fixtures__|__testfixtures__)\//.test(filePath.replace(/\\/g, '/'));
}

export function scriptKindFor(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Casts, `any` and `!` exist only in TypeScript, so those rules skip JavaScript files. */
function isTypeScriptFile(fileName: string): boolean {
  const kind = scriptKindFor(fileName);
  return kind === ts.ScriptKind.TS || kind === ts.ScriptKind.TSX;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export interface CommentInfo {
  pos: number;
  end: number;
  /** Comment body without the comment markers. */
  body: string;
  raw: string;
  line: number;
  column: number;
  isLineComment: boolean;
  /** True when nothing but whitespace precedes the comment on its line. */
  ownLine: boolean;
}

/**
 * Collect every real comment in the file. Comments are trivia attached to
 * tokens, so we read the trivia around every token (punctuation included, so
 * a comment alone inside `{ }` is found) and de-duplicate. Ranges that fall
 * inside JSX text are dropped because "//" there is not a comment.
 */
export function collectComments(sourceFile: ts.SourceFile): CommentInfo[] {
  const text = sourceFile.text;
  const byPos = new Map<number, ts.CommentRange>();
  const jsxTextRanges: Array<[number, number]> = [];

  const addRanges = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      byPos.set(range.pos, range);
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      jsxTextRanges.push([node.pos, node.end]);
      return;
    }
    addRanges(ts.getLeadingCommentRanges(text, node.pos));
    addRanges(ts.getTrailingCommentRanges(text, node.end));
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);

  if (jsxTextRanges.length > 0) {
    for (const commentPos of [...byPos.keys()]) {
      if (jsxTextRanges.some(([pos, end]) => commentPos >= pos && commentPos < end)) byPos.delete(commentPos);
    }
  }

  return [...byPos.values()]
    .sort((a, b) => a.pos - b.pos)
    .map(range => {
      const raw = text.slice(range.pos, range.end);
      const isLineComment = range.kind === ts.SyntaxKind.SingleLineCommentTrivia;
      const body = isLineComment
        ? raw.replace(/^\/\/+/, '')
        : raw.replace(/^\/\*+/, '').replace(/\*+\/$/, '').replace(/^\s*\*/gm, '');
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(range.pos);
      const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
      return {
        pos: range.pos,
        end: range.end,
        body: body.trim(),
        raw,
        line: line + 1,
        column: character + 1,
        isLineComment,
        ownLine: text.slice(lineStart, range.pos).trim() === ''
      };
    });
}

// ---------------------------------------------------------------------------
// Type assertions
// ---------------------------------------------------------------------------

export interface UnsafeAssertionFinding {
  type: string;
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  severity: Severity;
  assertionForm: string;
}

function isObjectTypeNode(type: ts.TypeNode): boolean {
  // Syntax-only: matches by name, so a local type named Record would also match.
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    return type.typeName.text === 'Record';
  }
  return ts.isTypeLiteralNode(type);
}

function isArrayTypeNode(type: ts.TypeNode): boolean {
  if (ts.isArrayTypeNode(type)) return true;
  return ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    (type.typeName.text === 'Array' || type.typeName.text === 'ReadonlyArray') &&
    (type.typeArguments?.length ?? 0) > 0;
}

/** Casts that are not really type claims: `as const` and `<const>`. */
function isConstAssertion(type: ts.TypeNode): boolean {
  return ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === 'const';
}

type AssertionNode = ts.AsExpression | ts.TypeAssertion;

function isAssertion(node: ts.Node): node is AssertionNode {
  return ts.isAsExpression(node) || ts.isTypeAssertionExpression(node);
}

/** A real cast: excludes `as const` (not a type claim) and `as unknown` (always safe). */
function isCast(node: ts.Node): node is AssertionNode {
  return isAssertion(node) && !isConstAssertion(node.type) && node.type.kind !== ts.SyntaxKind.UnknownKeyword;
}

export const UNSAFE_ASSERTION_TYPES = new Set([
  'unsafe_double_type_assertion',
  'unsafe_type_assertion',
  'unsafe_object_assertion',
  'unsafe_array_assertion'
]);

interface CastReport {
  type: string;
  form: string;
}

/** Classify one cast. Chained casts report the chain, plus `as any` when it ends in any. */
function skipParentheses(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/** The cast directly inside this one, looking through parentheses: `(x as A) as B`. */
function innerCast(node: AssertionNode): AssertionNode | undefined {
  const inner = skipParentheses(node.expression);
  return isAssertion(inner) && !isConstAssertion(inner.type) ? inner : undefined;
}

/** True for the inner half of a chained cast, which is reported as part of the chain. */
function isInnerOfChain(node: AssertionNode): boolean {
  let parent = node.parent;
  // Look past `as unknown`: `x as Foo as unknown` ends with a safe cast and is
  // no chain, but `x as Foo as unknown as Bar` is one, reported at `as Bar`.
  while (ts.isParenthesizedExpression(parent) || (isAssertion(parent) && parent.type.kind === ts.SyntaxKind.UnknownKeyword)) {
    parent = parent.parent;
  }
  return isCast(parent);
}

function classifyCast(node: AssertionNode): CastReport[] {
  const isAny = node.type.kind === ts.SyntaxKind.AnyKeyword;
  if (innerCast(node) !== undefined) {
    const reports: CastReport[] = [{ type: 'unsafe_double_type_assertion', form: 'chained_as' }];
    // Report the trailing `as any` as well, so turning off the chained-cast
    // rule does not hide it.
    if (isAny) reports.push({ type: 'unsafe_type_assertion', form: 'as_any' });
    return reports;
  }
  if (isAny) return [{ type: 'unsafe_type_assertion', form: 'as_any' }];
  if (isObjectTypeNode(node.type)) return [{ type: 'unsafe_object_assertion', form: 'as_object' }];
  if (isArrayTypeNode(node.type)) return [{ type: 'unsafe_array_assertion', form: 'as_array' }];
  return [{ type: 'type_assertion', form: 'as_type' }];
}

/**
 * Find the unsafe casts in a TypeScript file: `as any`, chained casts, and
 * casts to object or array types. Both `x as T` and `<T>x` forms count.
 * Other casts are reported by analyzeSource as type_assertion.
 */
export function findUnsafeAssertions(sourceText: string, fileName: string): UnsafeAssertionFinding[] {
  if (!isTypeScriptFile(fileName) || fileName.endsWith('.d.ts')) return [];
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
  return unsafeAssertionsIn(sourceFile, fileName);
}

function unsafeAssertionsIn(sourceFile: ts.SourceFile, fileName: string): UnsafeAssertionFinding[] {
  const sourceText = sourceFile.text;
  const findings: UnsafeAssertionFinding[] = [];

  const visit = (node: ts.Node) => {
    if (isCast(node)) {
      const start = node.getStart(sourceFile);
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
      for (const cast of classifyCast(node)) {
        if (!UNSAFE_ASSERTION_TYPES.has(cast.type)) continue;
        const rule = getRule(cast.type);
        findings.push({
          type: cast.type,
          file: fileName,
          line: line + 1,
          column: character + 1,
          code: sourceText.slice(start, node.end),
          message: rule?.message ?? cast.type,
          severity: rule?.severity ?? 'high',
          assertionForm: cast.form
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

// ---------------------------------------------------------------------------
// Per-file analysis
// ---------------------------------------------------------------------------

/**
 * Says the body is unfinished. Counts only when the body is trivial (a constant return, a throw, nothing).
 * Multi-line, so a TODO on any line of a block comment counts.
 */
const PLACEHOLDER_COMMENT = new RegExp([
  String.raw`\bimplement(ation)?\s+(goes\s+|logic\s+)?here\b`,
  String.raw`\byour\s+(own\s+)?(code|logic|implementation)\b`,
  String.raw`\b(add|insert|put|write)\s+(your\s+|the\s+|actual\s+|real\s+)?(\w+\s+)?(logic|code|implementation)\s+here\b`,
  String.raw`\b(logic|code|implementation)\b.{0,60}\bgoes\s+here\b`,
  String.raw`\bnot\s+(yet\s+)?implemented\b`,
  String.raw`\bimplement\s+(this|me|later|properly)\b`,
  String.raw`^\s*(TODO|FIXME)\b`,
  String.raw`\bfor\s+now\b`,
  String.raw`\b(placeholder|stub)\s+(implementation|logic|code|body|function|method|for\s+now)\b`,
  String.raw`^\s*(placeholder|stub|dummy|mock)(\s+(value|data|response|implementation))?(\s+for\s+now)?\.?\s*$`,
  String.raw`\bstubbed(\s+out)?\b`
].join('|'), 'im');

/**
 * Says the real implementation lives somewhere else ("in a real app you
 * would...", "simulate the API call"). Strong enough to count on any short body.
 */
const STAND_IN_COMMENT = new RegExp([
  String.raw`\bin\s+a\s+real\s+(app|application|implementation|project|world|scenario|system|environment)\b`,
  String.raw`\bin\s+production,?\s+(you|we|this|it)\s+(would|should|will)\b`,
  String.raw`\breplace\s+(this\s+)?with\s+(a\s+|an\s+|the\s+)?(real|actual|proper)\b`,
  String.raw`\breplace\s+with\s+.{1,40}\b(later|in\s+production)\b`,
  String.raw`\b(simulate|simulates|simulated|simulating)\s+(an?\s+|the\s+)?(api|network|http|server|request|call|response|delay|latency|fetch|database|db)\b`,
  String.raw`\b(fake|mock|mocked|dummy|hard-?coded)\s+(data|response|result|value|values|coordinates|implementation|user|users)\b`,
  String.raw`\bhard-?coded\s+for\s+now\b`,
  String.raw`\bpretend\b`,
  String.raw`\bfor\s+(the\s+)?demo\b`,
  String.raw`\buntil\s+we\s+(wire|hook|implement|integrate|connect|add)\b`
].join('|'), 'i');

/** A thrown message that is only "not implemented" (`'Method not implemented.'`), not one that explains why. */
const NOT_IMPLEMENTED_MESSAGE = /^[\w\s'"`.()-]{0,40}\bnot\s+(yet\s+)?implemented(\s+yet)?\W*$|^\W*implement\s+me\b|^\W*todo\b/i;

/**
 * Comments that stand in for code that was left out. Matched on the comment's
 * whole text, so ordinary prose that mentions "the rest of the props" is not
 * caught. A bare "..." counts only outside a multi-line comment block,
 * where it can be a continuation of the previous line.
 */
const ELIDED_ELLIPSIS = /^[[(]?\s*(\.\.\.|…)\s*[\])]?$/;
const ELIDED_COMMENT = new RegExp([
  // "...existing code...", "... (more routes)"
  String.raw`^[[(]?\s*(\.\.\.|…)\s*[[(]?\s*(the\s+)?(rest|existing|other|remaining|previous|more|same|your|additional)\b`,
  // "rest of the checkout form", "remaining handlers"
  String.raw`^(\.\.\.|…)?\s*[[(]?\s*(the\s+)?(rest|remainder)\s+of\b(?!.*\b(is|are|was|were)\b)[^.]{0,40}$`,
  String.raw`^(\.\.\.|…)?\s*[[(]?\s*remaining\s+\w+(\s+\w+)?\s*(\.\.\.|…)?\s*[\])]?$`,
  // "existing code here", "other methods remain the same", "handle other actions similarly"
  String.raw`^(\.\.\.|…)?\s*[[(]?\s*(\w+\s+)?(existing|previous|original|other|remaining|same|more)\s+(\w+\s+){0,2}?(code|logic|implementation|methods?|functions?|fields?|props|properties|handlers?|cases|routes|actions|imports|config|options|steps|styles?|components?|elements|items|endpoints)(\s+\w+){0,2}?\s+(here|unchanged|remains?(\s+(unchanged|the\s+same))?|stays?(\s+the\s+same)?|the\s+same|as\s+(before|is)|omitted|similarly|go(es)?\s+here|as\s+needed)\s*(\.\.\.|…)?\s*[\])]?\.?$`,
  // "add more cases as needed", "implement the remaining endpoints similarly"
  String.raw`^(add|insert|include|handle|implement|repeat)\s+(more|other|additional|remaining|the\s+other|the\s+remaining)\s+\w+(\s+\w+)?\s+(here|as\s+needed|similarly|if\s+needed|the\s+same\s+way)\b`,
  // "implementation omitted for brevity", but not "stack traces are omitted for brevity in logs"
  String.raw`^(?!.*\b(is|are|was|were|be|been)\b)(\.\.\.|…)?\s*[[(]?\s*(\w+\s+){0,3}(omitted|truncated|elided|skipped)\s+for\s+brevity\s*(\.\.\.|…)?\s*[\])]?\.?$`,
  String.raw`^(etc\.?|and\s+so\s+on\.?)$`
].join('|'), 'i');

const HEDGING_COMMENT = /\b(should\s+(hopefully\s+)?work|hopefully|might\s+work|(might|may)\s+not\s+work|seems\s+to\s+work|should\s+(handle|cover)\s+(most|all|any)\s+(of\s+the\s+)?(edge\s+)?(cases|inputs|scenarios|situations)\b|not\s+(100%\s+)?sure\s+(if|why|whether|this|that|how)|i\s+think|i\s+believe|fingers\s+crossed|for\s+some\s+reason)\b/i;

const TODO_COMMENT = /^\W*(TODO|FIXME|HACK|XXX)\b/;

/** Points at a tracking issue: a URL, `#123`, `owner/repo#123`, `JIRA-123` or "issue 123". */
const TRACKED_REFERENCE = /https?:\/\/|(^|[\s(]|[\w.-]+\/[\w.-]+)#\d+\b|\b(?!(UTF|SHA|ES|ISO|RFC|AES|RSA|HMAC|MD|TLS|SSL|HTTP|IPV|ECMA|PEP|UTC|GMT|BASE)-)[A-Z][A-Z0-9]+-\d+\b|\b([Ii]ssue|[Tt]icket|[Bb]ug)\s+#?\d+/;

const TS_SUPPRESSION = /^\s*@ts-(ignore|nocheck)\b/;

const BLANKET_ESLINT = /^\s*eslint-disable(-next-line|-line)?\s*(--.*)?$/;

const FILLER_OPENING = /^(this|the\s+following)\s+(function|method|component|hook|class|variable|constant|helper|utility|module|file)\s+(is\s+used\s+to|is\s+responsible\s+for|serves\s+to|is\s+designed\s+to|will\s+be\s+used\s+to|is\s+a\s+(\w+\s+)?(function|method|component|hook|class)\s+that)\b/i;

const FILLER_RETURN_WORDS = new Set(['the', 'a', 'an', 'result', 'results', 'value', 'values', 'return', 'returned', 'returns', 'data', 'response', 'output', 'promise']);

const DIRECTIVE_COMMENT = /^\s*(@ts-|eslint|prettier|istanbul|c8\b|v8\b|webpack|@vite|@jsx|@refresh|#|global\b|jshint|tslint|biome-|oxlint-|deno-)/i;

const PLACEHOLDER_VALUE_PATTERNS: readonly RegExp[] = [
  /^<\s*your[\s_-][^>]+>$/i,
  /^<\s*[A-Z][A-Z0-9_-]*(KEY|TOKEN|SECRET|PASSWORD|ID|URL)\s*>$/,
  /^(bearer|basic|token)\s+(<[^>]+>|your[_-][\w-]+|x{3,}|\.{3})$/i,
  /^your[_-](\w+[_-])*(api[_-]?key|key|token|secret|password|passwd|url|uri|endpoint|id|domain|project|bucket|account|client|dsn|webhook)([_-]here)?$/i,
  /^(insert|replace|put|enter|paste|add)[_-](with[_-])?(your|the)[_-][\w-]+$/i,
  /^(insert|replace|put|enter|paste|add)[_-]([a-z0-9]+[_-])*(api[_-]?key|key|token|secret|password|id|url)[_-]here$/i,
  /^(sk|pk|rk|ghp|xox[abp])[-_]?(x{6,}|\.{3,}|\*{6,})/i,
  /^(xxx{2,}|changeme|change[_-]me|replace[_-]?me)$/i,
  // Credentials and domains that are templates: postgres://user:password@..., you@yourdomain.com
  /:\/\/(user(name)?|admin|root|db_?user):(password|pass|secret|changeme|pwd)@/i,
  /[@.](your[-_]?(domain|company|app|project|site|org))\.(com|org|net|io|co|dev|app)\b/i,
  // https://hooks.slack.com/services/XXX/YYY/ZZZ
  /^https?:\/\/\S*\/(X{3,}|x{3,}|Y{3,}|Z{3,})(?=[/?#&]|$)/
];

/** A reserved example domain (RFC 2606). Reported only where a value is stored, not passed to a call (`new URL(p, 'http://example.com')`). */
const EXAMPLE_URL = /^https?:\/\/([\w-]+\.)*example\.(com|org|net)(?=[/:?#]|$)/i;

/** Environment variables that hold secrets. */
const SECRET_ENV_NAME = /(SECRET|PASSWORD|PASSWD|TOKEN|(API|PRIVATE|SECRET|ACCESS|SIGNING|ENCRYPTION)_KEY)$/i;

/** `process.env.JWT_SECRET` or `import.meta.env.VITE_API_KEY`, when the name is a secret. */
function isSecretEnvRead(expr: ts.Expression): boolean {
  const current = ts.isParenthesizedExpression(expr) ? expr.expression : expr;
  let name: string | undefined;
  let object: ts.Expression | undefined;
  if (ts.isPropertyAccessExpression(current)) {
    name = current.name.text;
    object = current.expression;
  } else if (ts.isElementAccessExpression(current) && ts.isStringLiteralLike(current.argumentExpression)) {
    name = current.argumentExpression.text;
    object = current.expression;
  }
  if (name === undefined || object === undefined || !SECRET_ENV_NAME.test(name)) return false;
  const objectText = object.getText();
  return objectText === 'process.env' || objectText === 'import.meta.env';
}

/** `process.env.JWT_SECRET || 'dev-secret'`: the literal is a fallback for a secret. */
function isSecretFallback(literal: ts.StringLiteralLike): boolean {
  const parent = literal.parent;
  return literal.text !== '' && ts.isBinaryExpression(parent) && parent.right === literal &&
    (parent.operatorToken.kind === ts.SyntaxKind.BarBarToken || parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
    readsSecretEnv(parent.left);
}

/** `process.env.A_SECRET`, or a `||`/`??` chain of reads that includes one. */
function readsSecretEnv(expr: ts.Expression): boolean {
  if (ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken || expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
    return readsSecretEnv(expr.left) || readsSecretEnv(expr.right);
  }
  return isSecretEnvRead(expr);
}

/** The literal is stored (a variable, property or default), not passed to a call. */
function isStoredValue(literal: ts.Node): boolean {
  let parent = literal.parent;
  while (ts.isBinaryExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isTemplateSpan(parent) ||
    ts.isConditionalExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) {
    parent = parent.parent;
  }
  return ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isParameter(parent) ||
    ts.isPropertyDeclaration(parent) || ts.isBindingElement(parent);
}

const RESTATING_STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'with', 'in', 'on', 'from', 'by', 'at', 'as', 'into',
  'this', 'that', 'it', 'its', 'is', 'are', 'be', 'we', 'our', 'new', 'value', 'values', 'variable',
  'function', 'method', 'call', 'calls', 'set', 'sets', 'get', 'gets', 'create', 'creates', 'initialize',
  'initializes', 'init', 'define', 'defines', 'declare', 'declares', 'store', 'stores', 'save', 'check',
  'checks', 'if', 'then', 'else', 'increment', 'add', 'adds', 'update', 'updates', 'return', 'returns',
  'make', 'makes', 'using', 'use', 'uses', 'via', 'all', 'each', 'list', 'array', 'object', 'state',
  'current', 'given', 'provided', 'now', 'here', 'up', 'out', 'some', 'any', 'data'
]);

const EXPLAINING_WORDS = /\b(because|since|so\s+that|otherwise|why|note|hack|workaround|bug|issue|see|unless|until|avoid|prevent|ensure|must|need|needs|instead|only|always|never|keep|order|before|after)\b|[?:]|https?:/i;

function splitWords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function stem(word: string): string {
  return word.length > 3 ? word.replace(/(ies|es|s)$/, '') : word;
}

/**
 * A doc comment whose only content restates parameter names, or a stock
 * opener ("This function is used to ...") whose summary repeats the code
 * that follows (`codeWords`, stemmed).
 */
function isFillerComment(comment: CommentInfo, codeWords: ReadonlySet<string>): boolean {
  const opener = FILLER_OPENING.exec(comment.body);
  if (opener !== null) {
    const summary = comment.body.slice(opener[0].length).split('\n').filter(line => !line.trim().startsWith('@')).join(' ');
    const content = splitWords(summary).filter(word => !RESTATING_STOPWORDS.has(word));
    if (content.every(word => codeWords.has(stem(word)))) return true;
  }
  if (comment.isLineComment) return false;
  let tagLines = 0;
  for (const line of comment.body.split('\n').map(text => text.trim())) {
    const param = /^@param\s+(\{[^}]*\}\s*)?\[?([\w$.]+)[^\s]*\s*-?\s*(.*)$/.exec(line);
    if (param !== null) {
      const nameWords = new Set(splitWords(param[2]).map(stem));
      const described = splitWords(param[3]).filter(word => !RESTATING_STOPWORDS.has(word));
      if (described.length === 0 || described.some(word => !nameWords.has(stem(word)))) return false;
      tagLines++;
      continue;
    }
    const returns = /^@returns?\s+(\{[^}]*\}\s*)?(.*)$/.exec(line);
    if (returns !== null) {
      if (!splitWords(returns[2]).every(word => FILLER_RETURN_WORDS.has(word))) return false;
      tagLines++;
      continue;
    }
    // Any other tag carries information of its own. Summary lines are judged by FILLER_OPENING only.
    if (line.startsWith('@')) return false;
  }
  return tagLines > 0;
}

/** Strips parentheses, `await`, casts and `satisfies`, which don't change what a constant is. */
function unwrapExpression(expr: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(expr) || ts.isAwaitExpression(expr) || ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) || ts.isTypeAssertionExpression(expr) || ts.isNonNullExpression(expr)) {
    expr = expr.expression;
  }
  return expr;
}

/** A constant: a literal, or an array or object built only from literals. */
function isTrivialExpression(expr: ts.Expression | undefined): boolean {
  if (expr === undefined) return true;
  expr = unwrapExpression(expr);
  if (ts.isNumericLiteral(expr) || ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return true;
  if (ts.isPrefixUnaryExpression(expr)) return isTrivialExpression(expr.operand);
  if (ts.isIdentifier(expr)) return expr.text === 'undefined';
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.every(element => isTrivialExpression(element));
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.every(property => ts.isPropertyAssignment(property) && isTrivialExpression(property.initializer));
  }
  return expr.kind === ts.SyntaxKind.NullKeyword ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword;
}

/** A constant other than undefined/null/empty: `true`, `{ success: true }`, `[{ id: 1 }]`. */
function isMeaningfulConstant(expr: ts.Expression | undefined): boolean {
  if (expr === undefined || !isTrivialExpression(expr)) return false;
  const inner = unwrapExpression(expr);
  if (ts.isIdentifier(inner) || inner.kind === ts.SyntaxKind.NullKeyword) return false;
  if (ts.isArrayLiteralExpression(inner)) return inner.elements.length > 0;
  if (ts.isObjectLiteralExpression(inner)) return inner.properties.length > 0;
  return true;
}

/** `await new Promise(resolve => setTimeout(resolve, 500))` or `await sleep(500)`: a stand-in for real work. */
function isFakeDelay(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement) || !ts.isAwaitExpression(statement.expression)) return false;
  const awaited = statement.expression.expression;
  if (ts.isCallExpression(awaited) && ts.isIdentifier(awaited.expression)) {
    return /^(sleep|delay|wait|timeout)$/i.test(awaited.expression.text) &&
      awaited.arguments.length === 1 && ts.isNumericLiteral(awaited.arguments[0]);
  }
  if (!ts.isNewExpression(awaited) || !ts.isIdentifier(awaited.expression) || awaited.expression.text !== 'Promise') return false;
  const executor = awaited.arguments?.[0];
  return executor !== undefined && (ts.isArrowFunction(executor) || ts.isFunctionExpression(executor)) &&
    callsSetTimeout(executor.body);
}

function callsSetTimeout(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'setTimeout') return true;
  return ts.forEachChild(node, callsSetTimeout) ?? false;
}

function isNotImplementedThrow(statement: ts.Statement): boolean {
  if (!ts.isThrowStatement(statement)) return false;
  const thrown = statement.expression;
  if (!ts.isNewExpression(thrown) && !ts.isCallExpression(thrown)) return false;
  const first = thrown.arguments?.[0];
  return first !== undefined &&
    (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) &&
    NOT_IMPLEMENTED_MESSAGE.test(first.text);
}

function isTrivialStatement(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return isTrivialExpression(statement.expression);
  if (ts.isThrowStatement(statement)) return true;
  if (ts.isEmptyStatement(statement)) return true;
  // Leftover "unused parameter" silencers: `void x;` or `console.log(x);`
  if (ts.isExpressionStatement(statement)) {
    const expr = statement.expression;
    if (ts.isVoidExpression(expr)) return true;
    return ts.isCallExpression(expr) && isConsoleCall(expr, /^(log|debug|info|warn)$/);
  }
  return isFakeDelay(statement);
}

/** Statements in a block, counting those in nested blocks and unbraced branches. */
function statementCount(block: ts.Block): number {
  let count = 0;
  const countBranch = (branch: ts.Statement | undefined) => {
    if (branch !== undefined && !ts.isBlock(branch)) count++;
  };
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isBlock(node) || ts.isCaseOrDefaultClause(node)) count += node.statements.length;
    if (ts.isIfStatement(node)) {
      countBranch(node.thenStatement);
      countBranch(node.elseStatement);
    }
    if (ts.isIterationStatement(node, false) || ts.isLabeledStatement(node)) countBranch(node.statement);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(block, visit);
  return count + block.statements.length;
}

/**
 * A body that only logs or waits and then reports success, in a function
 * that takes input: `console.log('Sending email to', to); return true;`.
 */
function isFakeWork(node: ts.FunctionLikeDeclaration, statements: ts.NodeArray<ts.Statement>): boolean {
  if (node.parameters.length === 0 || statements.length < 2 || statements.length > 3) return false;
  const last = statements[statements.length - 1];
  if (!ts.isReturnStatement(last) || !isMeaningfulConstant(last.expression)) return false;
  return statements.slice(0, -1).every(statement => isFakeDelay(statement) ||
    (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
      isConsoleCall(statement.expression, /^(log|debug|info|warn)$/)));
}

/** The outermost functions nested in a body. Their comments describe them, not the body. */
function nestedFunctions(body: ts.Block): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) found.push(node);
    else ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

function isConsoleCall(call: ts.CallExpression, methods: RegExp): boolean {
  const callee = call.expression;
  return ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'console' &&
    methods.test(callee.name.text);
}

/** `[]`, `{}` or `''`: a result a caller cannot tell apart from "nothing found". */
function isEmptyResult(expr: ts.Expression | undefined): boolean {
  if (expr === undefined) return false;
  const inner = unwrapExpression(expr);
  if (ts.isArrayLiteralExpression(inner)) return inner.elements.length === 0;
  if (ts.isObjectLiteralExpression(inner)) return inner.properties.length === 0;
  return (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) && inner.text === '';
}

/** One or more console calls, optionally followed by `return []`, `return {}` or `return ''`. */
function isLogOnlyCatch(statements: ts.NodeArray<ts.Statement>): boolean {
  const last = statements.at(-1);
  const logs = last !== undefined && ts.isReturnStatement(last) && isEmptyResult(last.expression)
    ? statements.slice(0, -1)
    : statements;
  return logs.length > 0 && logs.every(statement => ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) && isConsoleCall(statement.expression, /^(log|debug|info|warn|error|trace)$/));
}

function isFunctionWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.Block } {
  return (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)) &&
    node.body !== undefined && ts.isBlock(node.body);
}

/**
 * `Query<any, any, any>`: every type argument erased to any. This is the usual
 * way to say "some instantiation of this generic" (TypeScript has no
 * existential types), not a missing type.
 */
function isErasedGenericArgument(node: ts.Node): boolean {
  const parent = node.parent;
  if (!ts.isTypeReferenceNode(parent) && !ts.isExpressionWithTypeArguments(parent)) return false;
  const args = parent.typeArguments ?? [];
  return args.length >= 2 && args.every(arg => arg.kind === ts.SyntaxKind.AnyKeyword);
}

/** True when the `any` keyword sits in a generic constraint/default or a conditional type's `extends` clause. */
function isAnyInTypeLevelPattern(node: ts.Node): boolean {
  let child: ts.Node = node;
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isTypeParameterDeclaration(current)) return true;
    if (ts.isConditionalTypeNode(current) && child === current.extendsType) return true;
    if (ts.isInferTypeNode(current)) return true;
    if (!ts.isTypeNode(current) && !ts.isParameter(current) && !ts.isTypeElement(current) &&
      !ts.isTypeParameterDeclaration(current)) {
      return false;
    }
    child = current;
    current = current.parent;
  }
  return false;
}

function rangeContains(outer: ts.Node, pos: number): boolean {
  return pos >= outer.pos && pos < outer.end;
}

/** Name bound to a fetch() response, for `const res = await fetch()` / `.then(res => ...)`. */
function isFetchCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'fetch';
  return ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'fetch' &&
    ts.isIdentifier(callee.expression) &&
    (callee.expression.text === 'window' || callee.expression.text === 'globalThis' || callee.expression.text === 'self');
}

const BODY_READERS = new Set(['json', 'text', 'blob', 'arrayBuffer', 'formData', 'bytes']);

function unwrapAwait(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/**
 * Inspect how a response identifier is used inside `scope`.
 * Status is "checked" if `.ok`/`.status` is read or the response is handed to
 * another function (which may check it). Logging the response, or its
 * status, is not a check.
 */
function responseUsage(scope: ts.Node, name: string): { readsBody: ts.Node | undefined; checked: boolean } {
  let readsBody: ts.Node | undefined;
  let checked = false;
  const visit = (node: ts.Node, inConsole: boolean) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      const member = node.name.text;
      if (!inConsole && (member === 'ok' || member === 'status')) checked = true;
      if (BODY_READERS.has(member) && ts.isCallExpression(node.parent) && node.parent.expression === node) {
        readsBody = readsBody ?? node.parent;
      }
    }
    // Handing the response to another function may check it; logging it does not.
    if (ts.isCallExpression(node) && !isConsoleCall(node, /./) &&
      node.arguments.some(arg => ts.isIdentifier(arg) && arg.text === name)) {
      checked = true;
    }
    if (ts.isReturnStatement(node) && node.expression !== undefined && ts.isIdentifier(node.expression) && node.expression.text === name) {
      checked = true;
    }
    // const { ok, status } = res
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined && ts.isIdentifier(node.initializer) &&
      node.initializer.text === name && ts.isObjectBindingPattern(node.name) &&
      node.name.elements.some(element => {
        const key = element.propertyName ?? element.name;
        return ts.isIdentifier(key) && (key.text === 'ok' || key.text === 'status');
      })) {
      checked = true;
    }
    const childInConsole = inConsole || (ts.isCallExpression(node) && isConsoleCall(node, /./));
    ts.forEachChild(node, child => visit(child, childInConsole));
  };
  visit(scope, false);
  return { readsBody, checked };
}

/** True when the file declares its own binding with this name (variable, function, parameter or import). */
function declaresName(sourceFile: ts.SourceFile, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isParameter(node) ||
      ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)) &&
      node.name !== undefined && ts.isIdentifier(node.name) && node.name.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** `catch (_)` or `.catch((_error) => {})`: the underscore is the usual way to say "unused on purpose". */
function isIgnoredBinding(name: ts.BindingName | undefined): boolean {
  return name !== undefined && ts.isIdentifier(name) && name.text.startsWith('_');
}

/** A `return` in this node or below it, not in a nested function. */
function containsReturn(root: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found || ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

/**
 * `try { return parse(x); } catch {}` followed by more code: the catch falls
 * through to a fallback (the code after the try, or the next loop iteration),
 * so the error is handled by design rather than swallowed. When the return is
 * only a fast path inside the try, the code after it must end in a return or
 * throw, so a conditional return or an unrelated statement after the try is
 * not taken for a fallback.
 */
function isFallbackCatch(clause: ts.CatchClause): boolean {
  const tryStatement = clause.parent;
  if (assignsOnlyOuterVariables(tryStatement)) return true;
  const last = tryStatement.tryBlock.statements.at(-1);
  const endsWithReturn = last !== undefined && ts.isReturnStatement(last);
  if (!endsWithReturn && !containsReturn(tryStatement.tryBlock)) return false;
  let current: ts.Node = tryStatement;
  while (!ts.isFunctionLike(current.parent) && !ts.isSourceFile(current)) {
    const parent = current.parent;
    if (endsWithReturn && ts.isIterationStatement(parent, false)) return true;
    if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isCaseOrDefaultClause(parent)) {
      const rest = parent.statements.slice(parent.statements.findIndex(statement => statement === current) + 1);
      const after = rest.at(-1);
      if (after !== undefined && (endsWithReturn || ts.isReturnStatement(after) || ts.isThrowStatement(after))) return true;
    }
    current = parent;
  }
  return false;
}

/**
 * `let found = fallback; try { found = probe(); } catch {}` and then a read of
 * `found`: the value the variable already holds is the fallback, the same as
 * a return after the try.
 */
function assignsOnlyOuterVariables(tryStatement: ts.TryStatement): boolean {
  const statements = tryStatement.tryBlock.statements;
  if (statements.length === 0) return false;
  const scope = enclosingFunctionOrFile(tryStatement);
  return statements.every(statement => {
    if (!ts.isExpressionStatement(statement)) return false;
    const expr = statement.expression;
    if (!ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isIdentifier(expr.left)) return false;
    const name = expr.left.text;
    return declaresBefore(scope, name, tryStatement) && readsAfter(scope, name, tryStatement.end);
  });
}

/** A `let`/`var` declaration of `name` in `scope`, before `tryStatement` and in a block that contains it. */
function declaresBefore(scope: ts.Node, name: string, tryStatement: ts.TryStatement): boolean {
  const pos = tryStatement.pos;
  let found = false;
  const visit = (node: ts.Node) => {
    if (found || node.pos >= pos) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.end <= pos &&
      ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) === 0 &&
      rangeContains(node.parent.parent.parent, tryStatement.pos)) {
      found = true;
      return;
    }
    if (node !== scope && ts.isFunctionLike(node)) return;
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

/** The identifier reads a variable: not a property name, a declared name or the target of `=`. */
function isVariableRead(node: ts.Identifier): boolean {
  const parent = node.parent;
  if ((ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isQualifiedName(parent) && parent.right === node)) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) ||
    ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent)) && parent.name === node) return false;
  return !isAssignmentTarget(node);
}

/** `x = …`, or `x` inside a destructuring target: `({ x } = src)`, `[x] = pair`. */
function isAssignmentTarget(node: ts.Identifier): boolean {
  let child: ts.Node = node;
  let parent = node.parent;
  // `({ a = x } = src)` reads x as a default, so only the shorthand's name is a target.
  while ((ts.isShorthandPropertyAssignment(parent) && parent.name === child) || ts.isSpreadAssignment(parent) || ts.isSpreadElement(parent) ||
    (ts.isPropertyAssignment(parent) && parent.initializer === child) ||
    ts.isObjectLiteralExpression(parent) || ts.isArrayLiteralExpression(parent)) {
    child = parent;
    parent = parent.parent;
  }
  return ts.isBinaryExpression(parent) && parent.left === child && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
}

/** The binding declares `name`: `x`, `{ x }`, `[, x]`. */
function bindsName(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(element => !ts.isOmittedExpression(element) && bindsName(element.name, name));
}

/**
 * A read of `name` in `scope` after `pos`. An assignment target does not
 * count, and neither does code after `pos` that declares its own `name`.
 */
function readsAfter(scope: ts.Node, name: string, pos: number): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found || node.end <= pos) return;
    if (node !== scope && node.pos >= pos && declaresOwn(node, name)) return;
    if (ts.isIdentifier(node) && node.text === name && node.pos >= pos && isVariableRead(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

/** The node opens a scope with its own `name`: a parameter, a catch binding, a loop or block `let`/`const`, a function-body `var`. */
function declaresOwn(node: ts.Node, name: string): boolean {
  const declares = (list: ts.VariableDeclarationList) => list.declarations.some(declaration => bindsName(declaration.name, name));
  if (ts.isFunctionLike(node)) return node.parameters.some(parameter => bindsName(parameter.name, name));
  if (ts.isCatchClause(node)) return node.variableDeclaration !== undefined && bindsName(node.variableDeclaration.name, name);
  if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
    const init = node.initializer;
    return init !== undefined && ts.isVariableDeclarationList(init) && (init.flags & ts.NodeFlags.BlockScoped) !== 0 && declares(init);
  }
  if (ts.isBlock(node)) {
    const functionBody = ts.isFunctionLike(node.parent);
    return node.statements.some(statement => ts.isVariableStatement(statement) &&
      (functionBody || (statement.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0) && declares(statement.declarationList));
  }
  return false;
}

function enclosingFunctionOrFile(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return current;
    current = current.parent;
  }
  return node.getSourceFile();
}

export interface AnalyzeOptions {
  isTestFile: boolean;
  isCliFile: boolean;
}

/**
 * Run every syntax-level rule on one file, including the unsafe-cast rules
 * from findUnsafeAssertions (TypeScript files only). Test-file skips and severity
 * overrides are applied by the caller. There is deliberately no inline
 * suppression comment: the only way to silence a rule is a reviewed
 * severityOverrides entry in .karpesloprc.json.
 */
export function analyzeSource(sourceText: string, fileName: string): Finding[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
  const comments = collectComments(sourceFile);
  const findings: Finding[] = [];
  const isTypeScript = isTypeScriptFile(fileName);

  const positionOf = (pos: number) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
    return { line: line + 1, column: character + 1 };
  };
  const snippet = (node: ts.Node, max = 120) => {
    const text = sourceText.slice(node.getStart(sourceFile), node.end).replace(/\s+/g, ' ');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const report = (type: string, node: ts.Node, extra: Partial<Finding> = {}) => {
    findings.push({ type, ...positionOf(node.getStart(sourceFile)), code: snippet(node), ...extra });
  };
  const reportComment = (type: string, comment: CommentInfo) => {
    findings.push({ type, line: comment.line, column: comment.column, code: comment.raw.split('\n')[0].trim() });
  };

  // Comments are sorted by position, so the ones inside a node are a contiguous slice.
  const commentsWithin = (node: ts.Node): CommentInfo[] => {
    let low = 0;
    let high = comments.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (comments[mid].pos <= node.pos) low = mid + 1;
      else high = mid;
    }
    const inside: CommentInfo[] = [];
    for (let index = low; index < comments.length && comments[index].end < node.end; index++) {
      inside.push(comments[index]);
    }
    return inside;
  };

  // Comments that sit inside a placeholder body are reported once, as the placeholder.
  const placeholderBodies: ts.Block[] = [];
  const anyLines = new Set<number>();
  const fetchIsShadowed = declaresName(sourceFile, 'fetch');

  const visit = (node: ts.Node) => {
    if (isFunctionWithBody(node)) {
      const body = node.body;
      const nested = nestedFunctions(body);
      const inner = commentsWithin(body).filter(c => !nested.some(fn => fn.pos <= c.pos && c.end <= fn.end));
      const statements = body.statements;
      const allTrivial = statements.length <= 2 && statements.every(isTrivialStatement);
      const commentSaysPlaceholder = inner.some(c => PLACEHOLDER_COMMENT.test(c.body));
      const commentSaysStandIn = inner.some(c => STAND_IN_COMMENT.test(c.body));
      const throwsNotImplemented = statements.length === 1 && isNotImplementedThrow(statements[0]);
      if ((commentSaysPlaceholder && allTrivial) || (commentSaysStandIn && statementCount(body) <= 3) ||
        throwsNotImplemented || isFakeWork(node, statements)) {
        placeholderBodies.push(body);
        const anchor = node.name ?? node;
        findings.push({
          type: 'placeholder_implementation',
          ...positionOf(anchor.getStart(sourceFile)),
          code: snippet(node, 100)
        });
      }
    }

    if (ts.isCatchClause(node) && node.block.statements.length === 0 &&
      commentsWithin(node.block).length === 0 && !isFallbackCatch(node) && !isIgnoredBinding(node.variableDeclaration?.name)) {
      report('empty_catch', node);
    }

    // catch (error) { console.error('Failed', error); } and nothing else, or
    // followed by `return []`: an empty result reads as success to the caller.
    // A catch that returns never reaches the code after the try, so that code is no fallback.
    if (ts.isCatchClause(node) && isLogOnlyCatch(node.block.statements) &&
      commentsWithin(node.block).length === 0 &&
      (ts.isReturnStatement(node.block.statements[node.block.statements.length - 1]) || !isFallbackCatch(node))) {
      report('swallowed_error', node);
    }

    // promise.catch(() => {})
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'catch' && node.arguments.length === 1) {
      const handler = node.arguments[0];
      if ((ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) && ts.isBlock(handler.body) &&
        handler.body.statements.length === 0 &&
        commentsWithin(handler.body).length === 0 && !isIgnoredBinding(handler.parameters[0]?.name)) {
        report('empty_catch', node.expression.name);
      }
    }

    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !ts.isJsxAttribute(node.parent) &&
      !ts.isImportDeclaration(node.parent) && !ts.isExportDeclaration(node.parent) &&
      !ts.isLiteralTypeNode(node.parent)) {
      const value = node.text.trim();
      if (isSecretFallback(node)) {
        report('placeholder_value', node, {
          message: 'Secret falls back to a hard-coded value when the environment variable is not set.',
          fix: 'Fail at startup when the variable is missing instead of using a default.'
        });
      } else if (PLACEHOLDER_VALUE_PATTERNS.some(pattern => pattern.test(value)) || (EXAMPLE_URL.test(value) && isStoredValue(node))) {
        report('placeholder_value', node);
      }
    }

    if (node.kind === ts.SyntaxKind.AnyKeyword && isTypeScript && !isAnyInTypeLevelPattern(node) &&
      !isAssertion(node.parent) && !isErasedGenericArgument(node)) {
      // One finding per line: `(data: any) => any` is one decision, not two.
      const { line } = positionOf(node.getStart(sourceFile));
      if (!anyLines.has(line)) {
        anyLines.add(line);
        report('any_type_usage', node);
      }
    }

    // Unsafe casts come from findUnsafeAssertions; every other cast is reported here.
    if (isCast(node) && isTypeScript && !isInnerOfChain(node) &&
      classifyCast(node).every(cast => cast.type === 'type_assertion')) {
      report('type_assertion', node);
    }

    if (ts.isNonNullExpression(node) && isTypeScript) {
      report('non_null_assertion', node);
    }

    if (ts.isCallExpression(node) && isConsoleCall(node, /^(log|debug|info|trace|dir|table)$/)) {
      report('production_console_log', node.expression);
    }

    if (isFetchCall(node) && !(fetchIsShadowed && ts.isIdentifier(node.expression))) {
      checkFetchResponse(node);
    }

    ts.forEachChild(node, visit);
  };

  const checkFetchResponse = (call: ts.CallExpression) => {
    // `await (await fetch(url)).json()` — the body is read with no chance to check status.
    let outer: ts.Node = call;
    while (ts.isAwaitExpression(outer.parent) || ts.isParenthesizedExpression(outer.parent)) {
      outer = outer.parent;
    }
    const parent = outer.parent;
    if (ts.isPropertyAccessExpression(parent) && BODY_READERS.has(parent.name.text)) {
      report('unchecked_fetch_response', call);
      return;
    }

    // const res = await fetch(url); ... res.json()
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.initializer !== undefined &&
      unwrapAwait(parent.initializer) === call) {
      const usage = responseUsage(enclosingFunctionOrFile(parent), parent.name.text);
      if (usage.readsBody !== undefined && !usage.checked) report('unchecked_fetch_response', call);
      return;
    }

    // fetch(url).then(res => res.json())
    if (ts.isPropertyAccessExpression(parent) && parent.name.text === 'then' &&
      ts.isCallExpression(parent.parent) && parent.parent.arguments.length > 0) {
      const handler = parent.parent.arguments[0];
      if ((ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) && handler.parameters.length > 0) {
        const param = handler.parameters[0].name;
        if (ts.isIdentifier(param)) {
          const usage = responseUsage(handler.body, param.text);
          if (usage.readsBody !== undefined && !usage.checked) report('unchecked_fetch_response', call);
        }
      }
    }
  };

  visit(sourceFile);

  // Comment rules
  for (let index = 0; index < comments.length; index++) {
    const comment = comments[index];
    const body = comment.body;
    const inPlaceholder = placeholderBodies.some(block => rangeContains(block, comment.pos));
    const nextIsComment = index + 1 < comments.length && comments[index + 1].line === comment.line + 1;
    const previousIsComment = index > 0 && comments[index - 1].line === comment.line - 1;

    if (TS_SUPPRESSION.test(body)) {
      reportComment('ts_suppression', comment);
      continue;
    }
    if (BLANKET_ESLINT.test(body)) {
      reportComment('blanket_eslint_disable', comment);
      continue;
    }
    if (DIRECTIVE_COMMENT.test(body)) continue;

    const isDocComment = comment.raw.startsWith('/**');
    const inCommentBlock = nextIsComment || previousIsComment;
    if (!isDocComment && (ELIDED_COMMENT.test(body) || (!inCommentBlock && ELIDED_ELLIPSIS.test(body)))) {
      reportComment('elided_code_comment', comment);
      continue;
    }
    if (!inPlaceholder && TODO_COMMENT.test(body) && !TRACKED_REFERENCE.test(body)) {
      reportComment('todo_comment', comment);
      continue;
    }
    // A hedge that links the issue it is about is documented, not unverified.
    if (HEDGING_COMMENT.test(body) && !TRACKED_REFERENCE.test(body)) {
      reportComment('hedging_comment', comment);
      continue;
    }
    if (isFillerComment(comment, new Set(splitWords(lineAfter(sourceFile, comment)).map(stem)))) {
      reportComment('filler_comment', comment);
      continue;
    }

    // A one-line comment on its own line, directly above a single statement,
    // that only repeats words from that statement.
    if (comment.isLineComment && comment.ownLine && !nextIsComment && !previousIsComment &&
      !EXPLAINING_WORDS.test(body) && isRestatingComment(sourceFile, comment)) {
      reportComment('restating_comment', comment);
    }
  }

  if (isTypeScript && !fileName.endsWith('.d.ts')) {
    for (const cast of unsafeAssertionsIn(sourceFile, fileName)) {
      findings.push({ type: cast.type, line: cast.line, column: cast.column, code: cast.code });
    }
  }

  return findings;
}

/** The code after a comment: the rest of its line, or the next non-blank line. */
function lineAfter(sourceFile: ts.SourceFile, comment: CommentInfo): string {
  const rest = sourceFile.text.slice(comment.end);
  return rest.split('\n').find(line => line.trim() !== '')?.trim() ?? '';
}

function isRestatingComment(sourceFile: ts.SourceFile, comment: CommentInfo): boolean {
  // One word (`// Imports`, `// ZodEmail`) is a section label, and code
  // (`// init(inst, def);`) is commented out; neither restates the next line.
  if (comment.body.split(/\s+/).filter(token => /\w/.test(token)).length < 2 || /[;{}=]|\w\(/.test(comment.body)) return false;
  const words = splitWords(comment.body);
  if (words.length > 6) return false;
  const content = words.filter(word => !RESTATING_STOPWORDS.has(word));
  if (content.length === 0) return false;

  const nextLineIndex = comment.line; // 0-based index of the following line
  if (nextLineIndex >= sourceFile.getLineStarts().length) return false;
  const start = sourceFile.getLineStarts()[nextLineIndex];
  const end = nextLineIndex + 1 < sourceFile.getLineStarts().length
    ? sourceFile.getLineStarts()[nextLineIndex + 1]
    : sourceFile.text.length;
  const nextLine = sourceFile.text.slice(start, end).trim();
  if (nextLine === '' || nextLine.startsWith('//') || nextLine.startsWith('/*') || nextLine === '}') return false;

  const codeWords = new Set(splitWords(nextLine).map(stem));
  return content.every(word => codeWords.has(stem(word)));
}
