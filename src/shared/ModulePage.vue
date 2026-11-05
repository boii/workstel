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
  gap: 16px;
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
  gap: 8px;
}
.module-page h1 {
  font-size: clamp(23px, 2vw, 26px);
  font-weight: 400;
}
.module-page p {
  font-size: 13px;
  color: var(--workstel-text-secondary);
  line-height: 1.7;
  margin-top: 8px;
}
.module-page-toolbar {
  margin: 20px 0;
}
.module-page {
  container-type: inline-size;
}
.module-empty {
  padding: 30px;
  text-align: center;
}
.module-empty-icon {
  margin-bottom: 10px;
  color: var(--workstel-primary-text);
  opacity: 0.8;
}
.module-empty :deep(.v-btn) {
  margin-top: 14px;
}
.module-skeleton--list {
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--workstel-border);
  border-radius: 6px;
  overflow: hidden;
}
.module-skeleton-row + .module-skeleton-row {
  border-top: 1px solid var(--workstel-border);
}
.module-skeleton--grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.module-skeleton-tile {
  border: 1px solid var(--workstel-border);
  border-radius: 6px;
  min-height: 92px;
}
.module-empty h2 {
  font-size: 18px;
  font-weight: 500;
}
@media (max-width: 680px) {
  .module-page-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  /* In a column the 240px basis would become height and leave an empty gap. */
  .module-page-title {
    flex-basis: auto;
    width: 100%;
  }
  .module-page h1 {
    font-size: 23px;
  }
  .module-page-actions {
    width: 100%;
    justify-content: flex-start;
  }
  .module-page-actions :deep(.v-btn) {
    min-height: 44px;
  }
}
</style>
