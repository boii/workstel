<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useDisplay } from 'vuetify';
import { t } from '../i18n';
import { usePersistedRef } from '../core/use-persisted-ref';
import { focusFieldInput } from '../core/focus-field';
import type { FocusableField } from '../core/focus-field';

export interface PaletteItem {
  /** Stable identifier, also used to remember recent picks. */
  id: string;
  group: 'pages' | 'modules' | 'actions';
  title: string;
  /** Extra words that match the search, such as the English title in other locales. */
  keywords?: string;
  subtitle?: string;
  icon: string;
  disabled?: boolean;
  run: () => void;
}

const open = defineModel<boolean>({ required: true });
const props = defineProps<{ items: PaletteItem[] }>();
const { width } = useDisplay();
const fullscreen = computed(() => width.value <= 680);
const query = ref('');
const active = ref(0);
const listRef = ref<HTMLElement | null>(null);
const searchField = ref<FocusableField | null>(null);
// Only item identifiers are remembered; no record data leaves the session.
const recent = usePersistedRef<string[]>(
  'workstel.palette.recent',
  [],
  (value): value is string[] =>
    Array.isArray(value) && value.length <= 5 && value.every((id) => typeof id === 'string'),
);

const groupLabels = computed(() => ({
  recent: t('paletteRecent'),
  pages: t('palettePages'),
  modules: t('paletteModules'),
  actions: t('paletteActions'),
}));

interface Row {
  item: PaletteItem;
  group: keyof typeof groupLabels.value;
}

function score(item: PaletteItem, needle: string) {
  const title = item.title.toLowerCase();
  if (title.startsWith(needle)) return 0;
  if (title.split(/\s+/).some((word) => word.startsWith(needle))) return 1;
  if ((title + ' ' + (item.keywords ?? '')).toLowerCase().includes(needle)) return 2;
  return -1;
}

const rows = computed<Row[]>(() => {
  const needle = query.value.trim().toLowerCase();
  if (needle) {
    return props.items
      .map((item) => ({ item, rank: score(item, needle) }))
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank)
      .map(({ item }) => ({ item, group: item.group }));
  }
  const recentItems = recent.value
    .map((id) => props.items.find((item) => item.id === id && !item.disabled))
    .filter((item): item is PaletteItem => !!item);
  const recentIds = new Set(recentItems.map((item) => item.id));
  return [
    ...recentItems.map((item) => ({ item, group: 'recent' as const })),
    ...props.items
      .filter((item) => !recentIds.has(item.id))
      .map((item) => ({ item, group: item.group })),
  ];
});

/** Rows grouped for display; indexes stay global so keyboard navigation spans groups. */
const sections = computed(() => {
  const result: { key: Row['group']; rows: { row: Row; index: number }[] }[] = [];
  rows.value.forEach((row, index) => {
    const last = result[result.length - 1];
    if (last && last.key === row.group) last.rows.push({ row, index });
    else result.push({ key: row.group, rows: [{ row, index }] });
  });
  return result;
});

// Focus the search as soon as the field renders; the dialog's own autofocus waits for the
// opening transition, which drops keys typed straight after Ctrl/⌘ + K or a tap.
watch(open, (value) => {
  if (!value) return;
  query.value = '';
  active.value = firstEnabled(0, 1);
  void nextTick(() => focusFieldInput(searchField.value));
});
watch(query, () => {
  active.value = firstEnabled(0, 1);
});

function firstEnabled(start: number, step: 1 | -1) {
  const count = rows.value.length;
  for (let offset = 0; offset < count; offset++) {
    const index = (start + offset * step + count) % count;
    if (!rows.value[index].item.disabled) return index;
  }
  return -1;
}

