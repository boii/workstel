import { resolveRuntimeConfig } from './resolveRuntimeConfig';
export const runtime = resolveRuntimeConfig(import.meta.env, import.meta.env.DEV);
