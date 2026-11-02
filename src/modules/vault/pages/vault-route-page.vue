<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import { runtime } from '../../../config/runtime';
import type { StaffAssignment } from '../../../auth/useAuth';
import { t } from '../../../i18n';
defineProps<{ assignments: StaffAssignment[]; available: boolean }>();
defineEmits<{ back: [] }>();
const DemoPage = defineAsyncComponent(() => import('./ModuleListPage.vue'));
const LivePage = defineAsyncComponent(() => import('./VaultLivePage.vue'));
</script>
<template>
  <DemoPage
    v-if="runtime.demo"
    @back="$emit('back')"
  />
  <LivePage
    v-else-if="available"
    :assignments="assignments"
    @back="$emit('back')"
  />
  <v-alert
    v-else
    type="warning"
    variant="tonal"
    >{{ t('temporarilyUnavailable') }}</v-alert
  >
</template>
