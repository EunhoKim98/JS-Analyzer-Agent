// 순수 유틸 — LLM 응답 텍스트에서 JSON 객체를 뽑아낸다. SDK·CLI provider가 공유한다.
// 코드펜스(```json)나 앞뒤 프로즈가 섞여 있어도 첫 '{'~마지막 '}' 구간을 파싱한다.
export function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  const slice = start >= 0 && end > start ? body.slice(start, end + 1) : body;
  return JSON.parse(slice);
}
