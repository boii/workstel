<script setup lang="ts">
/**
 * The ⋮ menu for a record's further actions, and any other small action menu. It opens
 * below the trigger, aligned to its right edge, with a compact list. Put `v-list-item`s in
 * the default slot. Without an `#activator` slot it renders the ⋮ icon button, named by
 * `label`; pass `#activator="{ props }"` for a different trigger.
 */
withDefaults(
  defineProps<{
    /** Accessible name of the ⋮ button; name the record, as in "More actions — Bath towel". */
    label?: string;
    disabled?: boolean;
    /** Opens above the trigger instead, for menus in a dialog footer. */
    above?: boolean;
    /** Keeps short header menus from shrinking to their longest label. */
    minWidth?: number;
  }>(),
  { label: '', disabled: false, above: false, minWidth: undefined },
);
</script>
<template>
  <v-menu :location="above ? 'top end' : 'bottom end'">
    <template #activator="{ props: menu }">
      <slot
        name="activator"
        :props="menu"
      >
        <v-btn
          v-bind="menu"
          icon="mdi-dots-vertical"
          variant="text"
          :disabled="disabled"
          :aria-label="label"
          :title="label"
        />
      </slot>
    </template>
    <v-list
      density="compact"
      :min-width="minWidth"
      ><slot
    /></v-list>
  </v-menu>
</template>
