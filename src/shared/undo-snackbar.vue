<script setup lang="ts">
import { t } from '../i18n';

/** Module notice snackbar; with an undo callback it shows Undo and stays longer. */
const props = defineProps<{ message: string; undo: (() => void) | null }>();
const emit = defineEmits<{ close: [] }>();
</script>
<template>
  <v-snackbar
    :model-value="!!props.message"
    :timeout="props.undo ? 6000 : 3000"
    @update:model-value="emit('close')"
    >{{ props.message
    }}<template
      v-if="props.undo"
      #actions
      ><v-btn
        variant="text"
        class="undo-snackbar-action"
        @click="props.undo()"
        >{{ t('undo') }}</v-btn
      ></template
    ></v-snackbar
  >
</template>
<style scoped>
.undo-snackbar-action {
  min-height: 44px;
  font-weight: var(--workstel-weight-bold);
}
</style>
