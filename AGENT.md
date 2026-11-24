# AGENT.md: ListX (vanilla JS, live app), full reference

Read this before changing anything. It records how ListX behaves so a change or refactor can keep every feature, modal, button and theme exactly as it is. This file documents the live vanilla JS app at the repo root (`/ListX/`). The behavior is unchanged since v14 (commit 075401f). A separate React preview lives in `react-preview/` with its own AGENT.md; it is not the live app. If code and this file disagree, the code in the repo root is the truth.

## 1. What ListX is
A private, offline-first task list, installed as a PWA from GitHub Pages at `/ListX/`. No account, no server, no analytics. Data lives only in the browser's localStorage. Single page. English UI, but task text may be Arabic (auto direction, Tajawal font for Arabic glyphs).

## 2. Hard rules (do not break)
1. Same storage keys and formats (section 4). Existing users' data must load unchanged.
2. Same look: reuse `css/style.css`, fonts, icons and manifest byte-for-byte. No restyling.
3. Same update flow and update modal (section 8).
4. Same offline behavior: after first load the app opens with no network.
5. The launch-icon jump on Android is a known, accepted behavior. Leave it alone.
6. Do not claim a startup speed-up without measuring on a real device. The slow phone launch was investigated; Chrome's cold start is a strongly supported contributor, but the cause was not proven (no phone trace was captured).
7. Nothing is pushed to the live repo without the owner's explicit "ارفع" for that upload. Show first.
8. Pushes use a temporary token scoped to the ListX repo only.

## 3. Files
- `index.html` (599 lines): all markup, including every dialog, the 9 theme buttons, the update overlay, a pre-paint script that sets `data-theme` and `data-font` from storage before first paint, and the manifest and icon links.
- `js/app.js` (895 lines): all logic.
- `css/style.css` (2055 lines): all styling. Themes are defined several times over (base blocks, later override blocks near lines 1194-1262, 1961-1964, 2003-2053). Later blocks win. Do not delete "duplicates" without pixel comparison.
- `sw.js`: service worker, cache `listx:<scope>:v15-docs` (v15 only adds this file and bumps the cache name so installed apps show the update modal; no app code changed from v14).
- `manifest.json`: name ListX, standalone, portrait, start_url and scope `./`, background and theme color `#0a0b0d`, icons 192, 512, maskable 512.
- `imgs/`: icon-192, icon-512, icon-maskable-512, apple-touch-icon, icon.svg.
- `fonts/`: tajawal 400/500/700 arabic woff2, inter-var-latin woff2.

## 4. Storage
Prefix: `listx:/ListX/:` when the path starts with `/listx/` (case-insensitive), otherwise empty. All keys below are prefixed.
- `tasks`: JSON array of `{id, text, done}`.
- `theme`: palette name string. Default `obsidian`.
- `listx-appearance`: JSON `{font, sizePx, sizeVersion: 3}`.
- `line`: legacy array of completed task strings (read only, for migration).
- sessionStorage `task-input`: unsent text in the add field, restored on reload.
- sessionStorage `listx-update-attempts`, `listx-update-skip`: update modal state (section 8). Not prefixed.
Storage errors (private mode, quota) show a warning ("Storage is unavailable. Changes will only last until you close this page.") and the app keeps working in memory.

### Task migration (`readTasks`)
- No `tasks` key: empty list.
- Entries may be plain strings (very old). A string becomes `{text, done: legacyLine.includes(text)}`.
- Each record needs a string `text`, else the whole read fails.
- Missing or duplicate `id`: a new id is generated.
- `done` is true only when exactly `true`.
- On any failure: `recoveryNeeded = true`, list shown empty, warning "Saved task data could not be read. It has not been changed. Back up your browser data before adding tasks.", Add and Clear all disabled, and `persist()` refuses to write (toast "Saved data needs recovery. No changes were saved."). The raw stored data is never overwritten.

### Appearance migration
- Font allowed: `inter`, `system`, `editorial`, `mono`. Default `inter`.
- Size: `sizeVersion 3` with numeric `sizePx` is used as is. Older slot names: v2 `small 14, compact 15, comfortable 16, large 17`; v1 `small 14, compact 15, comfortable 17, large 17`. Anything else: 14.
- Size is clamped to 12..22 and rounded to 0.1.

## 5. Themes (9)
Dark: `dark` (green) #111a17, `dark-blue` #111725, `graphite` #19181e, `obsidian` #0a0b0d (default), `petrol` #0d1c20, `espresso` #1c1714.
Light: `light` #f8f5ef, `light-blue` #f0f4fa, `light-sage` #faf1f5 (pink-tinted despite the name).
The hex is also the `<meta name="theme-color">` for each. Choosing one sets `html[data-theme]`, saves `theme`, updates the meta color and the pressed state of the swatch buttons. Variables per theme: bg, sidebar, surface, raised, hover, border, text, muted, accent, accent-ink, ring, danger-fill/border/text.
Fonts: `inter` (default), `system`, `editorial`, `mono`, set as `html[data-font]`. Arabic text always falls back to Tajawal.

