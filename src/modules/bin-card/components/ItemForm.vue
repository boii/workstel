<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import { errorMessage, unitKeys, useBinCardMessages } from '../composables/useBinCardMessages';
import { stockUnits } from '../types';
import type { StockItem, StockItemInput, StockUnit } from '../types';
import { parseQuantity, validateItem } from '../validation';
import type { ItemField, ValidationError } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  item: StockItem | null;
  departments: { id: string; name: string }[];
  save: (input: StockItemInput) => Promise<void>;
}>();
const messages = useBinCardMessages();
const draft = ref({
  code: '',
  name: '',
  unit: 'pcs' as StockUnit,
  location: '',
  minQuantity: '',
  departmentId: '',
});
const errors = ref<Partial<Record<ItemField, ValidationError>>>({});
const saving = ref(false);
const failure = ref('');
watch(open, (value) => {
  if (!value) return;
  const item = props.item;
  draft.value = item
    ? {
        code: item.code,
        name: item.name,
        unit: item.unit,
        location: item.location,
        minQuantity: String(item.minQuantity),
        departmentId: item.departmentId,
      }
    : {
        code: '',
        name: '',
        unit: 'pcs',
        location: '',
        minQuantity: '',
        departmentId: props.departments[0]?.id ?? '',
      };
  errors.value = {};
  failure.value = '';
});
const unitItems = computed(() =>
  stockUnits.map((unit) => ({ value: unit, title: messages.value[unitKeys[unit]] })),
);
async function submit() {
  if (saving.value) return;
  errors.value = validateItem(draft.value);
  const invalid = Object.keys(errors.value)[0];
  if (invalid) {
    document.getElementById('bin-item-' + invalid)?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.save({ ...draft.value, minQuantity: parseQuantity(draft.value.minQuantity) ?? 0 });
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
const fieldError = (field: ItemField) =>
  errors.value[field] ? messages.value[errors.value[field]!] : '';
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="item ? messages.edit : messages.add"
    :busy="saving"
  >
    <v-form
      id="bin-item-form"
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
      <div class="bin-form-grid">
        <div>
          <label
            for="bin-item-code"
            class="field-label bin-first-label"
            >{{ messages.code }}</label
          ><v-text-field
            id="bin-item-code"
            v-model="draft.code"
            :disabled="saving"
            :placeholder="messages.codePlaceholder"
            :hint="messages.codeHint"
            maxlength="30"
            autocomplete="off"
            autofocus
            :error-messages="fieldError('code')"
          />
        </div>
        <div>
          <label
            for="bin-item-unit"
            class="field-label bin-first-label"
            >{{ messages.unit }}</label
          ><v-select
            id="bin-item-unit"
            v-model="draft.unit"
            :disabled="saving"
            :items="unitItems"
            :error-messages="fieldError('unit')"
          />
        </div>
      </div>
      <label
        for="bin-item-name"
        class="field-label"
        >{{ messages.name }}</label
      ><v-text-field
        id="bin-item-name"
        v-model="draft.name"
        :disabled="saving"
        :placeholder="messages.namePlaceholder"
        maxlength="150"
        :error-messages="fieldError('name')"
      /><label
        for="bin-item-location"
        class="field-label"
        >{{ messages.location }}</label
      ><v-text-field
        id="bin-item-location"
        v-model="draft.location"
        :disabled="saving"
        :placeholder="messages.locationPlaceholder"
        maxlength="100"
        :error-messages="fieldError('location')"
      />
      <div class="bin-form-grid">
        <div>
          <label
            for="bin-item-minQuantity"
            class="field-label"
            >{{ messages.minQuantity }}</label
          ><v-text-field
            id="bin-item-minQuantity"
            v-model="draft.minQuantity"
            :disabled="saving"
            inputmode="decimal"
            maxlength="15"
            placeholder="0"
            :hint="messages.minQuantityHint"
            :error-messages="fieldError('minQuantity')"
          />
        </div>
        <div>
          <label
            for="bin-item-departmentId"
            class="field-label"
            >{{ messages.department }}</label
          ><v-select
            id="bin-item-departmentId"
            v-model="draft.departmentId"
            :disabled="saving"
            :items="departments"
            item-title="name"
            item-value="id"
            :error-messages="fieldError('departmentId')"
          />
        </div>
      </div>
      <p
        v-if="item"
        class="bin-form-hint"
      >
        {{ messages.unitLockedHint }}
      </p>
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
        form="bin-item-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.save }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
<style scoped>
.bin-form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.bin-first-label {
  margin-top: 0;
}
.bin-form-hint {
  margin-top: 12px;
  font-size: 11px;
  color: var(--workstel-text-secondary);
}
@media (max-width: 680px) {
  .bin-form-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
  /* Stacked columns need the normal gap above the second label. */
  .bin-form-grid > div + div .bin-first-label {
    margin-top: 20px;
  }
}
</style>
