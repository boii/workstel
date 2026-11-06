# Workstel — acuan desain

Detailed inspection evidence and route coverage: [Sentec UI audit](SENTEC_UI_AUDIT.md).
Mobile EMS reference and combined recommendations: [EMS mobile audit](EMS_MOBILE_UI_AUDIT.md).

Acuan disetujui pengguna: dashboard Sentec PMS https://apse1.pms.sentec.io/dashboard (pemeriksaan DOM/computed styles, 1 November 2026).
Tidak menyimpan data akun, reservasi, token, atau aset privat Sentec.

## Hasil pengukuran

- Framework teridentifikasi: Vuetify (stylesheet vuetify dan kelas v-application/v-card/v-btn). Versi belum terverifikasi.
- Font UI Quicksand, 15px, bobot dasar 500.
- Font tabel Noto Sans; sel dense 13.125px, bobot 400, tinggi 32px, padding horizontal 16px.
- Background #F2F5F8, surface #FFFFFF; warna teks rgba(0,0,0,.87).
- Primary #0096C7; ikon Material Design Icons (MDI).
- Radius kartu/tombol 6px; header 64px.
- Input pencarian 40px, radius 28px, background rgba(0,0,0,.06).
- Shadow kartu: 0 3px 10px -2px rgba(85,85,85,.08), 0 2px 20px rgba(85,85,85,.06), 0 1px 30px rgba(85,85,85,.03).
- Shadow header: 0 2px 30px -1px rgba(85,85,85,.08), 0 4px 30px rgba(85,85,85,.06), 0 1px 30px rgba(85,85,85,.03).
- Tombol default 36px, small 28px; target sentuh mobile harus diperbesar bila perlu.

## Implementasi Workstel

Vue + TypeScript + Vite + Vuetify. Font open-source dibundel lokal menggunakan Fontsource; ikon dari @mdi/font.
Gunakan versi paket yang dicatat package-lock.json, bukan klaim versi sama dengan Sentec.
Workstel mempertahankan login SSO, dashboard compact kartu modul, header tanpa sidebar, tugas dan favorit.
Warna primary, font, radius, background dan shadow mengikuti pengukuran. Tata letak mengikuti kebutuhan Workstel.
Jangan tambahkan animasi dekoratif atau statistik fiktif.
Belum diklaim pixel-identical; dashboard referensi memiliki jenis isi dan ukuran komponen yang berbeda.

## Baseline disetujui pengguna — 1 November 2026

Pengguna menyetujui tampilan mockup desktop dan mobile saat ini sebagai baseline desain Workstel.

- Brand Workstel. dengan titik aksen cyan.
- Vue + TypeScript + Vite + Vuetify; font Quicksand, Noto Sans untuk tabel, ikon MDI.
- Material mengikuti token Sentec yang dicatat di atas; antarmuka kerja ringkas tanpa gimmick.
- Desktop tanpa sidebar, header tipis, dashboard kartu modul compact.
- Mobile: kartu satu kolom, pencarian lebar penuh, kategori di bawah pencarian, navigasi Dashboard/Tugas saya/Favorit di bawah baris utama header (bukan bottom navigation).
- Login SSO tetap menjadi halaman pertama. Akses demo terpisah selama prototipe.
- Preview mobile telah diperiksa pada viewport 390 x 844; lebar dokumen 390px, tanpa overflow horizontal.
  Modul berikutnya wajib mengikuti baseline ini. Perubahan besar pada navigasi atau bahasa visual harus dibahas dengan pengguna terlebih dahulu.

## Responsive implementation — 5 November 2026

Workstel keeps the PMS material tokens and uses the EMS vertical-flow principles on narrow screens. Shared page gutters and headings scale with viewport width. Module toolbar and record layouts also respond to their available container width, rather than relying exclusively on device breakpoints. Narrow filters stack before their labels become cramped. Mobile and coarse-pointer controls have at least 44px touch targets, and input text uses 16px. Dialogs retain viewport margins and bounded height; explicit fullscreen dialogs retain their own layout.

The dashboard category filter opens from an icon next to search on mobile, superseding the earlier always-visible category row. Module cards remain one column on mobile. These are frontend layout changes; no server/API behavior changes.

Validation: the local browser preview could not be reached through localhost or the LAN URL in the ChatGPT browser. Desktop, tablet and mobile visual acceptance remains open; do not claim a perfect fit on every device from source/build checks alone.