## 6. UI and behavior
Layout: sidebar (brand ListX, nav "All tasks" with active count, connection status, settings button) and main column: a date label (long weekday, month, day, English) in the header, overview card (total, active, completed, progress ring with percent and caption), task panel (add form, filters All/Active/Completed with counts, list summary line, list, "Clear completed" shown only when something is done), "Clear all" button, empty state.
- Add: Enter or button. Empty or whitespace blocked. Add switches filter to All, clears the field and sessionStorage draft, refocuses the field, toast "Task added".
- Toggle: checkbox. Announcements "Task completed" / "Task marked active". Focus returns to the replaced row's checkbox or the current filter button.
- Edit: pencil button or double-click on text. Opens the Edit dialog, input filled and its whole text selected. Save disabled while empty. Enter or Save stores trimmed text, toast "Task updated". Cancel, Escape, or backdrop click closes without saving. Focus returns to the row's action button.
- Delete: row button. Removes and shows toast with Undo (8 s). Undo restores order and state and keeps tasks added since.
- Clear completed and Clear all: each opens a confirm dialog (Cancel focused). Confirm clears, toast with Undo (8 s). A new deletion replaces the previous undo.
- Plain toasts last 5 s. Toast has a dismiss button. Toast sits above the mobile keyboard (`--keyboard-inset` from visualViewport).
- Reorder: each row has a drag handle. Mouse/touch drag and keyboard (focus handle, ArrowUp/ArrowDown move one slot, Home/End jump to top/bottom, with live announcement) reorder the visible subset inside their original model slots, hidden (filtered) tasks keep their positions. Reorder is cancelled on tab hide, blur, pagehide, resize, visualViewport resize and scroll. Save happens at drop.
- Arabic task text gets class `ar` (Tajawal) and `dir=auto`.
- Cross-tab sync: the `storage` event reloads tasks (clears undo and toast), theme, and appearance in other tabs.
- Settings dialog: heading "A space that feels like you.", close button, color palette grid (9 swatches, aria-pressed, check mark), font options (4), task text size field with minus and plus (step 0.5) and a text input, hint "Any number from 12 to 22. No need to type px.", live preview (English line and Arabic line "خطوة صغيرة كل يوم"), "Saved on this device", "Reset appearance" (font inter, size 14, theme back to obsidian).
- Size input: digits and one dot only, applied live while typing, committed (clamped, reformatted) on blur or change. The field is not reformatted while focused.
- Every `<dialog>` closes on Escape and on a click on its backdrop.

## 7. Service worker (offline)
Precache list: `./`, index.html, manifest, css, js/app.js, 5 icons, 4 fonts. Install fetches each with `cache: no-cache` (revalidate), stores `./` and index.html from one download. Fails install if any asset is not ok. Fetch handler: GET, same origin, known assets only, cache-first with network fallback. Activate deletes older caches with the same scope prefix, then `clients.claim()`. A new worker does NOT take over by itself: it waits until the page sends `{type: "SKIP_WAITING"}`.

## 8. Update flow and update modal
Only on http(s). Page registers `./sw.js` on `load`. If registration fails the status text becomes "Offline setup unavailable".
- A modal appears when a new worker is installed and waiting AND there is already a controller (first installs never show it) AND `listx-update-skip` is not set.
- While open: the rest of the body is `inert`, page scroll is locked (position kept and restored), Tab cycles only inside the modal, focus lands on the modal itself (no button ring on open).
- Button "Update": increments `listx-update-attempts`, disables itself, text "Updating…", sends SKIP_WAITING. On `controllerchange` it reloads. If nothing happens in 4 s it reloads anyway. On controllerchange attempts and skip are cleared.
- After 2 failed attempts the modal opens in failed state: error text visible, button reads "Try again", and a "Keep current version" button (`#update-later`) appears. It sets `listx-update-skip` and closes the modal for this session. Tasks are never touched.
- Close restores focus to the previously focused element.

## 9. Accessibility and details to preserve
aria-labels on all icon buttons ("Open appearance settings", "Dismiss notification", "Decrease/Increase task text size" etc.), live regions for announcements, `aria-pressed` on swatches, filters and fonts, progress ring has `role=progressbar` values, visible keyboard focus rings, `prefers-reduced-motion` handled in CSS.

## 10. Not verified (device checks and gaps)
Real Android WebAPK install and update, launch delay on the phone, touch drag on a real device, iOS Safari standalone behavior, and the true cause of any slow phone launch.
