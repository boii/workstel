<script setup lang="ts">
import type { VaultEntry } from '../types';
import { useVaultMessages } from '../composables/useVaultMessages';
import VaultPasswordCell from './VaultPasswordCell.vue';
import VaultUsernameCopy from './VaultUsernameCopy.vue';
import VaultDepartmentMark from './VaultDepartmentMark.vue';
withDefaults(
  defineProps<{
    entries: VaultEntry[];
    secretAvailable: boolean;
    sharingAvailable?: boolean;
    busy: boolean;
    resetKey: number;
    canEdit: (entry: VaultEntry) => boolean;
    canArchive: (entry: VaultEntry) => boolean;
    departmentName: (id: VaultEntry['departmentId']) => string;
  }>(),
  { sharingAvailable: true },
);
defineEmits<{
  detail: [entry: VaultEntry];
  edit: [entry: VaultEntry];
  password: [entry: VaultEntry];
  share: [entry: VaultEntry];
  archive: [entry: VaultEntry];
  restore: [entry: VaultEntry];
}>();
const messages = useVaultMessages();
function website(value: string) {
  try {
    const url = new globalThis.URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}
</script>
<template>
  <div
    class="vault-compact-list"
    role="table"
    :aria-label="messages.title"
  >
    <div
      class="vault-compact-head"
      role="row"
    >
      <span role="columnheader">{{ messages.name }}</span
      ><span role="columnheader">{{ messages.username }}</span
      ><span role="columnheader">{{ messages.password }}</span
      ><span
        role="columnheader"
        class="vault-sr-only"
        >{{ messages.actions }}</span
      >
    </div>
    <div
      v-for="entry in entries"
      :key="entry.id"
      class="vault-compact-row"
      :class="{ 'vault-compact-row--archived': entry.status === 'archived' }"
      role="row"
    >
      <div
        class="vault-compact-account"
        role="cell"
      >
        <div class="vault-compact-account-title">
          <VaultDepartmentMark
            class="vault-compact-department"
            :department-id="entry.departmentId"
            :department-name="departmentName(entry.departmentId)"
          />
          <button
            class="vault-account-name"
            @click="$emit('detail', entry)"
          >
            {{ entry.name }}
          </button>
          <v-icon
            v-if="!entry.isOwner"
            icon="mdi-account-multiple-outline"
            role="img"
            size="15"
            :aria-label="messages.sharedWithMe"
            :title="messages.sharedWithMe"
          />
          <span
            v-if="entry.status === 'archived'"
            class="vault-compact-archived"
            >{{ messages.archived }}</span
          >
        </div>
        <a
          v-if="website(entry.website)"
          class="vault-compact-domain"
          :href="website(entry.website)!.href"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="messages.openWebsite + ' — ' + entry.name"
          >{{ website(entry.website)!.hostname
          }}<v-icon
            icon="mdi-open-in-new"
            size="11"
        /></a>
      </div>
      <div
        class="vault-compact-username"
        role="cell"
      >
        <VaultUsernameCopy
          :value="entry.username"
          :name="entry.name"
        />
      </div>
      <div
        class="vault-compact-password"
        role="cell"
      >
        <VaultPasswordCell
          :entry="entry"
          :available="secretAvailable"
          :reset-key="resetKey"
        />
      </div>
      <div
        class="vault-compact-actions"
        role="cell"
      >
        <v-menu location="bottom end"
          ><template #activator="{ props: menu }"
            ><v-btn
              v-bind="menu"
              icon="mdi-dots-vertical"
              variant="text"
              size="small"
              :disabled="busy"
              :aria-label="messages.actions + ' — ' + entry.name"
          /></template>
          <v-list density="compact">
            <v-list-item
              prepend-icon="mdi-information-outline"
              :title="messages.details"
              @click="$emit('detail', entry)"
            />
            <v-list-item
              v-if="canEdit(entry)"
              prepend-icon="mdi-pencil-outline"
              :title="messages.edit"
              @click="$emit('edit', entry)"
            />
            <v-list-item
              v-if="secretAvailable && entry.status === 'active' && canEdit(entry)"
              prepend-icon="mdi-key-outline"
              :title="messages.setPassword"
              @click="$emit('password', entry)"
            />
            <v-list-item
              v-if="sharingAvailable && entry.isOwner && canEdit(entry)"
              prepend-icon="mdi-account-multiple-outline"
              :title="messages.shareTitle"
              @click="$emit('share', entry)"
            />
            <v-list-item
              v-if="canArchive(entry)"
              :prepend-icon="
                entry.status === 'active' ? 'mdi-archive-outline' : 'mdi-archive-arrow-up-outline'
              "
              :title="entry.status === 'active' ? messages.archive : messages.restore"
              @click="entry.status === 'active' ? $emit('archive', entry) : $emit('restore', entry)"
            />
          </v-list>
        </v-menu>
      </div>
    </div>
  </div>
</template>
