import { readFile, writeFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { resolveRuntimeConfig } from '../src/config/resolveRuntimeConfig';
const config = resolveRuntimeConfig(loadEnv('production', process.cwd(), 'VITE_'), false);
if (!config.configured) throw Error('Missing production configuration.');
const origin = new URL(config.supabaseUrl).origin;
const headers = await readFile('public/_headers', 'utf8');
await writeFile(
  'dist/_headers',
  headers.replace("connect-src 'self' https: wss:", "connect-src 'self' " + origin),
);
console.log('Generated Cloudflare Pages headers for the configured API origin.');
