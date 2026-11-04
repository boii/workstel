# Sentec UI reference audit

Inspection date: 5 November 2026. Reference: https://apse1.pms.sentec.io.

This document records observed UI structure and computed CSS, not business records. No guest names, reservation identifiers, financial records, credentials or private assets are retained here. Existing approved Workstel decisions remain defined in DESIGN_REFERENCE.md.

## Method and coverage

The authenticated browser session was inspected using rendered DOM, accessibility structure, screenshots and read-only getComputedStyle measurements. Desktop used the browser's normal viewport (approximately 1244 pixels wide); mobile explicitly used 390 x 844. Temporary viewport overrides were reset.

45 discovered navigation routes were opened at desktop and mobile widths. Route-level inspection establishes rendered page structure and horizontal containment, not exhaustive testing of every dialog, tab, role or saved record. Initial loading shells were excluded by waiting for visible main content; asynchronous content can still change after this observation.

Detailed component inspection covered the dashboard and navigation drawer, group reservation form and list, table filter panel and field picker, single reservation form and list, disabled actions, breadcrumbs, tab groups, input controls, table cells and the Legends dialog. Other routes received structural and containment inspection. Do not describe this as exhaustive state coverage.

## Measured styles

| Component                | Observed computed style                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application              | Quicksand, sans-serif; 15px; weight 500; text rgba(0,0,0,.87); background rgb(242,245,248)                                                            |
| Header                   | 64px; white; shadow 0 2px 30px -1px rgba(85,85,85,.08), 0 4px 30px rgba(85,85,85,.06), 0 1px 30px rgba(85,85,85,.03)                                  |
| Content cards            | White; radius 6px; shadow 0 3px 10px -2px rgba(85,85,85,.08), 0 2px 20px rgba(85,85,85,.06), 0 1px 30px rgba(85,85,85,.03)                            |
| Card variants            | Some tab containers have zero-offset shadows; not every card has identical elevation                                                                  |
| Default text button      | 36px high; 13.125px Quicksand; weight 700; horizontal padding 16px; radius 6px                                                                        |
| Small button             | 28px high; 11.25px; horizontal padding approximately 12.44px                                                                                          |
| Header icon button       | Observed 48 x 48px; radius 50%                                                                                                                        |
| Tabs                     | 36px high; 13.125px; weight 700; horizontal padding 16px; active cyan rgb(0,150,199)                                                                  |
| Search wrapper           | 40px high; radius 28px; 14px text                                                                                                                     |
| Form input               | Quicksand 14px, weight 500; transparent background; underline presentation; observed inner height 32px and vertical padding 8px                       |
| Input wrapper            | Some wrappers measure 66px including label/details spacing; this is not the input hit-target height                                                   |
| Labels                   | 14px, weight 500; disabled labels rgba(0,0,0,.38)                                                                                                     |
| Textarea                 | Quicksand 14px, weight 500; transparent; variable height                                                                                              |
| Breadcrumb               | Noto Sans with system fallbacks; 15px, weight 500; vertical padding 16px; observed height 53px                                                        |
| Reservation body cell    | Noto Sans with system fallbacks; 13.125px; horizontal padding 16px; observed row/cell height 24.5px                                                   |
| Reservation table header | Observed 11.25px and 48px high; distinguish header and body sizes                                                                                     |
| Mobile Legends dialog    | Observed bounding box 380 x 844 at viewport 390 x 844; outer dialog radius 0; outer dialog has no shadow. Inner surfaces require separate measurement |
| Guest-treatment dropdown | Observed width 407px on desktop; maximum height 304px; vertical overflow auto; radius 0; shadow 0 4px 6px rgba(32,33,36,.28)                          |

Icon inspection found a mixture including Font Awesome 5 Free alongside the Material-style icon presentation. Therefore the reference must not be described as exclusively MDI. Workstel's approved icon implementation remains MDI.

Additional panel inspection activated all eleven FO Parameter sections: Revenue Centers, Client Composition, Channel Manager, DRR Settings, Report Settings, Invoicing, Consolidation, Document Flow, Precheckin, Dimension Interface and Others. These expose combinations of underlined inputs, numeric inputs, checkboxes, radio groups, nested invoice tabs and tables. No settings were saved. Reservation Comments, Invoice, Point of Sale and Precheckin panels were also activated and their selected states observed. Attempts to activate Guest List, Rates and Others did not reliably establish the requested selected state and are not counted as verified panel coverage. Hidden tab content remains mounted, so raw DOM input counts must not be interpreted as visible field counts.

The measured reservation body height differs from the earlier 32px dense-table baseline. Tables therefore have variants; 32px must not be described as a universal Sentec row height.

## Structural patterns

