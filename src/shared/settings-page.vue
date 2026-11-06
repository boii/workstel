<script setup lang="ts">
import { dialogWidth } from './dialog-widths';
import { computed, ref } from 'vue';
import { locale, t } from '../i18n';
import type { MessageKey } from '../i18n';
import type { StaffAssignment } from '../auth/useAuth';
import type { ModuleManifest } from '../core/module';
import ModuleSwitches from './module-switches.vue';
import ModuleDialog from './module-dialog.vue';
import ChangePassword from '../users/change-password.vue';
import ProfileForm from '../profile/profile-form.vue';
import { initialsOf, useProfile } from '../profile/use-profile';

const props = defineProps<{
  demo: boolean;
  email: string;
  hotelName: string;
  assignments: StaffAssignment[];
  platformAdmin: boolean;
  switchableModules: readonly ModuleManifest[];
}>();
const emit = defineEmits<{ signOut: []; openShortcuts: []; modulesChanged: [] }>();

// Demo access mirrors the Vault sample departments and is labelled by the page's demo badge.
const demoAssignments: StaffAssignment[] = [
  ['front-office', 'FO', 'Front Office'],
  ['sales', 'SM', 'Sales & Marketing'],
  ['engineering', 'EN', 'Engineering'],
  ['it', 'IT', 'IT'],
].map(([departmentId, departmentCode, departmentName]) => ({
  hotelId: 'demo',
  hotelName: props.hotelName,
  departmentId,
  departmentCode,
  departmentName,
  canRead: true,
  canWrite: true,
  canArchive: true,
  canAudit: true,
}));
const access = computed(() => (props.demo ? demoAssignments : props.assignments));
// The profile already names the hotel; repeat it per row only when access spans several hotels.
const multiHotel = computed(() => new Set(access.value.map((a) => a.hotelId)).size > 1);
const { profile, available: profileAvailable } = useProfile();
const accountName = computed(() => (props.demo ? t('demoAdmin') : props.email));
const displayName = computed(() => profile.value.displayName ?? accountName.value);
const initials = computed(() => initialsOf(displayName.value));
const profileOpen = ref(false);
const permissions: [keyof StaffAssignment, MessageKey][] = [
  ['canRead', 'permRead'],
  ['canWrite', 'permWrite'],
  ['canArchive', 'permArchive'],
  ['canAudit', 'permAudit'],
];
const passwordOpen = ref(false);
const notice = ref('');
function passwordChanged() {
  passwordOpen.value = false;
  notice.value = t('passwordChanged');
}
function granted(assignment: StaffAssignment) {
  return permissions.filter(([field]) => assignment[field] === true).map(([, key]) => t(key));
}
</script>
<template>
  <div class="settings-grid">
    <v-card
      tag="section"
      class="settings-card"
      aria-labelledby="settings-profile"
    >
      <div class="settings-card-heading">
        <h2 id="settings-profile">{{ t('profile') }}</h2>
        <v-btn
          v-if="profileAvailable"
          class="settings-profile-edit"
          variant="text"
          color="primary"
          prepend-icon="mdi-pencil-outline"
          @click="profileOpen = true"
          >{{ t('editProfile') }}</v-btn
        >
      </div>
      <div class="settings-profile">
        <v-avatar
          size="48"
          color="var(--workstel-avatar-bg)"
          ><span class="settings-initials">{{ initials }}</span></v-avatar
        >
        <div class="settings-profile-text">
          <strong>{{ displayName }}</strong>
          <span>{{ profile.jobTitle ?? (demo ? t('demoRole') : t('authorized')) }}</span>
          <span v-if="profile.displayName">{{ accountName }}</span>
          <span
            >{{ hotelName
            }}<template v-if="profile.extension">
              · {{ t('extensionShort') }} {{ profile.extension }}</template
            ></span
          >
        </div>
      </div>
    </v-card>

    <v-card
      tag="section"
      class="settings-card"
      aria-labelledby="settings-preferences"
    >
      <h2 id="settings-preferences">{{ t('preferences') }}</h2>
      <div class="settings-row">
        <span
          id="settings-language"
          class="settings-label"
          >{{ t('language') }}</span
        >
        <v-btn-toggle
          v-model="locale"
          mandatory
          variant="outlined"
          color="primary"
          density="comfortable"
          class="choice-group settings-language"
          role="group"
          aria-labelledby="settings-language"
          ><v-btn value="en">English</v-btn><v-btn value="id">Bahasa Indonesia</v-btn></v-btn-toggle
        >
      </div>
      <div class="settings-row">
        <span class="settings-label">{{ t('shortcuts') }}</span>
        <v-btn
          variant="text"
          color="primary"
          append-icon="mdi-chevron-right"
          @click="emit('openShortcuts')"
          >{{ t('view') }}</v-btn
        >
      </div>
    </v-card>

    <v-card
      tag="section"
      class="settings-card settings-card--wide"
      aria-labelledby="settings-access"
    >
      <div class="settings-card-heading">
        <h2 id="settings-access">{{ t('workspaceAccess') }}</h2>
        <span>{{ t('accessChanges') }}</span>
      </div>
      <ul
        v-if="access.length"
        class="settings-access"
      >
        <li
          v-for="assignment in access"
          :key="assignment.hotelId + assignment.departmentId"
        >
          <div class="settings-access-name">
            <strong>{{ assignment.departmentName }}</strong>
            <span v-if="multiHotel">{{ assignment.hotelName }}</span>
          </div>
          <div
            class="settings-permissions"
            :aria-label="t('permissions')"
          >
            <span
              v-for="permission in granted(assignment)"
              :key="permission"
              >{{ permission }}</span
            >
          </div>
        </li>
      </ul>
      <p
        v-else
        class="settings-muted"
      >
        {{ t('noAccess') }}
      </p>
    </v-card>

    <ModuleSwitches
      v-if="platformAdmin"
      :demo="demo"
      :modules="switchableModules"
      @changed="emit('modulesChanged')"
    />
    <v-card
      tag="section"
      class="settings-card settings-card--wide"
      aria-labelledby="settings-session"
    >
      <h2 id="settings-session">{{ t('session') }}</h2>
      <div class="settings-row settings-row--first">
        <p class="settings-muted">{{ demo ? t('temporaryData') : t('sessionPolicy') }}</p>
        <v-btn
          variant="outlined"
          color="error"
          prepend-icon="mdi-logout"
          @click="emit('signOut')"
          >{{ t('signOut') }}</v-btn
        >
      </div>
      <div class="settings-row">
        <span class="settings-label">{{ t('passwordSetting') }}</span>
        <v-btn
          variant="text"
          color="primary"
          prepend-icon="mdi-lock-reset"
          @click="passwordOpen = true"
          >{{ t('changePasswordTitle') }}</v-btn
        >
      </div>
    </v-card>
    <ModuleDialog
      v-model="passwordOpen"
      :title="t('changePasswordTitle')"
      :width="dialogWidth.md"
    >
      <ChangePassword
        v-if="passwordOpen"
        :demo="demo"
        @changed="passwordChanged"
        @cancel="passwordOpen = false"
        @sign-in-again="emit('signOut')"
      />
    </ModuleDialog>
    <ProfileForm
      v-model="profileOpen"
      @saved="notice = t('profileSaved')"
    />
    <v-snackbar
      :model-value="!!notice"
      timeout="3000"
      @update:model-value="notice = ''"
      >{{ notice }}</v-snackbar
    >
  </div>
