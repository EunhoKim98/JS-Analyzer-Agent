// 코드 슬라이스 추출기 — 싱크 주변의 작은 코드 조각을 LLM 프롬프트용으로 잘라낸다.
// 슬라이싱 정책(문맥 줄 수, 문자·줄 길이 상한)을 한곳에 캡슐화한다(SRP).
export class CodeSlicer {
  constructor(
    private readonly ctx = 6,
    private readonly maxChars = 8000,
    private readonly maxLine = 2000,
  ) {}

  // 미니파이된 파일은 한 줄이 수 MB일 수 있으므로 줄·전체 길이를 모두 제한한다.
  // (실제 버그: ±6줄 슬라이스가 chzzk 번들에서 1.6M 토큰까지 폭증한 적이 있다.)
  around(code: string, line: number): string {
    const lines = code.split('\n');
    const start = Math.max(0, line - 1 - this.ctx);
    const end = Math.min(lines.length, line + this.ctx);
    const numbered = lines.slice(start, end).map((l, i) => {
      const capped = l.length > this.maxLine ? l.slice(0, this.maxLine) + ' /*…line truncated…*/' : l;
      return `${start + i + 1}: ${capped}`;
    });
    const slice = numbered.join('\n');
    return slice.length > this.maxChars ? slice.slice(0, this.maxChars) + '\n/*…slice truncated…*/' : slice;
  }
}
