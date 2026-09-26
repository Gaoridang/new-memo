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

- Use **Expo Router** for all navigation (`main` is `expo-router/entry`). Routes live in `src/app/` — every file there is a screen. `_layout.tsx` renders the current route in a `Slot` inside `MemoDrawer` (`src/MemoDrawer.tsx`, react-native-drawer-layout): the memo list lies under the memo, and swiping the memo right reveals it while ~76pt of the memo stays visible. Keep non-route code (components, hooks, storage) in `src/` outside `src/app/`.
  - `src/app/index.tsx` — redirects to the most recent memo (or a new one)
  - `src/app/memo/[id].tsx` — editor for one memo, keyed by `id`; picking a memo in the list, or the new-memo button (list header or memo header), does `router.replace` and closes the drawer. New memos open unfocused; the keyboard only comes up when the user taps a field.
  - `src/app/api/*+api.ts` — server routes (API routes, `web.output: "server"`) that ask Jev (TypeSafe AI). Shared call helper and date logic live in `src/server/` (imported only by API routes). Needs `TYPESAFE_API_KEY` in `.env.local` (server-only; never `EXPO_PUBLIC_`). Restart `expo start` after changing it.
    - `todo+api.ts` — is a line a to-do (auto-convert / suggest only) and its due date
    - `due+api.ts` — due date of a line that is already a to-do (checkboxes the user made or edited, pasted to-dos)
    - `structure+api.ts` — list/step/to-do shape of each pasted line
    - `search+api.ts` — which memo line answers a question
- Import `router`, `Slot`, and `useLocalSearchParams` from `expo-router`. The app root is wrapped in `GestureHandlerRootView` (the drawer uses react-native-gesture-handler). Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
