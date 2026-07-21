import { parse } from '@babel/parser';
import _traverse, { Scope } from '@babel/traverse';
import * as t from '@babel/types';
import { RuleCard, SinkRecord, SeverityHint, PathGrade } from '../types';

// @babel/traverse ships as CJS with an interop default — normalize it.
const traverse = ((_traverse as any).default || _traverse) as typeof _traverse;

const EVENT_RE = /^(e|ev|evt|event|msg|message|m)$/i;

interface SourceResult { found: boolean; kind?: string; hops: number }
interface SanitizerResult { found: boolean; kind?: string }

// 싱크 탐지기 — 룰 카드에 따라 AST를 순회하며 위험한 싱크·소스·새니타이저를 찾는다.
// 룰 종류별(sink-flow / proto-pollution / postmessage) 카드를 생성자에서 미리 분류해
// 매 순회마다 재필터링하지 않는다(DRY). AST 파싱 실패 시 정규식 폴백으로 커버리지를 유지한다.
export class SinkDetector {
  private readonly sinkFlow: RuleCard[];
  private readonly protoCard?: RuleCard;
  private readonly pmCard?: RuleCard;

  constructor(rules: RuleCard[]) {
    this.sinkFlow = rules.filter((r) => r.detector === 'sink-flow');
    this.protoCard = rules.find((r) => r.detector === 'proto-pollution');
    this.pmCard = rules.find((r) => r.detector === 'postmessage');
  }

  detect(code: string, file: string): SinkRecord[] {
    const ast = parseSafe(code);
    if (!ast) return this.regexFallbackSinks(code, file);

    const lines = code.split('\n');
    const { sinkFlow, protoCard, pmCard } = this;

    const out: SinkRecord[] = [];
    const seen = new Set<string>();
    let counter = 0;

    const push = (
      cls: string,
      api: string,
      node: t.Node,
      src: SourceResult,
      san: SanitizerResult,
      severity: SeverityHint,
    ) => {
      const line = node.loc?.start.line ?? 0;
      const key = `${file}:${line}:${cls}`;
      if (seen.has(key)) return;
      seen.add(key);
      const grade: PathGrade = src.found ? (src.hops > 0 ? 'aliased' : 'direct') : 'sink_only';
      out.push({
        id: `sink_${cls}_${line}_${counter++}`,
        class: cls,
        sink: {
          api,
          file,
          line,
          span: [line, node.loc?.end.line ?? line],
          snippet: sliceSnippet(lines, line),
        },
        source: src.found ? { found: true, kind: src.kind, hops: src.hops } : { found: false },
        sanitizer: san.found ? { found: true, kind: san.kind } : { found: false },
        path_grade: grade,
        severity_hint: severity,
      });
    };

    traverse(ast, {
      // ---- sink-flow: assignments to dangerous properties ----
      AssignmentExpression(path) {
        const left = path.node.left;
        if (!t.isMemberExpression(left) || left.computed || !t.isIdentifier(left.property)) return;
        const prop = left.property.name;
        for (const card of sinkFlow) {
          if (card.sinks?.properties?.includes(prop)) {
            const api = collectMemberPath(left) || `<obj>.${prop}`;
            const src = findSource(path.node.right, path.scope, card, 2, 0);
            const san = findSanitizer(path.node.right, path.scope, card, 2);
            push(card.class, api, path.node, src, san, card.severity);
          }
        }
      },

      // ---- sink-flow: dangerous calls ----
      CallExpression(path) {
        const callee = path.node.callee;
        const args = path.node.arguments;

        for (const card of sinkFlow) {
          // global calls: eval(...), Function(...), or dotted document.write(...)
          const dotted = t.isMemberExpression(callee) ? collectMemberPath(callee) : null;
          const idName = t.isIdentifier(callee) ? callee.name : null;

          if ((idName && card.sinks?.calls?.includes(idName)) ||
              (dotted && card.sinks?.calls?.includes(dotted))) {
            evalArg(card, args[0], path.scope, dotted || idName || 'call', path.node);
          }

          // guarded calls: setTimeout/setInterval only when first arg is string-ish
          if (idName && card.sinks?.guardedCalls?.includes(idName) && isStringish(args[0])) {
            evalArg(card, args[0], path.scope, `${idName}(string)`, path.node);
          }

          // member-name calls: el.insertAdjacentHTML(...), $.html(...)
          if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
            const method = callee.property.name;
            if (card.sinks?.memberCalls?.includes(method)) {
              const arg = method === 'insertAdjacentHTML' ? args[1] : args[0];
              evalArg(card, arg, path.scope, `.${method}()`, path.node);
            }
          }
        }

        // ---- postmessage: addEventListener('message', fn) ----
        if (pmCard && t.isMemberExpression(callee) && t.isIdentifier(callee.property) &&
            callee.property.name === 'addEventListener' &&
            t.isStringLiteral(args[0]) && args[0].value === 'message') {
          const handler = args[1];
          if (isFn(handler) && !checksOrigin(handler)) {
            push(pmCard.class, "addEventListener('message')",
              path.node, { found: true, kind: 'event.data', hops: 0 }, { found: false },
              pmCard.severity);
          }
        }

        // ---- proto-pollution: Object.setPrototypeOf(...) ----
        if (protoCard && t.isMemberExpression(callee) && t.isIdentifier(callee.property) &&
            protoCard.sinks?.calls?.includes(callee.property.name)) {
          push(protoCard.class, `.${callee.property.name}()`, path.node,
            { found: false, hops: 0 }, { found: false }, protoCard.severity);
        }

        function evalArg(card: RuleCard, arg: t.Node | undefined, scope: Scope, api: string, node: t.Node) {
          if (!arg || t.isSpreadElement(arg)) return;
          const src = findSource(arg, scope, card, 2, 0);
          const san = findSanitizer(arg, scope, card, 2);
          push(card.class, api, node, src, san, card.severity);
        }
      },

      // ---- proto-pollution: for..in merge ----
      ForInStatement(path) {
        if (!protoCard) return;
        let flagged = false;
        path.traverse({
          AssignmentExpression(inner) {
            const l = inner.node.left;
            if (t.isMemberExpression(l) && l.computed) flagged = true;
          },
        });
        if (flagged) {
          push(protoCard.class, 'for-in merge', path.node,
            { found: false, hops: 0 }, { found: false }, protoCard.severity);
        }
      },
    });