## Language baseline

English is the default interface and coding language. Bahasa Indonesia is an optional user-selectable locale; visual structure remains the same across locales.

## Interaction additions — 5 November 2026

- Command palette: Ctrl/⌘ + K or the header search button opens a palette of shell pages, modules and actions (language, shortcuts, sign out). It is a centred dialog on desktop and fullscreen on screens up to 680px. It never searches module records, so module isolation is unchanged. Only item IDs of the last five picks are stored in the browser.
- Adaptive tables: `src/shared/stack-table.css` turns a `.stack-table` into compact cards when its `.stack-table-container` is narrower than 560px. Cells carry `data-label`; the naming cell uses `.stack-table-primary`. Used by the Room Turnaround attendant table and the Bin Card ledger.
- Optimistic archive with Undo: Documents, Vehicle Checklist and Bin Card archive/restore update the list immediately and offer Undo for 6 seconds (`src/core/use-optimistic-archive.ts`, `src/shared/undo-snackbar.vue`). Since 6 November 2026 this is the only archive pattern: Vault, Sales CRM and Room Turnaround follow it too, with no confirmation dialog (see "One archive pattern" below). The server still enforces permissions, versions and rules such as a zero Bin Card balance; a rejected change restores the row. Append-only records (stock entries, sales activities) have no Undo.

Validation: desktop and 390px mobile were checked in the in-app browser preview in demo mode.

## Mobile density changes — 5 November 2026

Approved by the user on 5 November 2026 after a 390px review. Before this change, the first Documents record started 587px down an 844px screen.

- Compact filters: on screens up to 680px, secondary filters collapse into one Filters button next to search (`src/shared/filter-group.vue`). The button shows a badge with the active filter count, and its panel has Reset and Show results. This applies to Documents, Bin Card, Vehicle Checklist, Sales CRM and the Room Turnaround rooms tab. Vault keeps its own filter toggle. Desktop filters stay inline.
- Collapsing header: on phones the Dashboard/My tasks/Favorites row hides while scrolling down past the header and returns on scroll up, at the top of the page, on navigation, or when focus enters the header. This refines the earlier rule that navigation sits beneath the top header row; there is still no bottom navigation.
- Floating primary action: on phones a module's main create button (`.module-primary-action`) floats at the bottom right, using the measured header shadow token. Secondary actions stay in the page heading.

Result: the first Documents record now starts at about 400px. Checked in the in-app browser at 390 x 844 and on desktop in demo mode.

## Loading and empty states — 5 November 2026

- ModulePage shows a loading placeholder shaped like the content: record rows by default, or a tile grid (`skeleton="grid"`, used by the Room Turnaround rooms tab). This replaces the generic table skeleton.
- Empty states show an icon, one sentence and one action. With filters they show a filter-off icon and Reset filters. Without filters they show the module icon and its create action when the user may create.

## Compact forms and row actions — 5 November 2026

Approved by the user after measuring production forms.

- Form spacing: `.field-label` margins went from 20px/8px to 14px/4px. `VAutocomplete` now shares the compact, filled and `hideDetails: 'auto'` defaults of the other fields. A field row went from 88px to 76px, and the Sales CRM Add deal form now fits a laptop screen without scrolling (749px, down from 822px).
- Bottom sheet: `ModuleDialog` has a `sheet` option. On phones, short forms open from the bottom at their content height, with a full-width primary button. Used by Record stock movement, Log activity, Add/Edit room and the room timer. Long forms stay fullscreen on phones.
- Row actions: in list containers narrower than 720px, the record name takes the first line, and status and actions share the second. Secondary row actions (`.row-secondary-action`: Bin card ledger, Vehicle history) become 44px icon buttons that keep their accessible names and tooltips. A Bin Card row on a 390px phone went from 167px to 128px. Desktop rows are unchanged.

## Design tokens — 5 November 2026

Approved by the user as a correction pass within the baseline. Colours, Quicksand and Vuetify are unchanged; only consistency was corrected.

