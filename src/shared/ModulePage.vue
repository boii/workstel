<script setup lang="ts">
defineProps<{
  title: string;
  description: string;
  loading?: boolean;
  error?: string;
  empty?: boolean;
  emptyTitle: string;
  emptyDescription: string;
  retryLabel: string;
}>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <section
    class="module-page"
    :aria-busy="loading"
  >
    <div class="module-page-heading">
      <div>
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
      </div>
      <div><slot name="actions" /></div>
    </div>
    <div class="module-page-toolbar"><slot name="toolbar" /></div>
    <v-skeleton-loader
      v-if="loading"
      type="table"
    /><v-alert
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
      ><h2>{{ emptyTitle }}</h2>
      <p>{{ emptyDescription }}</p>
      <slot name="empty-action"
    /></v-card>
    <div v-else><slot /></div>
  </section>
</template>
<style scoped>
.module-page-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.module-page h1 {
  font-size: 26px;
  font-weight: 400;
}
.module-page p {
  font-size: 13px;
  color: #73818b;
  margin-top: 8px;
}
.module-page-toolbar {
  margin: 20px 0;
}
.module-empty {
  padding: 30px;
  text-align: center;
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
  .module-page h1 {
    font-size: 23px;
  }
}
</style>