    // onmessage = fn (separate pass to keep the visitor object clean)
    if (pmCard) {
      traverse(ast, {
        AssignmentExpression(path) {
          const l = path.node.left;
          if (t.isMemberExpression(l) && t.isIdentifier(l.property) && l.property.name === 'onmessage') {
            const handler = path.node.right;
            if (isFn(handler) && !checksOrigin(handler)) {
              push(pmCard.class, 'onmessage handler', path.node,
                { found: true, kind: 'event.data', hops: 0 }, { found: false }, pmCard.severity);
            }
          }
        },
      });
    }

    return out;
  }

  // When AST parse fails entirely (exotic minified syntax), recover coverage with
  // a textual sink scan. Lower precision — everything is sink_only (no taint).
  private regexFallbackSinks(code: string, file: string): SinkRecord[] {
    const lines = code.split('\n');
    const out: SinkRecord[] = [];
    const seen = new Set<string>();
    let c = 0;
    const add = (cls: string, api: string, line: number, sev: SeverityHint) => {
      const key = `${file}:${line}:${cls}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        id: `sink_${cls}_${line}_${c++}`,
        class: cls,
        sink: { api, file, line, span: [line, line], snippet: (lines[line - 1] || '').trim().slice(0, 200) },
        source: { found: false },
        sanitizer: { found: false },
        path_grade: 'sink_only',
        severity_hint: sev,
      });
    };
    const pats: { re: RegExp; cls: string; api: string; sev: SeverityHint }[] = [];
    for (const card of this.sinkFlow) {
      for (const p of card.sinks?.properties || []) pats.push({ re: new RegExp(`\\.${p}\\s*=[^=]`), cls: card.class, api: `.${p}`, sev: card.severity });
      for (const call of card.sinks?.calls || []) pats.push({ re: new RegExp(`(^|[^.\\w])${call.replace(/\./g, '\\.')}\\s*\\(`), cls: card.class, api: call, sev: card.severity });
      for (const m of card.sinks?.memberCalls || []) pats.push({ re: new RegExp(`\\.${m}\\s*\\(`), cls: card.class, api: `.${m}`, sev: card.severity });
    }
    lines.forEach((ln, i) => {
      for (const p of pats) if (p.re.test(ln)) add(p.cls, p.api, i + 1, p.sev);
    });
    console.error(`[ast] ${file}: AST parse failed → regex fallback (${out.length} sinks, sink_only)`);
    return out;
  }
}

// ---------- pure AST helpers (상태 없는 순수 함수 — 클래스로 감싸지 않는다) ----------

function collectMemberPath(node: t.Node): string | null {
  if (t.isIdentifier(node)) return node.name;
  if (t.isThisExpression(node)) return 'this';
  if (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.property)) {
    const obj = collectMemberPath(node.object);
    return obj ? `${obj}.${node.property.name}` : null;
  }
  return null;
}

function isStringish(n?: t.Node): boolean {
  if (!n) return false;
  return t.isStringLiteral(n) || t.isTemplateLiteral(n) || t.isBinaryExpression(n) || t.isIdentifier(n);
}

function isFn(n?: t.Node | null): n is t.FunctionExpression | t.ArrowFunctionExpression {
  return !!n && (t.isFunctionExpression(n) || t.isArrowFunctionExpression(n));
}

function checksOrigin(fn: t.FunctionExpression | t.ArrowFunctionExpression): boolean {
  let found = false;
  walkNode(fn.body, (n) => {
    if (t.isMemberExpression(n) && t.isIdentifier(n.property) && n.property.name === 'origin') {
      found = true;
    }
  });
  return found;
}

// Minimal recursive AST walk (avoids re-traversing nodes owned by the main tree).
function walkNode(node: any, visit: (n: t.Node) => void): void {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const c of val) if (c && typeof c.type === 'string') walkNode(c, visit);
    } else if (val && typeof val.type === 'string') {
      walkNode(val, visit);
    }
  }
}

// Heuristic taint: does `node` derive (within ~2 binding hops) from a source?
function findSource(node: t.Node | null | undefined, scope: Scope, card: RuleCard, hopsLeft: number, depth: number): SourceResult {
  if (!node) return { found: false, hops: depth };
  const sources = card.sources;
  if (!sources) return { found: false, hops: depth };

  if (t.isMemberExpression(node)) {
    const p = collectMemberPath(node);
    if (p && sources.memberPaths?.includes(p)) return { found: true, kind: p, hops: depth };
    // event.data pattern
    if (t.isIdentifier(node.property) && sources.eventProps?.includes(node.property.name) &&
        t.isIdentifier(node.object) && EVENT_RE.test(node.object.name)) {
      return { found: true, kind: `${node.object.name}.${node.property.name}`, hops: depth };
    }
    // recurse into the object (e.g. new URLSearchParams(location.search).get(...))
    const inObj = findSource(node.object, scope, card, hopsLeft, depth);
    if (inObj.found) return inObj;
  }

  if (t.isIdentifier(node) && hopsLeft > 0) {
    const binding = scope.getBinding(node.name);
    if (binding && t.isVariableDeclarator(binding.path.node) && binding.path.node.init) {
      return findSource(binding.path.node.init, binding.scope, card, hopsLeft - 1, depth + 1);
    }
  }

  for (const child of carriers(node)) {
    const r = findSource(child, scope, card, hopsLeft, depth);
    if (r.found) return r;
  }
  return { found: false, hops: depth };
}

function findSanitizer(node: t.Node | null | undefined, scope: Scope, card: RuleCard, hopsLeft: number): SanitizerResult {
  if (!node) return { found: false };
  const calls = card.sanitizers?.calls || [];
  if (calls.length === 0 && !card.sanitizers?.properties?.length) return { found: false };

  if (t.isCallExpression(node)) {
    const dotted = t.isMemberExpression(node.callee) ? collectMemberPath(node.callee) : null;
    const idName = t.isIdentifier(node.callee) ? node.callee.name : null;
    const method = t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.property)
      ? node.callee.property.name : null;
    if ((dotted && calls.includes(dotted)) || (idName && calls.includes(idName)) ||
        (method && calls.includes(method))) {
      return { found: true, kind: dotted || idName || method || 'sanitizer' };
    }
  }

  if (t.isIdentifier(node) && hopsLeft > 0) {
    const binding = scope.getBinding(node.name);
    if (binding && t.isVariableDeclarator(binding.path.node) && binding.path.node.init) {
      return findSanitizer(binding.path.node.init, binding.scope, card, hopsLeft - 1);
    }
  }

  for (const child of carriers(node)) {
    const r = findSanitizer(child, scope, card, hopsLeft);
    if (r.found) return r;
  }
  return { found: false };
}

// Sub-expressions through which taint can carry.
function carriers(node: t.Node): t.Node[] {
  if (t.isCallExpression(node) || t.isNewExpression(node)) {
    return [node.callee, ...node.arguments].filter(Boolean) as t.Node[];
  }
  if (t.isBinaryExpression(node) || t.isLogicalExpression(node)) return [node.left, node.right];
  if (t.isTemplateLiteral(node)) return node.expressions as t.Node[];
  if (t.isConditionalExpression(node)) return [node.consequent, node.alternate];
  if (t.isAwaitExpression(node)) return [node.argument];
  if (t.isParenthesizedExpression(node) || t.isTSNonNullExpression(node)) {
    return [node.expression as t.Node];
  }
  if (t.isSequenceExpression(node)) return node.expressions;
  return [];
}

function sliceSnippet(lines: string[], line: number): string {
  const idx = line - 1;
  const text = (lines[idx] || '').trim();
  return text.length > 200 ? text.slice(0, 200) + '…' : text;
}

// Robust parse: broaden syntax plugins and try each sourceType before giving up.
function parseSafe(code: string): t.File | null {
  const plugins: import('@babel/parser').ParserPlugin[] = [
    'jsx', 'decorators-legacy', 'importAttributes', 'explicitResourceManagement',
    'regexpUnicodeSets', 'exportDefaultFrom',
  ];
  for (const sourceType of ['unambiguous', 'script', 'module'] as const) {
    try {
      return parse(code, { sourceType, errorRecovery: true, plugins });
    } catch {
      /* try next sourceType */
    }
  }
  return null;
}