- Status colours are defined once in `:root` (`--workstel-success|warning|danger|info|neutral-bg/-text`), and modules map their states to them. Done, pass and won use success. Needs attention, low stock, due today and paused use warning. Out of stock, overdue, blocked and errors use danger. In-progress work and proposal or negotiation stages use info. Lead uses neutral. A lost deal now reads as closed (neutral) instead of an error, and negotiation no longer uses the warning colour.
- Neutrals: `--workstel-surface-muted` and `--workstel-surface-subtle` replace eight near-identical greys. Ten secondary-text greys, several below 4.5:1 contrast, now use `--workstel-text-secondary`. Borders use `--workstel-border`. Category colours (Vault department marks, module icons), the measured search fill and disabled "Coming soon" text stay literal.
- Type scale: `--workstel-font-xs|sm|md|lg|xl` = 11 / 13 / 15 / 20 / clamp(23–26) px replaces 20 ad-hoc sizes, including 7px and 10px text. Buttons use the small step and page headings use the display step. Exempt: the wordmark, timer figures, icon glyphs, status dots, 16px touch inputs (which prevent iOS zoom) and the temporary-password code.
- Row actions: per-row primary actions (Record, Inspect, Open, Log activity, View account) use `variant="tonal"` with the shared `.row-primary-action` class from src/shared/list-row.css: a 12% primary tint behind `--workstel-primary-text`, with no border. A page's filled button is still the only solid call to action. (They were outlined until the tonal row action change; see below.)
- Money: summaries use compact currency and rows and details use the full amount. A deal value of 0 reads "No value yet" ("Belum ada nilai") instead of "IDR 0".
- Navigation: production hides My tasks until it has a backend, instead of showing a disabled link. Demo mode still shows it.

## Compact forms, second pass — 5 November 2026

- Paired fields: short pairs stay side by side on phones and stack only below 360px. The pairs are Sales stage and segment, value and room nights, arrival and departure; Bin Card code and unit, minimum and department; and Document category and department. The vehicle inspection odometer and fuel level still stack, because the fuel buttons need the full width.
- Optional fields: `src/shared/optional-fields.vue` folds optional fields behind one "Add …" link (deal, account and document notes; inspection notes; stock reference and notes). The fields open by themselves when they already have a value, when a server error points at them, or for inspection notes once an item is marked as an issue. They fold again when the form is reopened, and expanding them focuses the first field. The Bin Card stock movement sheet on a phone went from 594px to 473px.
- Footers: every module form already keeps Cancel and Save in the `ModuleDialog` footer, outside the scrolling body, so no change was needed.

## Centralized style tokens — 6 November 2026

Approved by the user as a consistency pass. The visual baseline does not change: every token holds the value that was already written in that place.

All tokens live in `:root` in `src/styles.css`, alongside the colour and type tokens above.

- Font weights: `--workstel-weight-regular|medium|semibold|bold` = 400 / 500 / 600 / 700. All 88 literal weights now use them.
- Spacing: `--workstel-space-<n>` = n × 4px, with half steps written as `_5` (`0_5` = 2px, `1_5` = 6px, … `8` = 32px). It is used in `gap`, `padding` and `margin` (567 values). Values off this scale stay literal so the layout stays the same: 1, 3, 5, 7, 9, 11, 15, 17, 18, 22 and 23px, plus a few one-off offsets. Bring these onto the scale only after a visual review.
- Radius: `--workstel-radius-sm|md|lg|pill` = 4 / 6 / 12 / 999px. Pill replaces 28px on the 40px search field and 26px on the 52px floating action; both were already fully rounded. Circles (`50%`) and resets (`0`) stay literal.
- Shadows: `--workstel-shadow-card` and `--workstel-shadow-header` hold the measured values. Hex alpha approximations (`#55555514`) now use the exact measured rgba values. The skip link gains the card shadow's missing third layer (3% alpha, visible only on focus).
- Primary: styles use `rgb(var(--v-theme-primary))` instead of repeating `#0096c7`, so the Vuetify theme in `src/main.ts` is the single source.
- Breakpoints cannot use custom properties in media queries, so they stay literal. The standard set is 360, 560 (container), 680, 720 (container), 760, 900 and 1050px. Prefer 680px for phone layouts. The 359/360 and 400px outliers remain until a visual review.

## Centralized style tokens, second pass — 6 November 2026

Approved by the user. It completes the first pass and covers every group that was still literal.

