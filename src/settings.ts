import { File, Paths } from 'expo-file-system';

export type Settings = {
  // 할 일 자동 감지. 메모 내용을 외부로 보내므로 기본은 꺼 두고, 켤 때 한 번 동의를 받는다.
  autoTodo: boolean;
  autoTodoConsented: boolean;
  // 뜻으로 찾기는 검색할 때 메모 내용을 보내므로 처음 한 번 동의를 받는다.
  searchConsented: boolean;
};

const SETTINGS_FILE = 'settings.json';
const DEFAULTS: Settings = { autoTodo: false, autoTodoConsented: false, searchConsented: false };

export function loadSettings(): Settings {
  try {
    const file = new File(Paths.document, SETTINGS_FILE);
    if (!file.exists) return DEFAULTS;
    const data = JSON.parse(file.textSync());
    return {
      autoTodo: data.autoTodo === true,
      autoTodoConsented: data.autoTodoConsented === true,
      searchConsented: data.searchConsented === true,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(patch: Partial<Settings>) {
  try {
    const next = { ...loadSettings(), ...patch };
    new File(Paths.document, SETTINGS_FILE).write(JSON.stringify(next));
  } catch (error) {
    console.warn('설정을 저장하지 못했습니다.', error);
  }
}
