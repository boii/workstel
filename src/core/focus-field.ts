/** The shape Vuetify fields expose: a root element that owns a native input. */
export interface FocusableField {
  $el?: { querySelector: (selector: string) => { focus: () => void } | null };
}

/** Focuses the native input inside a Vuetify text field or select. */
export function focusFieldInput(field: FocusableField | null | undefined) {
  field?.$el?.querySelector('input')?.focus();
}
