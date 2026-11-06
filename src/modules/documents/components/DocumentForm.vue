<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import OptionalFields from '../../../shared/optional-fields.vue';
import { t } from '../../../i18n';
import {
  categoryKeys,
  errorMessage,
  useDocumentsMessages,
} from '../composables/useDocumentsMessages';
import { categories } from '../types';
import type { DocumentInput, DocumentLink } from '../types';
import { validateDocument } from '../validation';
import type { DocumentField, ValidationError } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  document: DocumentLink | null;
  departments: { id: string; name: string }[];
  save: (input: DocumentInput) => Promise<void>;
}>();
const messages = useDocumentsMessages();
const draft = ref<DocumentInput>({
  title: '',
  category: 'sop',
  url: '',
  description: '',
  departmentId: '',
});
const errors = ref<Partial<Record<DocumentField, ValidationError>>>({});
const saving = ref(false);
const failure = ref('');
watch(open, (value) => {
  if (!value) return;
  const document = props.document;
  draft.value = document
    ? {
        title: document.title,
        category: document.category,
        url: document.url,
        description: document.description,
        departmentId: document.departmentId,
      }
    : {
        title: '',
        category: 'sop',
        url: '',
        description: '',
        departmentId: props.departments[0]?.id ?? '',
      };
  errors.value = {};
  failure.value = '';
});
const categoryItems = computed(() =>
  categories.map((value) => ({ value, title: messages.value[categoryKeys[value]] })),
);
async function submit() {
  if (saving.value) return;
  errors.value = validateDocument(draft.value);
  const invalid = Object.keys(errors.value)[0];
  if (invalid) {
    document.getElementById('document-' + invalid)?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.save({ ...draft.value });
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
const fieldError = (field: DocumentField) =>
  errors.value[field] ? messages.value[errors.value[field]!] : '';
</script>
<template>
  <ModuleDialog
    v-model="open"
    sheet
    :title="document ? messages.edit : messages.add"
    :busy="saving"
  >
    <v-form
      id="document-form"
      @submit.prevent="submit"
    >
      <v-alert
        v-if="failure"
        type="error"
        variant="tonal"
        role="alert"
        class="mb-4"
        >{{ failure }}</v-alert
      >
      <label
        for="document-title"
        class="field-label document-first-label"
        >{{ messages.name }}</label
      ><v-text-field
        id="document-title"
        v-model="draft.title"
        :disabled="saving"
        :placeholder="messages.namePlaceholder"
        maxlength="150"
        autofocus
        :error-messages="fieldError('title')"
      /><label
        for="document-url"
        class="field-label"
        >{{ messages.link }}</label
      ><v-text-field
        id="document-url"
        v-model="draft.url"
        type="url"
        inputmode="url"
        autocomplete="off"
        :disabled="saving"
        :placeholder="messages.linkPlaceholder"
        :hint="messages.linkHint"
        persistent-hint
        maxlength="2048"
        :error-messages="fieldError('url')"
      />
      <div class="document-form-grid">
        <div>
          <label
            for="document-category"
            class="field-label"
            >{{ messages.category }}</label
          ><v-select
            id="document-category"
            v-model="draft.category"
            :disabled="saving"
            :items="categoryItems"
            :error-messages="fieldError('category')"
          />
        </div>
        <div>
          <label
            for="document-departmentId"
            class="field-label"
            >{{ messages.department }}</label
          ><v-select
            id="document-departmentId"
            v-model="draft.departmentId"
            :disabled="saving"
            :items="departments"
            item-title="name"
            item-value="id"
            :error-messages="fieldError('departmentId')"
          />
        </div>
      </div>
      <OptionalFields
        :label="t('addNotes')"
        :filled="!!draft.description || !!fieldError('description')"
        :reset-key="open"
      >
        <label
          for="document-description"
          class="field-label"
          >{{ messages.notes }}</label
        ><v-textarea
          id="document-description"
          v-model="draft.description"
          :disabled="saving"
          rows="2"
          auto-grow
          maxlength="500"
          :hint="messages.notesHint"
          persistent-hint
          :error-messages="fieldError('description')"
        />
      </OptionalFields>
    </v-form>
    <template #actions>
      <v-btn
        variant="text"
        :disabled="saving"
        @click="open = false"
        >{{ messages.cancel }}</v-btn
      ><v-btn
        color="primary"
        type="submit"
        form="document-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.save }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
<style scoped>
.document-first-label {
  margin-top: 0;
}
.document-form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--workstel-space-3);
}
/* Category and department stay side by side on phones; only very narrow screens stack them. */
@media (max-width: 359px) {
  .document-form-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
}
</style>
