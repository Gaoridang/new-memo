const TIMEOUT_MS = 4000;

/**
 * 메모 한 줄이 할 일인지 서버(src/app/api/todo+api.ts)에 묻는다.
 * 네트워크나 서버 문제로 판단하지 못하면 null — 그 줄은 그냥 두면 된다.
 */
export async function detectTodo(title: string, line: string): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('/api/todo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, line }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.isTodo === 'boolean' ? data.isTodo : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
