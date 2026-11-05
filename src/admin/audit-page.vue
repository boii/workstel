<script setup lang="ts">
import { computed } from 'vue';
import { locale } from '../i18n';
import AuditLog from './audit-log.vue';
import en from './locales/en';
import id from './locales/id';
// UI gating only; workstel_admin_list_audit enforces platform-admin access on the server.
defineProps<{ demo: boolean; platformAdmin: boolean }>();
const messages = computed(() => (locale.value === 'id' ? id : en));
</script>
<template>
  <AuditLog
    v-if="platformAdmin"
    :demo="demo"
  />
  <v-alert
    v-else
    type="warning"
    variant="tonal"
    role="alert"
    >{{ messages.auditDenied }}</v-alert
  >
</template>