function move(step: 1 | -1) {
  if (!rows.value.length) return;
  active.value = firstEnabled(active.value + step, step);
  void nextTick(() => {
    listRef.value
      ?.querySelector<HTMLElement>(`[data-index="${active.value}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  });
}

function choose(index: number) {
  const row = rows.value[index];
  if (!row || row.item.disabled) return;
  recent.value = [row.item.id, ...recent.value.filter((id) => id !== row.item.id)].slice(0, 5);
  open.value = false;
  row.item.run();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    move(1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    move(-1);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    choose(active.value);
  }
}
</script>
<template>
  <v-dialog
    v-model="open"
    :fullscreen="fullscreen"
    :max-width="fullscreen ? undefined : 600"
    :transition="fullscreen ? 'dialog-bottom-transition' : 'dialog-transition'"
    class="palette-dialog"
    :aria-label="t('paletteTitle')"
    scrollable
  >
    <v-card class="palette">
      <div class="palette-search">
        <v-text-field
          ref="searchField"
          v-model="query"
          :placeholder="t('palettePlaceholder')"
          :aria-label="t('palettePlaceholder')"
          prepend-inner-icon="mdi-magnify"
          single-line
          hide-details
          variant="plain"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="palette-results"
          :aria-expanded="true"
          :aria-activedescendant="active >= 0 ? `palette-option-${active}` : undefined"
          @keydown="onKeydown"
        />
        <v-btn
          v-if="fullscreen"
          variant="text"
          color="primary"
          class="palette-cancel"
          @click="open = false"
          >{{ t('paletteCancel') }}</v-btn
        >
        <kbd
          v-else
          class="palette-esc"
          >Esc</kbd
        >
      </div>
      <div
        id="palette-results"
        ref="listRef"
        class="palette-results"
        role="listbox"
        :aria-label="t('paletteTitle')"
      >
        <p
          v-if="!rows.length"
          class="palette-empty"
        >
          {{ t('paletteEmpty') }}
        </p>
        <section
          v-for="section in sections"
          :key="section.key"
          role="group"
          :aria-label="groupLabels[section.key]"
        >
          <h3>{{ groupLabels[section.key] }}</h3>
          <div
            v-for="{ row, index } in section.rows"
            :id="`palette-option-${index}`"
            :key="section.key + row.item.id"
            :data-index="index"
            class="palette-option"
            :class="{ 'palette-option--active': index === active }"
            role="option"
            :aria-selected="index === active"
            :aria-disabled="row.item.disabled || undefined"
            @click="choose(index)"
            @mousemove="!row.item.disabled && (active = index)"
          >
            <v-icon
              :icon="row.item.icon"
              size="20"
            />
            <span class="palette-option-text">
              <strong>{{ row.item.title }}</strong>
              <small v-if="row.item.subtitle">{{ row.item.subtitle }}</small>
            </span>
            <v-icon
              v-if="index === active && !fullscreen"
              icon="mdi-keyboard-return"
              size="16"
              class="palette-enter"
            />
          </div>
        </section>
      </div>
      <footer
        v-if="!fullscreen"
        class="palette-footer"
      >
        <span><kbd>↑</kbd><kbd>↓</kbd>{{ t('paletteNavigate') }}</span>
        <span><kbd>Enter</kbd>{{ t('paletteOpen') }}</span>
        <span><kbd>Esc</kbd>{{ t('close') }}</span>
      </footer>
    </v-card>
  </v-dialog>
</template>
<style scoped>
.palette-dialog :deep(.v-overlay__content) {
  align-self: flex-start;
  margin-top: 12vh;
}
.palette-dialog :deep(.v-overlay__content.v-dialog--fullscreen),
.v-dialog--fullscreen :deep(.v-overlay__content) {
  margin-top: 0;
}
.palette {
  display: flex;
  flex-direction: column;
  max-height: min(560px, 76vh);
  overflow: hidden;
}
.v-dialog--fullscreen .palette {
  max-height: none;
  height: 100%;
  border-radius: 0;
}
.palette-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 14px 4px 6px;
  border-bottom: 1px solid var(--workstel-border);
}
.palette-search .v-text-field {
  flex: 1;
}
.palette-search :deep(input) {
  font-size: 16px;
}
.palette-results {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px 10px;
  overscroll-behavior: contain;
}
.palette-results h3 {
  margin: 10px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--workstel-text-secondary);
}
.palette-option {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: rgba(0, 0, 0, 0.87);
}
.palette-option > .v-icon {
  color: var(--workstel-text-secondary);
  flex-shrink: 0;
}
.palette-option--active {
  background: rgba(0, 150, 199, 0.1);
}
.palette-option--active > .v-icon:first-child {
  color: var(--workstel-primary-text);
}
.palette-option[aria-disabled='true'] {
  cursor: default;
  opacity: 0.55;
}
.palette-option-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.palette-option-text strong {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.palette-option-text small {
  font-size: 11px;
  color: var(--workstel-text-secondary);
}
.palette-enter {
  color: var(--workstel-text-secondary);
}
.palette-empty {
  padding: 28px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--workstel-text-secondary);
}
.palette-footer {
  display: flex;
  gap: 18px;
  padding: 9px 16px;
  border-top: 1px solid var(--workstel-border);
  font-size: 11px;
  color: var(--workstel-text-secondary);
  background: #f7f9fa;
}
.palette-footer span {
  display: flex;
  align-items: center;
  gap: 4px;
}
kbd {
  font: inherit;
  font-size: 11px;
  min-width: 20px;
  padding: 1px 5px;
  text-align: center;
  border: 1px solid var(--workstel-border);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: white;
  color: var(--workstel-text-secondary);
}
.palette-esc {
  flex-shrink: 0;
}
.palette-cancel {
  min-height: 44px;
}
</style>