- Shell: global pill search, hotel/context controls and utility icons in a white top bar; grouped drawer navigation with cyan active state.
- Dashboard: metric cards, a description/value table and collapsible chart panels.
- Group form: breadcrumb, summary strip, action card, expandable information card, multiple form columns and secondary tabs.
- Reservation form: nested tab groups, dense action strip, underlined controls, disabled system fields, date/time inputs, numeric controls, checkboxes, chips and a save/cancel area.
- Lists: search and icon actions above a dense table; internal horizontal table scrolling; row actions and numeric range footer; some pages have a separate selection/detail panel.
- Filters: anchored white panel, heading separator, empty-filter message, field selection menu with search and scrolling, Reset/Close/Apply actions. Opening and closing were inspected without applying changes.
- Mobile shell: global search becomes an icon and utility controls move behind More tools. Wide data tables retain their columns.

## Route coverage and mobile overflow

At 390px viewport width, main content measured 350px. A 380px document scroll width was common and does not exceed the viewport. Values above 390px indicate horizontal document overflow in the observed state.

| Route                             | Mobile document width |
| --------------------------------- | --------------------: |
| /dashboard                        |                   380 |
| /banquet/dashboard                |                   380 |
| /tape-chart                       |                   380 |
| /floor-plan                       |                   577 |
| /guests                           |                   872 |
| /reservations/all                 |                   380 |
| /reservations/in-house            |                   475 |
| /reservations/expected-arrival    |                   380 |
| /reservations/expected-departure  |                   380 |
| /reservations/booking             |                   473 |
| /reservations/checked-out         |                   475 |
| /reservations/canceled            |                   480 |
| /reservations/no-show             |                   460 |
| /reservations-group               |                   410 |
| /reservations/tentative           |                   462 |
| /rates                            |                   380 |
| /rates-calendar                   |                   451 |
| /rates-daily                      |                   380 |
| /master-account                   |                   579 |
| /deposit-account                  |                   452 |
| /banquet/group-list               |                   437 |
| /banquet/reservation-list         |                   380 |
| /banquet/reservation-calendar     |                   380 |
| /banquet/package                  |                   380 |
| /banquet/event-order              |                   380 |
| /banquet/changes-log              |                   380 |
| /income-audit                     |                   380 |
| /document-attachment              |                   380 |
| /document-approval                |                   380 |
| /reports                          |                   380 |
| /housekeeping/room-queue          |                   380 |
| /housekeeping/room-status         |                   380 |
| /housekeeping/room-out-of-market  |                   380 |
| /housekeeping/room-out-of-order   |                   380 |
| /housekeeping/room-out-of-service |                   380 |
| /housekeeping/room-attendant      |                   807 |
| /housekeeping/lost-and-found      |                   380 |
| /housekeeping/room-discrepancy    |                   380 |
| /housekeeping/loan                |                   380 |
| /housekeeping/maintenance-request |                   400 |
| /sun-system                       |                   694 |
| /fo-parameter                     |                   380 |
| /banquet-parameter                |                   380 |
| /key-card-setup                   |                   380 |
| /rooms-availability               |                   380 |

All 45 routes were also checked at the normal desktop viewport with no document overflow detected at the observation point. This does not establish that their asynchronous grids/calendars were fully settled or every interaction was inspected.

## Comparison with Workstel

| Area                                              | Workstel implementation and decision                                                                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typography, surfaces, primary, card/header shadow | Shared material baseline matches the measured reference tokens                                                                                                                                 |
| Navigation                                        | Approved Workstel header navigation replaces the PMS drawer; retain the approved shell                                                                                                         |
| Buttons                                           | Shared weight 700 and radius 6px; Workstel raises mobile touch targets to at least 44px                                                                                                        |
| Forms                                             | Workstel uses module-specific compact Vuetify controls and responsive grids; Sentec underline fields and nested tabs are reference patterns, not an instruction to replace every existing form |
| Lists                                             | Workstel uses module-specific compact rows/cards and scoped table regions; keep page-level horizontal overflow absent                                                                          |
| Text contrast                                     | Workstel uses #006F8F for primary text on light surfaces, while retaining #0096C7 for primary fills and accents                                                                                |
| Dashboard                                         | Workstel module cards reflect available functionality; PMS metrics/charts are domain-specific                                                                                                  |
| Mobile filters                                    | Workstel dashboard has a 44px category-filter button next to search; category choices open in a menu                                                                                           |

## Remaining evidence required

- Inspect every nested configuration tab and every create/edit dialog in each section, including calendars and chart interactions after data settles.
- Measure open dropdown, date/time picker, tooltip, alert, validation, toast and confirmation variants separately.
- Verify keyboard order, visible focus, Escape, focus restoration, screen-reader names, contrast and touch targets across each pattern.
- Verify loading, empty, denied-access, network-error and success states where they can be reached safely. These are not established by visiting a route.
- Repeat mobile overflow findings after each page fully settles; identify offending containers before assigning a cause.
- Compare the corresponding Workstel components at the same viewports before proposing implementation changes.

No operational mutation, save, check-in/out, payment, configuration update or upload was performed for this audit. Outstanding items above remain open; this document must not be used to claim all PMS UI/UX states are verified.
