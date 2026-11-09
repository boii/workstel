<script setup lang="ts">
import { t } from '../i18n';

withDefaults(
  defineProps<{
    title: string;
    description: string;
    loading?: boolean;
    error?: string;
    empty?: boolean;
    emptyTitle: string;
    emptyDescription: string;
    /** MDI icon shown above the empty-state title. */
    emptyIcon?: string;
    retryLabel: string;
    /** Loading placeholder shaped like the content: record rows or a tile grid. */
    skeleton?: 'list' | 'grid';
  }>(),
  { skeleton: 'list', emptyIcon: undefined, error: '' },
);
defineEmits<{ retry: [] }>();
</script>
<template>
  <section
    class="module-page"
    :aria-busy="loading"
  >
    <div class="module-page-heading">
      <div class="module-page-title">
        <h1>{{ title }}</h1>
        <!-- A count read before the first response would show a misleading zero. -->
        <p>{{ loading ? t('loadingRecords') : description }}</p>
      </div>
      <div class="module-page-actions"><slot name="actions" /></div>
    </div>
    <div class="module-page-toolbar"><slot name="toolbar" /></div>
    <div
      v-if="loading"
      class="module-skeleton"
      :class="'module-skeleton--' + skeleton"
      role="status"
      :aria-label="t('loadingRecords')"
    >
      <template v-if="skeleton === 'grid'">
        <v-skeleton-loader
          v-for="n in 9"
          :key="n"
          type="heading, text"
          class="module-skeleton-tile"
        />
      </template>
      <v-skeleton-loader
        v-for="n in 5"
        v-else
        :key="n"
        type="list-item-avatar-two-line"
        class="module-skeleton-row"
      />
    </div>
    <v-alert
      v-else-if="error"
      type="error"
      variant="tonal"
      role="alert"
      >{{ error
      }}<v-btn
        variant="text"
        @click="$emit('retry')"
        >{{ retryLabel }}</v-btn
      ></v-alert
    ><v-card
      v-else-if="empty"
      class="module-empty"
      ><v-icon
        v-if="emptyIcon"
        :icon="emptyIcon"
        size="36"
        class="module-empty-icon" />
      <h2>{{ emptyTitle }}</h2>
      <p>{{ emptyDescription }}</p>
      <slot name="empty-action"
    /></v-card>
    <div
      v-else
      class="module-page-content"
    >
      <slot />
    </div>
  </section>
</template>
<style scoped>
.module-page-heading {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--workstel-space-4);
}
.module-page,
.module-page-title,
.module-page-content {
  min-width: 0;
}
.module-page-title {
  flex: 1 1 240px;
  overflow-wrap: anywhere;
}
.module-page-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--workstel-space-2);
}
.module-page-actions:empty {
  display: none;
}
.module-page h1 {
  font-size: var(--workstel-font-xl);
  font-weight: var(--workstel-weight-regular);
}
.module-page p {
  font-size: var(--workstel-font-sm);
  color: var(--workstel-text-secondary);
  line-height: var(--workstel-leading-loose);
  margin-top: var(--workstel-space-2);
}
.module-page-toolbar {
  margin: var(--workstel-space-5) 0;
}
.module-page {
  container-type: inline-size;
}
.module-empty {
  padding: 30px;
  text-align: center;
}
.module-empty-icon {
  margin-bottom: var(--workstel-space-2_5);
  color: var(--workstel-primary-text);
  opacity: 0.8;
}
.module-empty :deep(.v-btn) {
  margin-top: var(--workstel-space-3_5);
}
.module-skeleton--list {
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--workstel-border);
  border-radius: var(--workstel-radius-md);
  overflow: hidden;
}
.module-skeleton-row + .module-skeleton-row {
  border-top: 1px solid var(--workstel-border);
}
.module-skeleton--grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--workstel-space-2_5);
}
.module-skeleton-tile {
  border: 1px solid var(--workstel-border);
  border-radius: var(--workstel-radius-md);
  min-height: 92px;
}
.module-empty h2 {
  font-size: var(--workstel-font-lg);
  font-weight: var(--workstel-weight-medium);
}
@media (max-width: 680px) {
  .module-page-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: var(--workstel-space-2_5);
  }
  /* In a column the 240px basis would become height and leave an empty gap. */
  .module-page-title {
    flex-basis: auto;
    width: 100%;
  }
  .module-page h1 {
    font-size: var(--workstel-font-xl);
  }
  .module-page p {
    margin-top: var(--workstel-space-1);
    line-height: var(--workstel-leading-normal);
  }
  .module-page-toolbar {
    margin: var(--workstel-space-3_5) 0;
  }
  .module-empty {
    padding: var(--workstel-space-6) var(--workstel-space-4);
  }
  .module-page-actions {
    width: 100%;
    justify-content: flex-start;
  }
  .module-page-actions :deep(.v-btn) {
    min-height: var(--workstel-touch-target);
  }
}
</style>
