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
- Optimistic archive with Undo: Documents, Vehicle Checklist and Bin Card archive/restore update the list immediately and offer Undo for 6 seconds (`src/core/use-optimistic-archive.ts`, `src/shared/undo-snackbar.vue`). Sales CRM keeps its archive confirmation because deals leave the pipeline, then offers Undo. The server still enforces permissions, versions and rules such as a zero Bin Card balance; a rejected change restores the row. Append-only records (stock entries, sales activities) have no Undo.

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
- Row actions: per-row primary actions (Record, Inspect, Open, Log activity) use the outlined primary style instead of tonal blocks. A page's filled button is then the only solid call to action. Outlined primary text uses `--workstel-primary-text` for contrast.
- Money: summaries use compact currency and rows and details use the full amount. A deal value of 0 reads "No value yet" ("Belum ada nilai") instead of "IDR 0".
- Navigation: production hides My tasks until it has a backend, instead of showing a disabled link. Demo mode still shows it.

## Compact forms, second pass — 5 November 2026

- Paired fields: short pairs stay side by side on phones and stack only below 360px. The pairs are Sales stage and segment, value and room nights, arrival and departure; Bin Card code and unit, minimum and department; and Document category and department. The vehicle inspection odometer and fuel level still stack, because the fuel buttons need the full width.
- Optional fields: `src/shared/optional-fields.vue` folds optional fields behind one "Add …" link (deal, account and document notes; inspection notes; stock reference and notes). The fields open by themselves when they already have a value, when a server error points at them, or for inspection notes once an item is marked as an issue. They fold again when the form is reopened, and expanding them focuses the first field. The Bin Card stock movement sheet on a phone went from 594px to 473px.
- Footers: every module form already keeps Cancel and Save in the `ModuleDialog` footer, outside the scrolling body, so no change was needed.
