// Jev(TypeSafe AI) 호출. API 라우트(src/app/api)에서만 가져다 쓴다 — API 키는 서버에서만 읽는다.
const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
// 각 라우트의 기준값을 이 버전에 맞춰 골랐다. 버전을 올릴 때는 다시 확인한다.
const JEV_MODEL = 'jev-1.13.0';

export type JevAnswer = {
  type: 'noul' | 'choice' | 'score';
  noul?: number;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

export function jevConfigured() {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

// 앱이 붙여 보내는 헤더. 앱 안에 들어 있는 값이라 완전한 비밀은 아니지만, 주소만 알고 부르는 호출은 막는다.
export const APP_TOKEN_HEADER = 'x-app-token';

/** 앱에서 온 요청인지 확인한다. 실패하면 돌려줄 응답, 통과하면 null. */
export function rejectUnlessApp(request: Request): Response | null {
  const token = process.env.EXPO_PUBLIC_APP_TOKEN;
  if (!token) return null; // 토큰을 설정하지 않은 개발 환경
  if (request.headers.get(APP_TOKEN_HEADER) === token) return null;
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}

/** 한 번의 요청으로 모든 질문을 묻는다. 실패하면 null. */
export async function askJev(
  state: unknown,
  questions: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, JevAnswer> | null> {
  try {
    const response = await fetch(JEV_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.answers && typeof data.answers === 'object' ? data.answers : null;
  } catch {
    return null;
  }
}

/** 줄마다 짧은 ID를 붙인다. 배열 순번보다 ID로 가리켜야 Jev가 줄을 헷갈리지 않는다. */
export function lineId(index: number) {
  return `L${String(index).padStart(3, '0')}`;
}

export function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  return (Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLength))
    .slice(0, maxItems);
}
