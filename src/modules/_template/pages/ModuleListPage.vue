<script setup lang="ts">
import { computed, ref } from 'vue';
import ModulePage from '../../../shared/ModulePage.vue';
import { locale } from '../../../i18n';
import en from '../locales/en';
import id from '../locales/id';
const messages = computed(() => (locale.value === 'id' ? id : en));
const search = ref(''),
  dialog = ref(false),
  name = ref(''),
  error = ref(''),
  saved = ref(false);
const records = ref<{ id: string; name: string }[]>([]);
const filtered = computed(() =>
  records.value.filter((record) => record.name.toLowerCase().includes(search.value.toLowerCase())),
);
function save() {
  if (!name.value.trim()) {
    error.value = messages.value.required;
    return;
  }
  records.value.push({ id: crypto.randomUUID(), name: name.value.trim() });
  name.value = '';
  error.value = '';
  dialog.value = false;
  saved.value = true;
}
</script>
<template>
  <ModulePage
    :title="messages.title"
    :description="messages.description"
    :empty="!filtered.length"
    :empty-title="records.length ? messages.noResults : messages.emptyTitle"
    :empty-description="records.length ? messages.noResultsDescription : messages.emptyDescription"
    :retry-label="messages.retry"
  >
    <template #actions
      ><v-btn
        color="primary"
        prepend-icon="mdi-plus"
        @click="dialog = true"
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
        :label="messages.search"
        prepend-inner-icon="mdi-magnify"
    /></template>
    <v-card
      ><v-list :aria-label="messages.records"
        ><v-list-item
          v-for="record in filtered"
          :key="record.id"
          :title="record.name" /></v-list
    ></v-card> </ModulePage
  ><v-dialog
    v-model="dialog"
    max-width="480"
    ><v-card class="pa-6"
      ><h2>{{ messages.create }}</h2>
      <v-form @submit.prevent="save"
        ><label
          for="record-name"
          class="field-label"
          >{{ messages.name }}</label
        ><v-text-field
          id="record-name"
          v-model="name"
          autofocus
          maxlength="150"
          :error-messages="error"
          @update:model-value="error = ''"
        />
        <div class="d-flex ga-2 mt-4">
          <v-btn
            color="primary"
            type="submit"
            >{{ messages.save }}</v-btn
          ><v-btn
            variant="text"
            @click="dialog = false"
            >{{ messages.cancel }}</v-btn
          >
        </div></v-form
      ></v-card
    ></v-dialog
  ><v-snackbar v-model="saved"
    >{{ messages.created
    }}<template #actions
      ><v-btn
        variant="text"
        @click="saved = false"
        >{{ messages.close }}</v-btn
      ></template
    ></v-snackbar
  >
</template>
