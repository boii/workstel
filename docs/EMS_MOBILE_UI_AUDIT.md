# EMS mobile reference and combined Workstel direction

Inspected 5 November 2026 at https://employees.ems.sentec.io/. Companion reference: [PMS audit](SENTEC_UI_AUDIT.md). This is a reference audit and design recommendation, not a claim that the Workstel UI has been changed or that every EMS state is verified.

## Evidence and scope

An existing authenticated session was available. Inspection used browser screenshots, rendered DOM and read-only computed styles. Employee records, salary values, personal reasons, photos and credentials are not retained in this report. No attendance check-in, approval, submission, upload or account update was performed.

33 navigation routes were opened at 390 x 844. A visible main container was required before each structural sample, but this does not establish that every asynchronous widget had settled. Deep component inspection focused on the dashboard, leave-request cards, date/status filters, leave-request form, calendar, textarea, attachment controls, disabled confirmation and expandable request overview.

## Measured EMS styles

| Element               | Observed style                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Application           | Quicksand; 16px; weight 400; background #F4F5FA; text rgba(58,53,65,.68)                                                           |
| Mobile header sample  | 64px high; icon utilities and profile control                                                                                      |
| Dashboard cards       | White; radius 12px; shadow 0 4px 5px -2px rgba(58,53,65,.08), 0 2px 10px 1px rgba(58,53,65,.12), 0 2px 16px 1px rgba(58,53,65,.04) |
| Other card variants   | Leave-list cards also include 6px radius; 12px is not universal                                                                    |
| Tabs                  | 40px high; 14px; weight 500; horizontal padding 22px; radius 5px                                                                   |
| Default button sample | 38px high; 14px; weight 500; horizontal padding 22px; radius 5px                                                                   |
| Icon button sample    | 42 x 42px; circular                                                                                                                |
| Field                 | 40px high; radius 6px; 16px typography                                                                                             |
| Label                 | 16px; observed line box 24px                                                                                                       |
| Leave textarea        | 96px high and 287px wide at 390px viewport; radius 6px                                                                             |
| Upload-photo button   | 48px high; 16px; radius 5px                                                                                                        |
| Expandable overview   | 51px high, 285px wide at 390px; 16px; radius 6px                                                                                   |
| Reset and confirm     | Each 295px wide and 38px high at 390px; 14px; radius 5px                                                                           |
| Calendar navigation   | Observed 28 x 30px arrow controls; month control 30px high                                                                         |

These values are measured variants, not universal component defaults. Several EMS controls are smaller than Workstel's 44px mobile touch-target requirement.

## Mobile interaction patterns

- The header presents compact icons; the navigation drawer contains grouped employee features.
- The dashboard uses a profile/context summary, Feed/My Info tabs, dated schedule cards and update cards. These are domain-specific content patterns.
- Leave requests use individual cards with a date heading, status and record actions, plus date-range/status filters and pagination.
- The new-request form places a calendar, reason, attachment controls, expandable overview and confirmation actions in a vertical flow.
- The overview can expand while the form is incomplete and displays a helpful empty instruction. Confirmation stays disabled in the observed incomplete state.
- Textarea width changes with the viewport. Observed viewport/document/textarea widths: 360/345/257, 390/375/287 and 768/753/665 pixels. None exceeded the viewport in these form observations.
- A floating attendance action exists. Its operational flow was not opened because the reference task concerns UI styling.

## Route-level coverage

The following routes were opened at 390 x 844. Document widths sampled were 375px except /attendance/schedule/request, /leave/calendar, /training/upcoming and /training/history, which sampled at 390px. No sampled width exceeded the viewport. Repeat after asynchronous content settles before claiming full responsiveness.

- /
- /me/profile
- /me/contracts
- /me/letters
- /me/teams
- /organization/chart
- /employee
- /attendance/schedule
- /attendance/schedule/proposal
- /attendance/schedule/plan
- /attendance/schedule/request
- /attendance/record/request
- /attendance/record
- /attendance/overtime/request
- /attendance/overtime/approval
- /attendance/overtime/record
- /performance/report
- /performance/my-report
- /performance/my-kpis
- /finance/loan
- /payroll/salary-slip
- /leave/request
- /leave/approval
- /leave/balance/personal
- /leave/calendar
- /training/upcoming
- /training/history
- /training/history/trainer
- /form-submission
- /form-submission/approval
- /task-reporting
- /task-reporting/approval
- /me/setting

The additional /leave/request/form route received detailed control and responsive inspection. Route visits do not establish full create/edit, approval, financial, authentication or failure-state coverage.

## Combined PMS + EMS recommendation for Workstel

| Area                  | Combined direction                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Material tokens       | Keep approved Workstel/PMS #0096C7 primary, #F2F5F8 background, 6px radius and measured shadows; EMS tokens document a separate design variant                                            |
| Typography            | Keep Quicksand and Noto Sans. Use EMS's readable 16px input presentation where it improves mobile forms, subject to implementation review                                                 |
| Desktop data          | Use PMS's compact hierarchy, meaningful table headers and internal table scrolling                                                                                                        |
| Mobile data           | Prefer EMS-style record cards with a clear title, metadata, status and focused actions; keep dense tables inside labeled scrolling regions when columns must remain comparable            |
| Search/filter         | Keep search prominent and filters behind a nearby 44px control. Show active-filter state and individual clear/reset actions                                                               |
| Forms                 | Use a vertical mobile flow with visible labels and inline feedback. Put optional details or summaries behind deliberate disclosure. Keep confirmation visibly tied to validation          |
| Actions               | Use full-width primary actions where appropriate on narrow forms. Raise undersized EMS calendar/buttons to at least 44px targets                                                          |
| Navigation            | Preserve approved Workstel header and mobile navigation. EMS drawer and floating attendance action are references, not automatic navigation replacements                                  |
| Status/context        | Use compact context and status labels; do not reproduce employee identity widgets, payroll cards or fabricated dashboard metrics                                                          |
| Responsive acceptance | Inspect fully settled pages at 360px and 390px, including long English/Indonesian system copy, open filters, validation and keyboard focus. Require no document-level horizontal overflow |

## Remaining verification

Deep interaction coverage remains open for calendar selection/range states, dropdown keyboard behavior, focus restoration, loading/error/empty variants, attachment validation, and other module-specific dialogs. No business action was submitted to manufacture these states. Workstel changes should be reviewed against the approved baseline and verified at matching viewports; this audit alone does not certify Workstel accessibility or responsiveness.
