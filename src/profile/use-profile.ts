import { ref } from 'vue';
import { ModuleRequestError, moduleRpc } from '../core/module-rpc';

/** The signed-in user's own profile. User-entered text is shown as typed, never translated. */
export interface Profile {
  displayName: string | null;
  jobTitle: string | null;
  extension: string | null;
  locale: 'en' | 'id' | null;
}
export type ProfileField = 'displayName' | 'jobTitle' | 'extension';
export type ProfileInput = Partial<Record<ProfileField, string>> & { locale?: 'en' | 'id' };
export type ProfileErrors = Partial<Record<ProfileField, 'fieldTooLong' | 'extensionInvalid'>>;

export const profileMaxLength: Record<ProfileField, number> = {
  displayName: 80,
  jobTitle: 80,
  extension: 20,
};
// Same rules as workstel_profile_save; the server remains the authority.
const extensionPattern = /^[0-9+()# -]{1,20}$/;
// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u0000-\u001f\u007f]/;
const emptyProfile: Profile = { displayName: null, jobTitle: null, extension: null, locale: null };

export function validateProfile(input: ProfileInput): ProfileErrors {
  const errors: ProfileErrors = {};
  for (const field of ['displayName', 'jobTitle', 'extension'] as const) {
    const value = input[field]?.trim();
    if (!value) continue;
    if (value.length > profileMaxLength[field] || controlCharacters.test(value))
      errors[field] = field === 'extension' ? 'extensionInvalid' : 'fieldTooLong';
    else if (field === 'extension' && !extensionPattern.test(value))
      errors[field] = 'extensionInvalid';
  }
  return errors;
}

export function parseProfile(data: unknown): Profile {
  if (!data || typeof data !== 'object') throw new ModuleRequestError('INVALID_RESPONSE');
  const raw = data as Record<string, unknown>;
  const text = (key: ProfileField) => {
    const value = raw[key];
    if (value === null) return null;
    if (typeof value !== 'string' || value.length > profileMaxLength[key])
      throw new ModuleRequestError('INVALID_RESPONSE');
    return value;
  };
  if (raw.locale !== null && raw.locale !== 'en' && raw.locale !== 'id')
    throw new ModuleRequestError('INVALID_RESPONSE');
  return {
    displayName: text('displayName'),
    jobTitle: text('jobTitle'),
    extension: text('extension'),
    locale: raw.locale,
  };
}

/** Up to two initials from a name, or the first two characters of an email. */
export function initialsOf(name: string): string {
  const words = name.includes('@') ? [] : name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return (words[0] ?? name).slice(0, 2).toUpperCase();
}

const profile = ref<Profile>({ ...emptyProfile });
/** False until the profile loads, and on servers without the profile migration. */
const available = ref(false);
let demo = false;
let generation = 0;

async function load(isDemo: boolean) {
  const current = ++generation;
  demo = isDemo;
  if (demo) {
    // Demo profiles live in memory for this tab only.
    available.value = true;
    return;
  }
  try {
    const result = await moduleRpc('workstel_profile_get', {});
    if (current !== generation) return;
    profile.value = parseProfile(result.data);
    available.value = true;
  } catch {
    if (current !== generation) return;
    profile.value = { ...emptyProfile };
    available.value = false;
  }
}

async function save(input: ProfileInput) {
  if (demo) {
    const next = { ...profile.value };
    for (const field of ['displayName', 'jobTitle', 'extension'] as const)
      if (field in input) next[field] = input[field]?.trim() || null;
    if (input.locale) next.locale = input.locale;
    profile.value = next;
    return;
  }
  const result = await moduleRpc('workstel_profile_save', { p_input: input });
  profile.value = parseProfile(result.data);
}

function reset() {
  ++generation;
  profile.value = { ...emptyProfile };
  available.value = false;
}

export function useProfile() {
  return { profile, available, load, save, reset };
}
