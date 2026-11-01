<script setup lang="ts">
import { ref } from 'vue';
import { t } from '../i18n';
const props = defineProps<{ busy: boolean; disabled: boolean }>();
const emit = defineEmits<{ signIn: [email: string, password: string] }>();
const email = ref(''),
  password = ref('');
function submit() {
  if (props.busy || props.disabled || !email.value.trim() || !password.value) return;
  emit('signIn', email.value, password.value);
  password.value = '';
}
</script>
<template>
  <v-form
    class="password-login"
    @submit.prevent="submit"
    ><label
      for="login-email"
      class="field-label"
      >{{ t('emailLabel') }}</label
    ><v-text-field
      id="login-email"
      v-model="email"
      type="email"
      autocomplete="username"
      required
      :disabled="disabled || busy"
    /><label
      for="login-password"
      class="field-label"
      >{{ t('passwordLabel') }}</label
    ><v-text-field
      id="login-password"
      v-model="password"
      type="password"
      autocomplete="current-password"
      required
      :disabled="disabled || busy"
    /><v-btn
      color="primary"
      block
      type="submit"
      :loading="busy"
      :disabled="disabled || !email.trim() || !password"
      >{{ t('passwordSignIn') }}</v-btn
    ></v-form
  >
</template>
