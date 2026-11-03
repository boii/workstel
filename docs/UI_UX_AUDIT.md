# Frontend layout audit — 1 November 2026

Scope: refine the approved Workstel layout, without replacing Vue/Vuetify, typography, theme colors, measured shadows, no-sidebar navigation or the single-column mobile baseline.

## Findings and changes

| Finding                                                                                                                                     | Implemented change                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Category labels and header actions had undersized mobile hit areas. Vuetify inline heights overrode some CSS declarations.                  | Mobile category filters use a two-column layout with 44px targets. Header actions have 44px targets and the module switcher has an accessible name when its text is hidden. The demo-only notification shortcut is hidden below 361px to keep the main header row intact. |
| Header height was forced by CSS independently of Vuetify's application layout offset. Tablet module-switcher text competed with navigation. | The app bar now receives its actual responsive height from Vuetify's display state. The switcher uses its named icon at tablet/mobile widths. Mobile navigation remains beneath the main header row.                                                                      |
| Card titles, descriptions and status labels did not share a clear alignment or readable secondary contrast.                                 | Module content aligns from its top edge, cards stretch evenly, long text wraps, and secondary text uses a shared contrast token. Existing primary, background, radius and shadow tokens are preserved.                                                                    |
| Production Vault put five controls into the three-column preview toolbar. The submit button repeated the entire search prompt.              | The live toolbar has explicit desktop, tablet and mobile layouts. Its short Search/Cari action has matching typed English/Indonesian keys. Text-field/select densities are consistent.                                                                                    |
| Production account subtitles combined ownership, username, department and status into one clamped string.                                   | Account name, verbatim username and metadata/status have separate lines. Long account names and usernames wrap inside the available width.                                                                                                                                |
| Account form actions could disappear below the mobile viewport.                                                                             | The dialog has a fixed heading/action area and a separately scrolling form body. Saving disables editable fields. Invalid submission focuses the first invalid field and scrolls it into view.                                                                            |
| Sharing, password and audit controls had inconsistent spacing; long recipient addresses competed with the revoke button.                    | These forms now have explicit gaps, aligned actions and mobile wrapping. Recipient email addresses use the full row on mobile. Account detail actions use a two-column mobile layout with the main Edit action below.                                                     |
| Help/Settings repeated their page title and used the dashboard icon.                                                                        | Duplicate card titles were removed and page icons match the selected screen. Current navigation exposes aria-current.                                                                                                                                                     |
| The production no-results state lacked the preview's reset action.                                                                          | Reset filters clears the query, department and status, then reloads the list.                                                                                                                                                                                             |

## Verification

Browser checks used the local Vite app and isolated development-only fixtures for the actual production components. The fixtures intercept API calls with fictional records and are excluded from Git and production builds. No real staff login, password reveal, sharing mutation or production deployment was performed for this visual audit.

Dashboard document widths were measured at 1440, 1024, 768, 390 and 320px. None exceeded its viewport. Desktop/tablet headers measured 64px; mobile headers measured 112px. At 390px, header actions and all category filters measured 44px high. The grid retained three desktop columns, two tablet columns and one mobile column.

Production component checks covered the Vault toolbar/list, long account names/usernames, details, sharing, password-entry dialog, audit log, empty state, no-results/reset, error/retry controls and email sign-in layout. English and Indonesian system labels were checked; fixture record text remained verbatim.

At 390 × 640, the form body scrolled independently while Save/Cancel remained inside the viewport. Submitting an empty form focused vault-name and exposed its validation message. At 390 × 844, the form remained within the viewport. Native device keyboards and physical iOS/Android devices were not tested.

Automated acceptance: npm run format and npm run check (formatting, ESLint, module-generator tests, domain/API/PostgreSQL/handler tests, manifest/locale checks, TypeScript and Vite production build). Browser screenshots were saved as review artifacts outside the source tree. This is a focused layout/accessibility improvement, not a claim of a complete WCAG audit or live backend acceptance.

## Coming-soon card overlay — 2 November 2026

Replaced the small status badge with a transparent surface overlay covering the
entire unavailable module card, including its favorite control. The status is
centered; underlying content remains visible. Module and favorite buttons remain
disabled. Existing English/Indonesian status messages are reused.

Verified the local demo dashboard at desktop and a 390 × 844 mobile viewport.
Every mobile overlay matched its card bounds, and the document had no horizontal
overflow. `npm run format` and `npm run check` passed.

## Local UI improvements — 3 November 2026

Scope: interaction and accessibility refinements that do not touch the database,
schema, RPCs or storage. No authorization, SSO or vault-storage behavior changed.

| Finding                                                                              | Implemented change                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module favorites reset on every reload.                                              | Favorites persist in `localStorage` through `usePersistedRef`, which validates the stored shape and degrades silently when storage is unavailable or blocked.    |
| Vault search fired a request per keystroke.                                          | The live search debounces (300 ms), cancels in-flight requests with `AbortController`, and keeps previously loaded rows visible while a filter narrows the list. |
| No keyboard path through the shell or the Vault list.                                | `/` focuses module search, `?` opens the shortcut reference, `Esc` closes the topmost panel, and `n` opens the new-account form. Shortcuts ignore text inputs.   |
| Department names were the only cue for a department in the compact account list.     | `VaultDepartmentMark` renders initials derived from the record's own department name with a deterministic tone, plus a screen-reader label.                      |
| Dialog and list semantics were implicit, and the shell lacked a way past navigation. | Added a skip link, `aria-label`/`aria-pressed` on icon controls, `role="table"/"row"/"cell"` on the account list and a screen-reader-only utility class.         |

Verification: `npm run format` and `npm run check` passed (55 tests, module
manifest/locale checks, TypeScript and the production build). The demo build was
inspected at 1440 × 900 and 390 × 844: `scrollWidth` equalled `innerWidth` on the
login, dashboard and Vault screens; `?` opened one dialog and `Esc` cleared all
active overlays; `/` moved focus to the module search input; the Vault screen
rendered three department marks and four account rows with no console errors.
Mobile Vault reported 9 controls under 32px versus 18 on desktop, consistent with
the 44px mobile target rules.

Unavailable check: the debounced search, filter chips and `n` shortcut live in
`VaultLivePage.vue`, which needs the Supabase backend. The demo route renders
`ModuleListPage.vue` instead, so those three behaviors were verified by unit test
and source assertions only, not in a running authenticated session.
