<script setup lang="ts">
import { dialogWidth } from '../../../shared/dialog-widths';
import { ref, watch } from 'vue';
import ActionMenu from '../../../shared/action-menu.vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import { errorMessage, fill, shortName, useAcCareMessages } from '../composables/useAcCareMessages';
import type { Area, AreaList } from '../types';

/** Areas of one department with their main and backup technicians. */
const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  canManage: boolean;
  load: (signal: AbortSignal) => Promise<AreaList>;
  setMember: (
    area: string,
    userId: string,
    action: 'add' | 'remove',
    backup: boolean,
  ) => Promise<void>;
}>();
const emit = defineEmits<{ changed: [text: string] }>();
const messages = useAcCareMessages();
const list = ref<AreaList | null>(null);
const loading = ref(false);
const busy = ref(false);
const failure = ref('');
let controller: AbortController | null = null;
async function fetchAreas() {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  loading.value = true;
  failure.value = '';
  try {
    list.value = await props.load(signal);
  } catch (error) {
    if (!signal.aborted) failure.value = errorMessage(messages.value, error);
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
watch(open, (value) => {
  if (value) {
    list.value = null;
    void fetchAreas();
  } else controller?.abort();
});
async function change(area: string, userId: string, action: 'add' | 'remove', backup: boolean) {
  if (busy.value) return;
  busy.value = true;
  failure.value = '';
  try {
    await props.setMember(area, userId, action, backup);
    emit('changed', messages.value.areaSaved);
    await fetchAreas();
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    busy.value = false;
  }
}
// A new technician becomes the main one when the area has none yet, otherwise a backup.
const addable = (area: Area) =>
  (list.value?.technicians ?? []).filter(
    (person) => !area.members.some((member) => member.userId === person.userId),
  );
const hasMain = (area: Area) => area.members.some((member) => !member.backup);
</script>
<template>
  <ModuleDialog
    v-model="open"
    fullscreen
    :title="messages.areasTitle"
    :busy="busy"
    :width="dialogWidth['2xl']"
  >
    <p class="ac-hint ac-areas-hint">{{ messages.areasHint }}</p>
    <v-alert
      v-if="failure"
      type="error"
      variant="tonal"
      role="alert"
      class="mb-3"
      >{{ failure
      }}<v-btn
        variant="text"
        @click="fetchAreas()"
        >{{ messages.retry }}</v-btn
      ></v-alert
    >
    <v-skeleton-loader
      v-if="loading && !list"
      type="list-item-two-line@3"
    />
    <template v-else-if="list">
      <p
        v-if="canManage && !list.technicians.length"
        class="ac-hint"
      >
        {{ messages.noTechnicianGrants }}
      </p>
      <p
        v-if="!list.areas.length"
        class="ac-hint"
      >
        {{ messages.noAreas }}
      </p>
      <ul
        v-else
        class="ac-areas"
      >
        <li
          v-for="area in list.areas"
          :key="area.area"
        >
          <div class="ac-area-heading">
            <div>
              <strong>{{ area.area }}</strong>
              <small>{{ fill(messages.unitsInArea, { count: area.units }) }}</small>
            </div>
            <ActionMenu
              v-if="canManage && addable(area).length"
              :disabled="busy"
              ><template #activator="{ props: menu }"
                ><v-btn
                  v-bind="menu"
                  variant="text"
                  color="primary"
                  size="small"
                  prepend-icon="mdi-account-plus-outline"
                  :disabled="busy"
                  >{{ messages.addTechnician }}</v-btn
                ></template
              ><v-list-item
                v-for="person in addable(area)"
                :key="person.userId"
                :title="person.email"
                @click="change(area.area, person.userId, 'add', hasMain(area))"
            /></ActionMenu>
          </div>
          <p
            v-if="!area.members.length"
            class="ac-hint"
          >
            {{ messages.noTechnicians }}
          </p>
          <ul
            v-else
            class="ac-members"
          >
            <li
              v-for="member in area.members"
              :key="member.userId"
            >
              <span :title="member.email">{{ shortName(member.email) }}</span>
              <button
                v-if="canManage"
                type="button"
                class="list-row-chip ac-role"
                :class="member.backup ? 'ac-chip--neutral' : 'ac-chip--info'"
                :disabled="busy"
                @click="change(area.area, member.userId, 'add', !member.backup)"
              >
                {{ member.backup ? messages.backup : messages.main }}
              </button>
              <span
                v-else
                class="list-row-chip"
                :class="member.backup ? 'ac-chip--neutral' : 'ac-chip--info'"
                >{{ member.backup ? messages.backup : messages.main }}</span
              >
              <v-btn
                v-if="canManage"
                icon="mdi-close"
                variant="text"
                size="small"
                :disabled="busy"
                :aria-label="fill(messages.removeFrom, { name: member.email, area: area.area })"
                :title="messages.remove"
                @click="change(area.area, member.userId, 'remove', member.backup)"
              />
            </li>
          </ul>
        </li>
      </ul>
    </template>
  </ModuleDialog>
</template>
