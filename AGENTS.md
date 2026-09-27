This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation (`main` is `expo-router/entry`). Routes live in `src/app/` — every file there is a screen. `src/app/_layout.tsx` is a header-less native `Stack`: the `(memo)` group at the bottom, the settings screen pushed over it. `src/app/(memo)/_layout.tsx` renders the current memo route in a `Slot` inside `MemoDrawer` (`src/MemoDrawer.tsx`, a react-native-gesture-handler pan driving Reanimated): the memo list lies under the memo, and swiping the memo right reveals it while ~76pt of the memo stays visible. Taps open/close with a timing curve; a released swipe settles with a critically damped spring that keeps the finger's velocity. Keep non-route code (components, hooks, storage) in `src/` outside `src/app/`.
  - `src/app/(memo)/index.tsx` — redirects to the most recent memo (or a new one)
  - `src/app/(memo)/memo/[id].tsx` — editor for one memo, keyed by `id`; picking a memo in the list, or the new-memo button (list header or memo header), does `router.replace` and closes the drawer. New memos open unfocused; the keyboard only comes up when the user taps a field.
  - `src/app/settings.tsx` — app settings (`src/SettingsScreen.tsx`), opened from the gear in the memo list header: the keyboard toolbar layout, edited by drag and drop in a preview drawn like the real bar (`src/ToolbarEditor.tsx`, state in `src/toolbarEditing.ts`), and the doodle art style (pastel / sticker). Changes stay a draft until the floating 저장 button saves them; leaving with unsaved changes asks first, and swipe-back is off meanwhile. Settings live in `settings.json` (`src/settings.ts`; `useSettings()` re-renders on change); a toolbar layout equal to the default is stored as `null` so later default changes still apply.
  - `src/app/api/*+api.ts` — server routes (API routes, `web.output: "server"`) that ask Jev (TypeSafe AI). Shared call helper and date logic live in `src/server/` (imported only by API routes). Needs `TYPESAFE_API_KEY` in `.env.local` (server-only; never `EXPO_PUBLIC_`). Restart `expo start` after changing it.
    - `todo+api.ts` — is a line a to-do (auto-convert / suggest only) and its due date
    - `due+api.ts` — due date of a line that is already a to-do (checkboxes the user made or edited, pasted to-dos)
    - `structure+api.ts` — list/step/to-do shape of each pasted line
    - `search+api.ts` — which memo line answers a question
    - `doodle+api.ts` — which word in a line gets a doodle, and which one (catalog in `src/doodles/catalog.ts`; art and style sets in `src/doodles/art.ts`, `presets.ts`)
- Import `router`, `Slot`, and `useLocalSearchParams` from `expo-router`. The app root is wrapped in `GestureHandlerRootView` (the drawer uses react-native-gesture-handler). Docs: https://docs.expo.dev/router/introduction.md

## Editor & keyboard

The memo body is a native editor (`modules/memo-editor`, `MemoEditor` in `src/MemoScreen.tsx`); the format bar floats over it and the body text shows around it.

- iOS: the format bar (and toast) is the keyboard's `inputAccessoryView`. The body reaches the bottom of the screen and never resizes for the keyboard: `MemoEditorView.swift` sets its own bottom `contentInset` from `keyboardWillChangeFrame` and scrolls the caret with the keyboard's curve. Don't add a JS spacer that resizes the body with the keyboard — it relayouts every frame during interactive dismissal and leaves a blank band behind the bar.
- iOS: RN's `InputAccessoryView` pins its content to its own safe area, so the bar's height followed its bottom safe-area inset. Dragging the keyboard down slowly until the bar straddled the home-indicator inset made height and position feed each other, and the keyboard window's layout never finished: the app froze with the keyboard stuck. `MemoTextView.swift` (`AccessoryLayout`) re-pins that content to the view's edges the first time it finds the bar, and leaves the home-indicator space as a fixed inset only when the bar is docked alone at the bottom (hardware keyboard), decided from keyboard notifications. Keep the bar's height independent of its safe area.
- Android: the format bar is a JS view that follows the keyboard frame by frame (react-native-keyboard-controller). A spacer under the body follows the keyboard too, and the bar's space is the body's bottom padding (`insetBottom`), which `MemoEditText` also draws text into so it shows behind the bar.

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
