<script setup lang="ts">
import { computed } from 'vue';
import { locale, t } from '../i18n';
import type { MessageKey } from '../i18n';
import type { StaffAssignment } from '../auth/useAuth';

const props = defineProps<{
  demo: boolean;
  email: string;
  hotelName: string;
  assignments: StaffAssignment[];
}>();
const emit = defineEmits<{ signOut: []; openShortcuts: [] }>();

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
const displayName = computed(() => (props.demo ? t('demoAdmin') : props.email));
const initials = computed(() => (props.demo ? 'AD' : props.email.slice(0, 2).toUpperCase()));
const permissions: [keyof StaffAssignment, MessageKey][] = [
  ['canRead', 'permRead'],
  ['canWrite', 'permWrite'],
  ['canArchive', 'permArchive'],
  ['canAudit', 'permAudit'],
];
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
      <h2 id="settings-profile">{{ t('profile') }}</h2>
      <div class="settings-profile">
        <v-avatar
          size="48"
          color="#E8EDF0"
          ><span class="settings-initials">{{ initials }}</span></v-avatar
        >
        <div class="settings-profile-text">
          <strong>{{ displayName }}</strong>
          <span>{{ demo ? t('demoRole') : t('authorized') }}</span>
          <span>{{ hotelName }}</span>
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
          variant="text"
          color="primary"
          density="comfortable"
          class="settings-language"
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
    </v-card>
  </div>
</template>
<style scoped>
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.settings-card {
  padding: 20px 22px;
  min-width: 0;
}
.settings-card--wide {
  grid-column: 1 / -1;
}
.settings-card h2 {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}
.settings-card-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 16px;
}
.settings-card-heading > span,
.settings-muted {
  font-size: 12px;
  line-height: 1.6;
  color: var(--workstel-text-secondary);
}
.settings-profile {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 16px;
  min-width: 0;
}
.settings-initials {
  font-size: 15px;
  font-weight: 700;
  color: #526774;
}
.settings-profile-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.settings-profile-text strong {
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.settings-profile-text span {
  font-size: 12px;
  color: var(--workstel-text-secondary);
}
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 52px;
  padding: 8px 0;
  border-top: 1px solid var(--workstel-border);
}
.settings-card h2 + .settings-row {
  margin-top: 8px;
  border-top: 0;
}
.settings-row--first {
  border-top: 0;
}
.settings-label {
  font-size: 13px;
}
.settings-language .v-btn {
  font-size: 12px;
  padding: 0 12px;
}
.settings-access {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}
.settings-access li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  min-height: 48px;
  padding: 8px 0;
  border-top: 1px solid var(--workstel-border);
}
.settings-access-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.settings-access-name strong {
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.settings-access-name span {
  font-size: 11px;
  color: var(--workstel-text-secondary);
}
.settings-permissions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}
.settings-permissions span {
  padding: 2px 8px;
  border-radius: 4px;
  background: #edf1f4;
  color: var(--workstel-text-secondary);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.6;
}
.settings-card > .settings-muted {
  margin-top: 12px;
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
    min-height: 44px;
  }
  .settings-row .v-btn {
    min-height: 44px;
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
