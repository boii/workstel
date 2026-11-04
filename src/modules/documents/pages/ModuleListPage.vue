<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import ModulePage from '../../../shared/ModulePage.vue';
import KeyboardShortcuts from '../../../shared/keyboard-shortcuts.vue';
import { runtime } from '../../../config/runtime';
import { t } from '../../../i18n';
import type { ModuleAssignment } from '../../../core/module-access';
import { useShortcuts } from '../../../core/use-shortcuts';
import { focusFieldInput } from '../../../core/focus-field';
import type { FocusableField } from '../../../core/focus-field';
import DocumentForm from '../components/DocumentForm.vue';
import {
  categoryIcons,
  categoryKeys,
  errorMessage,
  formatDate,
  useDocumentsMessages,
} from '../composables/useDocumentsMessages';
import { createDemoDocumentsApi, demoDepartments, demoHotelId } from '../demo-api';
import { createLiveDocumentsApi } from '../live-api';
import { categories } from '../types';
import type { Category, DocumentInput, DocumentLink, DocumentStatus } from '../types';
import '../styles.css';

const props = withDefaults(defineProps<{ access?: ModuleAssignment[] }>(), { access: () => [] });
const emit = defineEmits<{ back: [] }>();
const messages = useDocumentsMessages();
const api = runtime.demo ? createDemoDocumentsApi() : createLiveDocumentsApi();

// Demo mode grants every capability on sample departments; production uses server grants.
const scope = computed<ModuleAssignment[]>(() =>
  runtime.demo
    ? demoDepartments.map((d) => ({
        moduleId: 'documents',
        hotelId: demoHotelId,
        hotelName: '',
        departmentId: d.id,
        departmentCode: d.id,
        departmentName: d.name,
        canRead: true,
        canWrite: true,
        canManage: true,
      }))
    : props.access.filter((row) => row.moduleId === 'documents' && row.canRead),
);
const hotelId = computed(() => scope.value[0]?.hotelId ?? '');
const hotelScope = computed(() => scope.value.filter((row) => row.hotelId === hotelId.value));
const can = (departmentId: string, flag: 'canWrite' | 'canManage') =>
  hotelScope.value.some((row) => row.departmentId === departmentId && row[flag]);
const writableDepartments = computed(() =>
  hotelScope.value
    .filter((row) => row.canWrite)
    .map((row) => ({ id: row.departmentId, name: row.departmentName })),
);

const documents = ref<DocumentLink[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(true);
const loadingMore = ref(false);
const failure = ref('');
const search = ref('');
const departmentId = ref<string | null>(null);
const category = ref<Category | null>(null);
const status = ref<DocumentStatus | 'all'>('active');
const notice = ref('');
let controller: AbortController | null = null;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

async function load(after: string | null = null) {
  if (!hotelId.value) return;
  controller?.abort();
  controller = new AbortController();
  if (after) loadingMore.value = true;
  else loading.value = true;
  failure.value = '';
  try {
    const page = await api.list(
      {
        hotelId: hotelId.value,
        departmentId: departmentId.value,
        status: status.value,
        category: category.value,
        search: search.value,
        after,
      },
      controller.signal,
    );
    documents.value = after ? [...documents.value, ...page.data] : page.data;
    nextCursor.value = page.nextCursor;
  } catch (error) {
    if (!controller.signal.aborted) failure.value = errorMessage(messages.value, error);
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}
watch([departmentId, category, status], () => void load());
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 300);
});
watch(hotelId, () => void load(), { immediate: true });
onBeforeUnmount(() => {
  controller?.abort();
  clearTimeout(searchTimer);
});

const hasFilters = computed(
  () => !!search.value || !!departmentId.value || !!category.value || status.value !== 'active',
);
function resetFilters() {
  search.value = '';
  departmentId.value = null;
  category.value = null;
  status.value = 'active';
}

const formOpen = ref(false);
const editing = ref<DocumentLink | null>(null);
function openForm(document: DocumentLink | null = null) {
  editing.value = document;
  formOpen.value = true;
}
async function saveDocument(input: DocumentInput) {
  await api.save(hotelId.value, input, editing.value ?? undefined);
  notice.value = messages.value.saved;
  await load();
}
async function toggleArchive(document: DocumentLink) {
  try {
    await api.setArchived(hotelId.value, document, document.status === 'active');
    notice.value =
      document.status === 'active' ? messages.value.archivedDone : messages.value.restoredDone;
  } catch (error) {
    notice.value = errorMessage(messages.value, error);
  }
  await load();
}

