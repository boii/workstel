<script setup lang="ts">
import { dialogWidth } from '../shared/dialog-widths';
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../shared/module-dialog.vue';
import OptionalFields from '../shared/optional-fields.vue';
import { t } from '../i18n';
import type { MessageKey } from '../i18n';
import { profileMaxLength, useProfile, validateProfile } from './use-profile';
import type { ProfileErrors, ProfileField } from './use-profile';

const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [] }>();
const { profile, save } = useProfile();
const draft = ref<Record<ProfileField, string>>({ displayName: '', jobTitle: '', extension: '' });
const errors = ref<ProfileErrors>({});
const failure = ref<MessageKey | ''>('');
const saving = ref(false);

watch(open, (value) => {
  if (!value) return;
  draft.value = {
    displayName: profile.value.displayName ?? '',
    jobTitle: profile.value.jobTitle ?? '',
    extension: profile.value.extension ?? '',
  };
  errors.value = {};
  failure.value = '';
});
const detailsFilled = computed(
  () =>
    !!draft.value.jobTitle ||
    !!draft.value.extension ||
    !!errors.value.jobTitle ||
    !!errors.value.extension,
);
const fieldError = (field: ProfileField) => (errors.value[field] ? t(errors.value[field]!) : '');

async function submit() {
  if (saving.value) return;
  errors.value = validateProfile(draft.value);
  if (Object.keys(errors.value).length) return;
  saving.value = true;
  failure.value = '';
  try {
    await save({ ...draft.value });
    open.value = false;
    emit('saved');
  } catch {
    failure.value = 'profileSaveFailed';
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <ModuleDialog
    v-model="open"
    sheet
    :title="t('editProfile')"
    :busy="saving"
    :width="dialogWidth.md"
  >
    <v-form
      id="profile-form"
      @submit.prevent="submit"
    >
      <v-alert
        v-if="failure"
        type="error"
        variant="tonal"
        density="compact"
        role="alert"
        class="mb-2"
        >{{ t(failure) }}</v-alert
      >
      <label
        for="profile-display-name"
        class="field-label profile-first-label"
        >{{ t('displayName') }}</label
      ><v-text-field
        id="profile-display-name"
        v-model="draft.displayName"
        autocomplete="name"
        :maxlength="profileMaxLength.displayName"
        :disabled="saving"
        :hint="t('displayNameHint')"
        persistent-hint
        :error-messages="fieldError('displayName')"
      />
      <OptionalFields
        :label="t('addProfileDetails')"
        :filled="detailsFilled"
        :reset-key="open"
      >
        <div class="profile-form-pair">
          <div>
            <label
              for="profile-job-title"
              class="field-label"
              >{{ t('jobTitle') }}</label
            ><v-text-field
              id="profile-job-title"
              v-model="draft.jobTitle"
              autocomplete="organization-title"
              :maxlength="profileMaxLength.jobTitle"
              :disabled="saving"
              :error-messages="fieldError('jobTitle')"
            />
          </div>
          <div>
            <label
              for="profile-extension"
              class="field-label"
              >{{ t('extensionLabel') }}</label
            ><v-text-field
              id="profile-extension"
              v-model="draft.extension"
              inputmode="tel"
              autocomplete="tel-extension"
              :maxlength="profileMaxLength.extension"
              :disabled="saving"
              :error-messages="fieldError('extension')"
            />
          </div>
        </div>
      </OptionalFields>
    </v-form>
    <template #actions>
      <v-btn
        variant="text"
        :disabled="saving"
        @click="open = false"
        >{{ t('cancelAction') }}</v-btn
      ><v-btn
        color="primary"
        type="submit"
        form="profile-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ t('saveProfile') }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
<style scoped>
.profile-first-label {
  margin-top: 0 !important;
}
.profile-form-pair {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 0 var(--workstel-space-3);
}
/* Paired fields stay side by side on phones and stack only on the narrowest screens. */
@media (max-width: 359px) {
  .profile-form-pair {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
