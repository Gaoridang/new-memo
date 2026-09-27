import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { isDoodleStyle, type DoodleStyle } from './doodles/presets';
import { DEFAULT_TOOLBAR, readToolbar, type ToolbarItem } from './toolbar';

export type Settings = {
  // 할 일 자동 감지. 메모 내용을 외부로 보내므로 기본은 꺼 두고, 켤 때 한 번 동의를 받는다.
  autoTodo: boolean;
  autoTodoConsented: boolean;
  // 뜻으로 찾기는 검색할 때 메모 내용을 보내므로 처음 한 번 동의를 받는다.
  searchConsented: boolean;
  // 두들은 메모 내용을 보내므로 처음 쓸 때 한 번 동의를 받는다. 그림 세트는 설정 화면에서 고른다.
  doodleStyle: DoodleStyle;
  doodlesConsented: boolean;
  // 설정 화면에서 고친 툴바 배치. null이면 기본 배치를 쓴다. (나중에 기본 배치가 바뀌면 따라간다)
  toolbar: ToolbarItem[] | null;
};

const SETTINGS_FILE = 'settings.json';
const DEFAULTS: Settings = {
  autoTodo: false,
  autoTodoConsented: false,
  searchConsented: false,
  doodleStyle: 'pastel',
  doodlesConsented: false,
  toolbar: null,
};

function readSettings(): Settings {
  try {
    const file = new File(Paths.document, SETTINGS_FILE);
    if (!file.exists) return DEFAULTS;
    const data = JSON.parse(file.textSync());
    return {
      autoTodo: data.autoTodo === true,
      autoTodoConsented: data.autoTodoConsented === true,
      searchConsented: data.searchConsented === true,
      doodleStyle: isDoodleStyle(data.doodleStyle) ? data.doodleStyle : DEFAULTS.doodleStyle,
      doodlesConsented: data.doodlesConsented === true,
      toolbar: readToolbar(data.toolbar),
    };
  } catch {
    return DEFAULTS;
  }
}

// 파일은 처음 한 번만 읽고, 바꿀 때마다 저장하면서 화면들에 알린다.
let current: Settings | null = null;
const listeners = new Set<() => void>();

export function loadSettings(): Settings {
  current ??= readSettings();
  return current;
}

export function saveSettings(patch: Partial<Settings>) {
  current = { ...loadSettings(), ...patch };
  try {
    new File(Paths.document, SETTINGS_FILE).write(JSON.stringify(current));
  } catch (error) {
    console.warn('설정을 저장하지 못했습니다.', error);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 설정이 바뀌면 다시 그린다. 설정 화면에서 바꾼 것이 그 아래 열려 있는 메모에도 바로 보인다. */
export function useSettings() {
  return useSyncExternalStore(subscribe, loadSettings);
}

export function toolbarLayout(settings: Settings): readonly ToolbarItem[] {
  return settings.toolbar ?? DEFAULT_TOOLBAR;
}
