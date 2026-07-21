// 순수 유틸리티 — 상태·의존성이 없으므로 클래스가 아니라 함수로 유지한다.
// (OOP 원칙: "서비스는 객체로, 순수 변환은 함수로". 모든 것을 클래스로 감싸지 않는다.)

// Bounded-concurrency map: run `fn` over `items` with at most `limit` in flight.
export async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (x: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        await fn(items[idx], idx);
      }
    }),
  );
}
