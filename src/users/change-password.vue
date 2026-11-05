<script setup lang="ts">
import { ref } from 'vue';
import { t } from '../i18n';
import type { MessageKey } from '../i18n';
import { usersFunction } from './users-api';
import { userErrorKey } from './user-errors';

/** New-password form; the value is sent once to the server and never stored by the page. */
const props = defineProps<{ demo: boolean; required?: boolean }>();
const emit = defineEmits<{ changed: []; signInAgain: []; cancel: [] }>();
const password = ref('');
const confirmation = ref('');
const error = ref<MessageKey | ''>('');
const saving = ref(false);
const reauth = ref(false);

async function submit() {
  if (saving.value) return;
  reauth.value = false;
  if (password.value.trim().length < 12 || new TextEncoder().encode(password.value).length > 72) {
    error.value = 'passwordWeak';
    return;
  }
  if (password.value !== confirmation.value) {
    error.value = 'passwordMismatchShell';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    if (!props.demo) await usersFunction('change-password', { password: password.value });
    password.value = '';
    confirmation.value = '';
    emit('changed');
  } catch (failure) {
    error.value = userErrorKey(failure);
    reauth.value = error.value === 'passwordReauth';
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <v-form
    class="password-form"
    @submit.prevent="submit"
  >
    <p
      v-if="required"
      class="password-required"
    >
      <v-icon
        icon="mdi-lock-alert-outline"
        size="18"
      />{{ t('changePasswordRequired') }}
    </p>
    <v-alert
      v-if="error"
      :type="reauth ? 'info' : 'error'"
      variant="tonal"
      density="compact"
      role="alert"
      class="mb-2"
      >{{ t(error) }}</v-alert
    >
    <label
      for="new-password"
      class="field-label"
      >{{ t('newPassword') }}</label
    ><v-text-field
      id="new-password"
      v-model="password"
      type="password"
      autocomplete="new-password"
      maxlength="128"
      :disabled="saving"
      :hint="t('passwordRules')"
      persistent-hint
    /><label
      for="confirm-password"
      class="field-label"
      >{{ t('confirmPassword') }}</label
    ><v-text-field
      id="confirm-password"
      v-model="confirmation"
      type="password"
      autocomplete="new-password"
      maxlength="128"
      :disabled="saving"
    />
    <div class="password-actions">
      <v-btn
        v-if="reauth"
        variant="outlined"
        prepend-icon="mdi-login"
        @click="emit('signInAgain')"
        >{{ t('signInAgain') }}</v-btn
      ><v-btn
        v-else-if="!required"
        variant="text"
        :disabled="saving"
        @click="emit('cancel')"
        >{{ t('cancelAction') }}</v-btn
      ><v-btn
        color="primary"
        type="submit"
        :loading="saving"
        >{{ t('savePassword') }}</v-btn
      >
    </div>
  </v-form>
</template>
<style scoped>
.password-required {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--workstel-warning-bg);
  color: var(--workstel-warning-text);
  font-size: var(--workstel-font-sm);
  line-height: 1.6;
}
.password-required .v-icon {
  flex-shrink: 0;
  margin-top: 1px;
}
.password-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}
@media (max-width: 680px) {
  .password-actions .v-btn {
    min-height: 44px;
  }
}
</style>
