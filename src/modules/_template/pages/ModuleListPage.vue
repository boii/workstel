<script setup lang="ts">
import { computed, ref } from 'vue';
import ModulePage from '../../../shared/ModulePage.vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import UndoSnackbar from '../../../shared/undo-snackbar.vue';
import { useUndoNotice } from '../../../core/use-optimistic-archive';
import { locale } from '../../../i18n';
import manifest from '../manifest';
import en from '../locales/en';
import id from '../locales/id';
const messages = computed(() => (locale.value === 'id' ? id : en));
const search = ref(''),
  dialog = ref(false),
  name = ref(''),
  error = ref('');
const { notice, undoAction, show: showNotice } = useUndoNotice();
const records = ref<{ id: string; name: string }[]>([]);
const searching = computed(() => !!search.value.trim());
const filtered = computed(() =>
  records.value.filter((record) => record.name.toLowerCase().includes(search.value.toLowerCase())),
);
function openForm() {
  name.value = '';
  error.value = '';
  dialog.value = true;
}
function save() {
  if (!name.value.trim()) {
    error.value = messages.value.required;
    return;
  }
  records.value.push({ id: crypto.randomUUID(), name: name.value.trim() });
  dialog.value = false;
  showNotice(messages.value.created);
}
</script>
<template>
  <ModulePage
    :title="messages.title"
    :description="messages.description"
    :empty="!filtered.length"
    :empty-icon="searching ? 'mdi-filter-off-outline' : manifest.icon"
    :empty-title="searching ? messages.noResults : messages.emptyTitle"
    :empty-description="searching ? messages.noResultsDescription : messages.emptyDescription"
    :retry-label="messages.retry"
  >
    <template #actions
      ><v-btn
        color="primary"
        class="module-primary-action"
        prepend-icon="mdi-plus"
        :aria-label="messages.create"
        @click="openForm()"
        >{{ messages.create }}</v-btn
      ></template
    >
    <template #toolbar
      ><v-alert
        type="info"
        variant="tonal"
        density="compact"
        class="mb-4"
        >{{ messages.demoNotice }}</v-alert
      ><v-text-field
        v-model="search"
        :placeholder="messages.search"
        :aria-label="messages.search"
        prepend-inner-icon="mdi-magnify"
        single-line
        clearable
        maxlength="150"
    /></template>
    <template #empty-action
      ><v-btn
        v-if="searching"
        variant="text"
        color="primary"
        @click="search = ''"
        >{{ messages.reset }}</v-btn
      ><v-btn
        v-else
        variant="tonal"
        color="primary"
        prepend-icon="mdi-plus"
        @click="openForm()"
        >{{ messages.create }}</v-btn
      ></template
    >
    <v-card
      ><v-list :aria-label="messages.records"
        ><v-list-item
          v-for="record in filtered"
          :key="record.id"
          :title="record.name" /></v-list
    ></v-card>
  </ModulePage>
  <ModuleDialog
    v-model="dialog"
    :title="messages.create"
  >
    <v-form
      id="template-record-form"
      @submit.prevent="save"
      ><label
        for="record-name"
        class="field-label mt-0"
        >{{ messages.name }}</label
      ><v-text-field
        id="record-name"
        v-model="name"
        autofocus
        maxlength="150"
        :error-messages="error"
        @update:model-value="error = ''"
    /></v-form>
    <template #actions
      ><v-btn
        variant="text"
        @click="dialog = false"
        >{{ messages.cancel }}</v-btn
      ><v-btn
        color="primary"
        type="submit"
        form="template-record-form"
        >{{ messages.save }}</v-btn
      ></template
    >
  </ModuleDialog>
  <UndoSnackbar
    :message="notice"
    :undo="undoAction"
    @close="showNotice('')"
  />
</template>
