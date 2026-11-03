import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};
function resolveBuildCommit(): string {
  const commit = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA;
  if (commit && /^[a-f0-9]{7,40}$/i.test(commit)) return commit.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'local';
  }
}

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
    'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(resolveBuildCommit()),
  },
});