- **Colours:** small changes the user approved.
  - Stray greys now use the shared tokens. Top navigation `#666` and the page heading icon `#555` become `--workstel-text-secondary` (#5f6f7b).
  - The skip link `#007a9e` and the Vault account name `#306c87` become `--workstel-primary-text` (#006f8f).
  - The info alert text `#0b4f6c` becomes `--workstel-info-text` (#005a75).
  - The wordmark `#333` and the skip-link white now read the Vuetify theme (`on-surface`, `surface`).
  - The base text colour is `--workstel-text-primary`. The page background reads `rgb(var(--v-theme-background))`, so `src/main.ts` is the only place it is set.
  - The account avatar uses `--workstel-avatar-bg` and `--workstel-avatar-text`, in the header and in Settings.
- **Line height:** `--workstel-leading-tight|normal|relaxed|loose` = 1.4 / 1.5 / 1.6 / 1.7 (54 uses). The outliers 1.15, 1.3, 1.35, 1.45 and 1.8 stay literal.
- **Letter spacing:** `--workstel-tracking-heading` = −0.7px for page and sign-in headings; the sign-in heading moves from −0.5px. `--workstel-tracking-caps` = 1px for uppercase labels; the eyebrow moves from 1.2px and command palette group headings from 0.04em. `--workstel-tracking-code` = 0.5px for bin codes and plates. Exempt: the wordmark, the masked Vault password, the Vault department mark and the temporary-password code.
- **Heights:**
  - `--workstel-touch-target` = 44px (74 uses) and `--workstel-header-height` = 64px.
  - Controls: `--workstel-control-sm|md|lg|xl` = 36 / 40 / 48 / 52px.
  - List rows: `--workstel-row-sm|md|lg` = 48 / 56 / 64px.
  - One-off tile and row heights (58, 84, 87, 92px, the 52px settings row and the 64px room choice buttons) stay literal.
- **Icons:** `--workstel-icon-xs|sm|md|lg|xl|2xl` = 14 / 16 / 18 / 22 / 28 / 32px, passed as `v-icon size="var(--workstel-icon-sm)"`. Sizes 11, 15, 20, 30 and 36px (one to four uses each) and avatar sizes stay literal.
- **Dialog widths:** `dialogWidth` in `src/shared/dialog-widths.ts` holds every width (420–960px) at its current value. That includes the Vuetify default and the ModuleDialog default. Reducing the number of steps is a separate visual decision.
- **Stacking:** `--workstel-z-floating` = 5 and `--workstel-z-skip-link` = 3000.

## Module layout consistency — 6 November 2026

Approved by the user after a signed-in production review of all six modules at desktop and 390px. The page frame was already consistent: back link, title, count, toolbar order and row actions. These placement rules now apply to every module:

- **Heading actions:** one filled primary action, placed last. On phones it becomes the floating action (`.module-primary-action`). Secondary heading actions (Vault Audit log, Sales Add account, Room Turnaround Room list) use the text variant. On phones they keep their natural width and label instead of stretching across the screen or collapsing to an icon. Vault now follows this rule: its add button floats on phones, and the Vault-only heading overrides (row layout, icon-only buttons, smaller title) are gone.
- **Row status:** status sits in the row's status column between the identity and the actions, with its supporting date or value. Sales CRM moved the deal stage from the start of the row into that column, above the follow-up date, as Bin Card and Vehicle Checklist already did. In lists narrower than 720px, the identity takes the first line, and status and actions share the second. Tabular modules (Vault, Room Turnaround) keep status in a table column.
- **Filters:** every secondary filter belongs to the module's `FilterGroup`, so it folds into the Filters button on phones and counts in its badge. Bin Card's "Low stock only" checkbox is now a Stock select ("All stock levels" / "Low stock only"; Indonesian "Stok", "Semua tingkat stok", "Hanya stok menipis"). Reset filters clears it. The Bin Card toolbar uses the same 180px filter columns as Documents and Sales CRM.

Still open from the review: Vehicle Checklist's 200px filter columns, and Vault's count wording. Vault also keeps its own toolbar (Access, Filters toggle, refresh, shortcuts).

## Style guard and shared list rows — 6 November 2026

- **Token guard:** `npm run styles:check` runs in `npm run build`, so it also runs in `npm run check` and the Pages build. It scans every `.css` file and every Vue `<style>` block and template, and rejects:
  - colours, font sizes, weights and line heights that have a token;
  - letter spacing, pixel radii and on-scale spacing;
  - 44px touch sizes and numeric z-index;
  - icon sizes on the scale, hex colour props and numeric dialog widths.
    The 33 documented exceptions (wordmark, timer figures, 16px touch inputs, category colours, and others) are marked `token-exempt: <reason>`. `scripts/style-tokens.test.ts` covers the rules.
- **Shared list rows:** `src/shared/list-row.vue` and `src/shared/list-row.css` replace the four copies of the row layout in Bin Card, Vehicle Checklist, Documents and Sales CRM (pipeline and accounts).
  - Every row has the same columns (identity 1.4fr, status 0.8fr, actions), padding (10/12/10/16px), separators and archived fill, and a shared `list-row-chip` for status.
  - Every row has a leading icon. Bin Card uses the module's package icon, and Sales deals use the handshake icon; Vehicle, Documents and Sales accounts keep theirs.
  - In lists narrower than 720px, the identity takes the first line, and status and actions share the second, with actions on the right. This includes Documents, whose Open button was left-aligned on phones.
  - The Sales accounts row action changed from tonal to outlined, like other row actions.
  - Vehicle's columns moved from 1.3fr / 1fr to the shared 1.4fr / 0.8fr. Bin and Vehicle rows gained 2px of vertical padding to match the others.

## Tonal row actions — 6 November 2026

- **Row primary action:** Record (Bin Card), Inspect (Vehicle Checklist), Open (Documents), Log activity and View account (Sales CRM) changed from outlined to tonal, with no border. They share `.row-primary-action` in `src/shared/list-row.css`: a 12% tint of the theme primary (#0096C7) behind `--workstel-primary-text` (#006f8f), about 4.9:1 contrast. Long lists read lighter, and the heading's filled button stays the only solid call to action.
- **Accessible names:** Record and Inspect now carry an `aria-label` with the record name ("Record — <item>", "Inspect — <vehicle>"), like the other row actions.
- **Negotiation chip:** the Sales CRM Negotiation stage no longer has its 1px info outline. It was added when negotiation moved from warning to info, to tell it apart from Proposal. It was the only outlined status chip in the app, and the chip's label already names the stage. Every status chip is now a tint with matching text and no border.
- **Vault account details:** Account details now open as a centered popup, like Edit account and the detail dialogs in other modules (Sales account detail, Bin Card ledger, Vehicle history), instead of a right-hand drawer. The popup uses the standard 560px Vault width and fills the screen at 680px and below, as the drawer did. Its content, Reveal button, ⋮ menu and URL (`/vault/accounts/:accountId`) are unchanged. `VaultDialog` no longer has a `drawer` option, and the drawer CSS is gone.

## Mobile bottom sheets — 6 November 2026

On phones (680px and below), short dialogs now open as bottom sheets sized to their content, instead of filling the screen. Long forms and long lists stay full screen.

- **Shared rule:** the sheet layout moved from `module-dialog.vue` to `src/shared/dialog-sheet.css` (class `dialog-sheet`): bottom-aligned, full width, at most 92dvh, rounded top corners and the safe-area inset. `ModuleDialog` and `VaultDialog` both have a `sheet` option that applies it.
- **Now bottom sheets:** Vault account details; Bin Card add/edit item; Documents add/edit document; Vehicle Checklist add/edit vehicle; Room Turnaround import rooms; Sales CRM archive account confirmation; Settings change password; Users add user and the temporary password.
- **Already bottom sheets:** stock movement, Log activity, add/edit room, the room timer and Profile.
- **Still full screen, by design:** Sales CRM deal form (12 fields) and account form (8 fields), the Vehicle inspection form (checklist), the user access dialog, and the views whose length grows with records: Sales account detail, Bin Card ledger, Vehicle history and Vault Audit log.
- Vault's other dialogs (edit account, password, sharing, confirmations) were content-sized centered popups on phones and are unchanged.

## One dialog shell — 6 November 2026

Approved by the user. Every dialog except the command palette now uses `ModuleDialog`, or `VaultDialog` inside Vault: a title with a close button, a scrolling body, and Cancel and the action in the footer.

- **Confirmations:** module switch-off (Settings → Modules), block user, reset password and Vault ownership transfer (Users), and Vault transfer were three copies of one hand-built card. They had no close button, no accessible name and no bottom sheet on phones. They now use the shell with `sheet` at the `md` width (460px, up from 420px), like the Sales CRM archive confirmation. A destructive action stays `color="error"`. Body text is the dialog's normal text colour instead of secondary grey.
- **Keyboard shortcuts:** uses `ModuleDialog` with `sheet` at the `xs` width instead of its own header.
- **New task (demo My tasks):** uses `ModuleDialog` with `sheet` at the `md` width. The hint is the subtitle, and Add task moved to the footer with Cancel. The global `.detail-panel`, `.close-button` and `.submit-button` styles were used only here and are gone.
- **Still custom:** the command palette keeps its search-first layout.

## Full-screen dialogs on phones — 6 November 2026

Approved by the user after a 390px review of the Sales CRM deal form.

- **Unsaved input:** `ModuleDialog` has a `dirty` prop. While it is true, closing without saving asks "Discard changes?" ("Buang perubahan?") in a bottom sheet, with Keep editing and a red Discard. That covers the close button, Escape, an outside click, phone Back and the form's own Cancel, which uses the `close` function passed to the `#actions` slot. Saving closes without asking. The Sales CRM deal and account forms and the Vehicle inspection form set `dirty` by comparing their input with what they held when opened, so opening a record and closing it unchanged does not ask. Other forms can opt in the same way.
- **Footer:** on phones, the footer's last non-text button takes the remaining width in full-screen dialogs as well as in sheets (Save deal went from 94px to 276px at 390px). `VaultDialog` does the same in full screen (Audit log).
- **Safe area:** full-screen `ModuleDialog` and `VaultDialog` cards pad their bottom by `env(safe-area-inset-bottom)`, as sheets already did, so footers stay clear of the iPhone home indicator. The rule lives in `src/shared/dialog-sheet.css`.
- **Opening:** on phones, full-screen dialogs slide up from the bottom (`dialog-bottom-transition`) like sheets. Desktop dialogs and Vault's centred phone popups keep the default transition.

## Two phone dialog layouts — 6 November 2026

Approved by the user. On phones there are now two dialog layouts, chosen by content length rather than by module: a **bottom sheet** for short content and **full screen** for long forms and views that grow with records. Desktop dialogs stay centred popups.

- **Bottom sheet is the default.** `ModuleDialog` opens as a bottom sheet on phones unless it has `fullscreen`. The `sheet` option is gone. Full screen is used by the Sales CRM deal form, account form and account detail, the Vehicle inspection form and history, the Bin Card ledger, the user access dialog, and Vault Sharing and Audit log.
- **Vault uses `ModuleDialog`.** `VaultDialog` is removed. `ModuleDialog` gained its `#toolbar` slot (used by the Audit log filters) and announces subtitle changes politely. Vault dialogs carry `class="vault-dialog"`, which scopes the Vault content styles. The full-width footer action, safe-area padding and "Discard changes?" guard now apply to Vault through the one component.
- **Vault on phones:** the confirm archive, add/edit account and password (verify, set, reveal) dialogs were content-sized centred popups. They are now bottom sheets, like the matching dialogs in other modules. Sharing, whose recipient list grows up to 50, is now full screen. Account details and the ownership transfer confirmation were already sheets, and Audit log was already full screen.
- **Desktop:** Vault dialog widths are unchanged. The desktop close button is now the shared 40 × 36px icon button instead of Vault's 36 × 36px, and the footer buttons keep Vuetify's 64px minimum width.
- **Still custom:** the command palette, which is full screen on phones.

## Shared menus, confirmations and phone width — 6 November 2026

Approved by the user as a consistency pass.

- **Action menus:** `src/shared/action-menu.vue` (`ActionMenu`) replaces `v-menu` + `v-list` in the row ⋮ menus (Bin Card, Documents, Sales CRM, Vehicle Checklist, Vault list), the Vault account details menu (`above`), the Room Turnaround "Manage rooms" menu and the header menus (language on the sign-in page and in the header, switch module, account, mobile category filter). Every menu now opens below its trigger, aligned to the right edge, with a compact list. Before this, only the Vault list and the category filter were aligned right. The default trigger is the ⋮ icon button, with its `label` as the accessible name and tooltip; a different trigger goes in `#activator`. The notifications panel is a card, not a list, and stays a plain `v-menu`.
- **Confirmations:** `ModuleDialog` builds the footer from `confirm-label`: Cancel (or `cancel-label`) and a filled button that emits `confirm`, red when `destructive`, with the loading state while `busy`. Confirmations default to the `md` width. Module switch-off, the user block, reset and transfer confirmation, Vault ownership transfer, Sales account archive, both Vault archive dialogs and "Discard changes?" use it. The Sales and Vault archive buttons change from elevated to flat, and the Vault archive dialogs widen from 440px to the 460px confirmation width.
- **Phone width:** `src/shared/breakpoints.ts` holds `phoneMaxWidth` (680) and `usePhone()`. `ModuleDialog`, the command palette, `FilterGroup` and the header use it instead of their own `<= 680` checks. CSS media queries still write 680px, because they cannot read a script constant.
- **Module switch fix:** cancelling "Turn off this module?" left the switch drawn as off while the module stayed on, so the next tap turned it "on" without asking. The switches are now redrawn when the confirmation is cancelled or closed. Found while checking the shared confirmation in demo mode.

## One archive pattern — 6 November 2026

Approved by the user: archive and restore have one pattern in every module, "apply at once, then Undo".

- **Rule:** archive and restore never ask for confirmation. The change applies at once and the module snackbar (`UndoSnackbar`) offers Undo for 6 seconds. Undo sends the record version plus one, because every archive/restore RPC raises the version by one. The server still enforces permissions, versions and module rules; a rejected change shows its error and the list reloads.
- **Vault:** both "Archive this account?" dialogs (live and demo) are removed. The list row action and the account details menu archive or restore at once; details close first. Vault uses `useOptimisticArchive`, so the row leaves the list immediately and comes back if the server rejects the change. Vault's own snackbar with a Close button is replaced by `UndoSnackbar`, which also shows the saved and transfer notices.
- **Sales CRM:** the archive confirmation is removed. Archive in account details applies at once and keeps its existing Undo. Deals still leave the pipeline while the account is archived; Undo or Restore brings them back.
- **Room Turnaround:** archive and restore of a room now offer Undo through `UndoSnackbar`. The rule that a room with an open task cannot be archived is unchanged and still enforced by the server.
- **Removed copy:** Vault `archiveTitle` and `archiveHint`, Sales CRM `archiveConfirmTitle` and `archiveConfirmText`, in English and Indonesian.
- The earlier entries above that mention archive confirmations describe the state before this change.

## Inset full-screen dialogs on phones — 6 November 2026

Approved by the user: full-screen dialogs on phones should read as a popup in the middle, with a gap on every side.

- **Layout:** on phones (≤ 680px), `ModuleDialog` with `fullscreen` no longer uses Vuetify's edge-to-edge full screen. It opens as an inset popup (`dialog-inset` in `src/shared/dialog-sheet.css`) that fills the screen apart from a 12px gap (`--workstel-space-3`) on every side, the same gap other phone popups keep. The top and bottom gaps grow to the safe-area insets where those are larger, so the card clears the notch and the iPhone home indicator. The card keeps its normal rounded corners.
- **Where:** every `fullscreen` dialog — Vault Audit log and Sharing, Bin Card stock ledger, Vehicle inspection form and history, Sales CRM account details, account form and deal form, and Users manage user — and the command palette, which was the only other dialog that filled the screen on phones.
- **Opening:** inset popups use the default dialog transition, like desktop dialogs. Bottom sheets still slide up from the bottom.
- **Footer:** the footer's main action still spans the remaining width on phones, in sheets and inset popups.
- This replaces the full-screen layout, safe-area padding and opening transition described in "Full-screen dialogs on phones" and "Two phone dialog layouts" above.

## One phone dialog layout — 6 November 2026

Approved by the user after weighing "every dialog full height" against short dialogs: every dialog on a phone is now a centred popup with a gap on every side. Bottom sheets are removed.

- **Layout:** on phones (≤ 680px) every `ModuleDialog` is a centred popup (`dialog-popup` in `src/shared/dialog-phone.css`, renamed from `dialog-sheet.css`) with a 12px gap (`--workstel-space-3`) on every side; top and bottom grow to the safe-area insets where those are larger. Cards keep their normal rounded corners and open with the default dialog transition.
- **Height:** short dialogs take their content height, up to the screen height minus the gaps. `fullscreen` dialogs (long forms and views that grow with records) also take `dialog-inset` and fill the height, as described in "Inset full-screen dialogs on phones". The command palette uses the full-height popup.
- **Why not full height for everything:** confirmations ("Discard changes?", module switch-off, block/reset/transfer, Vault transfer) would be mostly empty space; a confirmation over a full-height form would cover it entirely; and frequent short dialogs such as the Room Turnaround timer would cover the whole screen each time.
- **Footer:** on phones the footer's main action still spans the remaining width, in every dialog.
- This replaces the bottom sheets described in "Mobile bottom sheets" and "Two phone dialog layouts" above.