</template>
<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--workstel-space-4);
}
.settings-card {
  padding: var(--workstel-space-5) 22px;
  min-width: 0;
}
.settings-card--wide {
  grid-column: 1 / -1;
}
.settings-card h2 {
  font-size: var(--workstel-font-md);
  font-weight: var(--workstel-weight-semibold);
  line-height: var(--workstel-leading-tight);
}
.settings-card-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--workstel-space-1) var(--workstel-space-4);
}
.settings-profile-edit {
  margin: -6px -8px -6px 0;
}
.settings-card-heading > span,
.settings-muted {
  font-size: var(--workstel-font-sm);
  line-height: var(--workstel-leading-relaxed);
  color: var(--workstel-text-secondary);
}
.settings-profile {
  display: flex;
  align-items: center;
  gap: var(--workstel-space-3_5);
  margin-top: var(--workstel-space-3);
  min-width: 0;
}
.settings-initials {
  font-size: var(--workstel-font-md);
  font-weight: var(--workstel-weight-bold);
  color: var(--workstel-avatar-text);
}
.settings-profile-text {
  display: flex;
  flex-direction: column;
  gap: var(--workstel-space-0_5);
  min-width: 0;
}
.settings-profile-text strong {
  font-size: var(--workstel-font-md);
  font-weight: var(--workstel-weight-semibold);
  overflow-wrap: anywhere;
}
.settings-profile-text span {
  font-size: var(--workstel-font-sm);
  overflow-wrap: anywhere;
  color: var(--workstel-text-secondary);
}
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-3);
  min-height: 52px;
  padding: var(--workstel-space-2) 0;
  border-top: 1px solid var(--workstel-border);
}
.settings-card h2 + .settings-row {
  margin-top: var(--workstel-space-2);
  border-top: 0;
}
.settings-row--first {
  border-top: 0;
}
.settings-label {
  font-size: var(--workstel-font-sm);
}
.settings-language .v-btn {
  font-size: var(--workstel-font-sm);
  padding: 0 var(--workstel-space-3);
}
.settings-access {
  list-style: none;
  margin: var(--workstel-space-3) 0 0;
  padding: 0;
}
.settings-access li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-2) var(--workstel-space-4);
  min-height: var(--workstel-row-sm);
  padding: var(--workstel-space-2) 0;
  border-top: 1px solid var(--workstel-border);
}
.settings-access-name {
  display: flex;
  flex-direction: column;
  gap: var(--workstel-space-0_5);
  min-width: 0;
}
.settings-access-name strong {
  font-size: var(--workstel-font-sm);
  font-weight: var(--workstel-weight-semibold);
  overflow-wrap: anywhere;
}
.settings-access-name span {
  font-size: var(--workstel-font-xs);
  color: var(--workstel-text-secondary);
}
.settings-permissions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--workstel-space-1);
}
.settings-permissions span {
  padding: var(--workstel-space-0_5) var(--workstel-space-2);
  border-radius: var(--workstel-radius-sm);
  background: var(--workstel-surface-subtle);
  color: var(--workstel-text-secondary);
  font-size: var(--workstel-font-xs);
  font-weight: var(--workstel-weight-bold);
  line-height: var(--workstel-leading-relaxed);
}
.settings-card > .settings-muted {
  margin-top: var(--workstel-space-3);
}
@media (max-width: 680px) {
  .settings-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 11px;
  }
  .settings-card {
    padding: 17px;
  }
  .settings-row {
    flex-wrap: wrap;
  }
  .settings-language {
    width: 100%;
    height: auto !important;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .settings-language .v-btn {
    min-height: var(--workstel-touch-target);
  }
  .settings-row .v-btn {
    min-height: var(--workstel-touch-target);
  }
  .settings-access li {
    flex-direction: column;
    align-items: flex-start;
  }
  .settings-permissions {
    justify-content: flex-start;
  }
  .settings-row--first .v-btn {
    width: 100%;
  }
}
</style>
