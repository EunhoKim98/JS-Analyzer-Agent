import { SinkRecord } from '../types';

export const ANALYZE_SYSTEM = `You are a client-side JavaScript security analyzer running one OODA round on a single candidate sink.
A deterministic static pass already located the sink and a nearby source; your job is to judge exploitability from the code slice.
Rules:
- Observe the slice, Orient (which vuln class + why), Decide (does untrusted input reach the sink without effective sanitization?), Act (emit the finding).
- If evidence is insufficient or ambiguous, use verdict "uncertain" rather than guessing.
- A "sanitizer" must be effective for THIS sink's context (e.g. textContent/DOMPurify for HTML; encodeURIComponent does NOT stop DOM-XSS in an HTML context).
- Public client-side keys (e.g. Stripe publishable pk_, Firebase config) are NOT vulnerabilities.
- Provide a non-destructive PoC when you can (canary payload, GET only). Never propose state-changing requests.
Return ONLY JSON, no prose.`;

export function analyzeUser(sink: SinkRecord, slice: string, ruleSummary: string): string {
  return `Candidate sink (from static pre-pass):
${JSON.stringify(
    {
      class: sink.class,
      api: sink.sink.api,
      file: sink.sink.file,
      line: sink.sink.line,
      source: sink.source,
      sanitizer: sink.sanitizer,
      path_grade: sink.path_grade,
    },
    null,
    2,
  )}

Rule card (class definition):
${ruleSummary}

Code slice (line ${sink.sink.line} is the sink):
\`\`\`javascript
${slice}
\`\`\`

Return JSON:
{
  "verdict": "vulnerable" | "not_vulnerable" | "uncertain",
  "confidence": 0.0-1.0,
  "taint_path": ["source", "...", "sink"],
  "assumed_input": "example attacker input (optional)",
  "poc": { "type": "browser"|"http"|"url", "payload": "...", "target": "optional", "expected": "...", "destructive": false } | null,
  "reasoning": "one or two sentences"
}`;
}

export const JUDGE_SYSTEM = `You are an independent false-positive judge for client-side JS security findings.
You did NOT produce this finding; a different agent did. Be skeptical.
Decide only whether the finding is genuinely exploitable given the slice. Default to not-exploitable if the source cannot actually reach the sink, or an effective sanitizer is present, or the value is not attacker-controlled.
Return ONLY JSON, no prose.`;

export function judgeUser(finding: unknown, slice: string): string {
  return `Finding to judge:
${JSON.stringify(finding, null, 2)}

Code slice:
\`\`\`javascript
${slice}
\`\`\`

Return JSON:
{ "exploitable": true | false, "reason": "one sentence" }`;
}