const searchField = ref<FocusableField | null>(null);
const shortcutsOpen = ref(false);
useShortcuts(() => [
  { key: '/', run: () => focusFieldInput(searchField.value) },
  { key: '?', shift: true, run: () => (shortcutsOpen.value = true) },
  {
    key: 'n',
    when: () => writableDepartments.value.length > 0 && !formOpen.value && !shortcutsOpen.value,
    run: () => openForm(),
  },
]);
const shortcutRows = computed(() => [
  { keys: '/', label: messages.value.search },
  ...(writableDepartments.value.length ? [{ keys: 'N', label: messages.value.add }] : []),
  { keys: '?', label: t('shortcutList') },
  { keys: 'Esc', label: t('shortcutClose') },
]);
const statusItems = computed(() => [
  { value: 'active', title: messages.value.active },
  { value: 'archived', title: messages.value.archived },
  { value: 'all', title: messages.value.all },
]);
const categoryItems = computed(() => [
  { value: null, title: messages.value.allCategories },
  ...categories.map((value) => ({ value, title: messages.value[categoryKeys[value]] })),
]);
const departmentItems = computed(() => [
  { value: null, title: messages.value.allDepartments },
  ...hotelScope.value.map((row) => ({ value: row.departmentId, title: row.departmentName })),
]);
</script>
<template>
  <div class="documents-module">
    <button
      class="documents-breadcrumb"
      @click="emit('back')"
    >
      <v-icon
        icon="mdi-arrow-left"
        size="16"
      />{{ messages.back }}
    </button>
    <ModulePage
      :title="messages.title"
      :description="documents.length + ' ' + messages.documents"
      :loading="loading"
      :error="failure"
      :empty="!documents.length"
      :empty-title="hasFilters ? messages.noResults : messages.emptyTitle"
      :empty-description="
        hasFilters
          ? messages.noResultsHint
          : writableDepartments.length
            ? messages.emptyDescription
            : messages.emptyReadOnly
      "
      :retry-label="messages.retry"
      @retry="load()"
    >
      <template #actions>
        <v-btn
          v-if="writableDepartments.length"
          color="primary"
          prepend-icon="mdi-plus"
          :aria-label="messages.add"
          @click="openForm()"
          >{{ messages.add }}</v-btn
        >
      </template>
      <template #toolbar>
        <v-alert
          v-if="runtime.demo"
          type="info"
          variant="tonal"
          density="compact"
          icon="mdi-file-document-multiple-outline"
          class="documents-notice"
          >{{ messages.demoNotice }}</v-alert
        >
        <div class="documents-toolbar">
          <v-text-field
            ref="searchField"
            v-model="search"
            class="documents-search"
            :placeholder="messages.search"
            :aria-label="messages.search"
            prepend-inner-icon="mdi-magnify"
            single-line
            clearable
            maxlength="150"
          />
          <v-select
            v-model="category"
            :items="categoryItems"
            :label="messages.category"
          />
          <v-select
            v-if="hotelScope.length > 1"
            v-model="departmentId"
            :items="departmentItems"
            :label="messages.department"
          />
          <v-select
            v-model="status"
            :items="statusItems"
            :label="messages.status"
          />
        </div>
      </template>
      <template #empty-action>
        <v-btn
          v-if="hasFilters"
          variant="text"
          color="primary"
          @click="resetFilters"
          >{{ messages.reset }}</v-btn
        >
      </template>
      <ul class="documents-list">
        <li
          v-for="document in documents"
          :key="document.id"
          class="documents-row"
          :class="{ 'documents-row--archived': document.status === 'archived' }"
        >
          <div class="documents-identity">
            <v-icon
              :icon="categoryIcons[document.category]"
              size="22"
            />
            <div>
              <strong>{{ document.title }}</strong>
              <span
                v-if="document.description"
                class="documents-description"
                >{{ document.description }}</span
              >
              <small>
                <span class="documents-category">{{
                  messages[categoryKeys[document.category]]
                }}</span>
                {{ document.departmentName }} · {{ messages.updated }}
                {{ formatDate(document.updatedAt) }}
              </small>
            </div>
          </div>
          <div class="documents-actions">
            <v-btn
              v-if="document.status === 'active'"
              color="primary"
              variant="tonal"
              append-icon="mdi-open-in-new"
              :href="document.url"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="messages.open + ' — ' + document.title + ' (' + messages.openHint + ')'"
              >{{ messages.open }}</v-btn
            ><v-menu
              v-if="
                can(document.departmentId, 'canWrite') || can(document.departmentId, 'canManage')
              "
              ><template #activator="{ props: menu }"
                ><v-btn
                  v-bind="menu"
                  icon="mdi-dots-vertical"
                  variant="text"
                  :aria-label="messages.moreActions + ' — ' + document.title" /></template
              ><v-list density="compact"
                ><v-list-item
                  v-if="can(document.departmentId, 'canWrite')"
                  prepend-icon="mdi-pencil-outline"
                  :title="messages.edit"
                  @click="openForm(document)" /><v-list-item
                  v-if="can(document.departmentId, 'canManage')"
                  :prepend-icon="
                    document.status === 'active'
                      ? 'mdi-archive-outline'
                      : 'mdi-archive-arrow-up-outline'
                  "
                  :title="document.status === 'active' ? messages.archive : messages.restore"
                  @click="toggleArchive(document)" /></v-list
            ></v-menu>
          </div>
        </li>
      </ul>
      <v-btn
        v-if="nextCursor"
        variant="text"
        color="primary"
        class="mt-3"
        :loading="loadingMore"
        @click="load(nextCursor)"
        >{{ messages.loadMore }}</v-btn
      >
    </ModulePage>
    <DocumentForm
      v-model="formOpen"
      :document="editing"
      :departments="writableDepartments"
      :save="saveDocument"
    />
    <KeyboardShortcuts
      v-model="shortcutsOpen"
      :rows="shortcutRows"
    />
    <v-snackbar
      :model-value="!!notice"
      timeout="3000"
      @update:model-value="notice = ''"
      >{{ notice }}</v-snackbar
    >
  </div>
</template>
