/**
 * Dialog widths in px, the one place they are set. Vuetify and ModuleDialog take them as
 * numeric props, so they live here rather than in CSS custom properties.
 * Short forms and confirmations use `md`, long forms `xl`, details and tables the wider steps.
 */
export const dialogWidth = {
  /** Info dialogs: keyboard shortcuts, module switches, sharing. */
  xs: 420,
  /** Vault entry forms. */
  sm: 440,
  /** Short forms and confirmations. */
  md: 460,
  /** Vuetify VDialog default and the room timer. */
  base: 520,
  /** ModuleDialog default. */
  lg: 560,
  /** Long forms: deals and vehicle inspections. */
  xl: 620,
  /** Stock ledger table. */
  '2xl': 680,
  /** Account detail. */
  '3xl': 720,
  /** User dialog with department grants. */
  '4xl': 760,
  /** Audit history. */
  '5xl': 960,
} as const;
