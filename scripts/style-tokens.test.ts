import assert from 'node:assert/strict';
import test from 'node:test';
import { checkStyleFile } from './style-tokens';

const rules = (path: string, text: string) => checkStyleFile(path, text).map((v) => v.rule);

test('flags literals that have a shared token', () => {
  const css = [
    '.a {',
    '  color: #666;',
    '  font-size: 13px;',
    '  font-weight: 600;',
    '  line-height: 1.5;',
    '  border-radius: 6px;',
    '  padding: 8px 9px;',
    '  min-height: 44px;',
    '  z-index: 3000;',
    '}',
  ].join('\n');
  const found = checkStyleFile('src/x.css', css);
  assert.deepEqual(
    found.map((v) => v.line),
    [2, 3, 4, 5, 6, 7, 8, 9],
  );
});

test('accepts tokens, off-scale spacing, resets and custom property definitions', () => {
  const css = [
    '.a {',
    '  color: var(--workstel-text-secondary);',
    '  background: rgba(var(--v-theme-primary), 0.1);',
    '  padding: 9px var(--workstel-space-4);',
    '  margin: -6px 0;',
    '  border-radius: 50%;',
    '  --stack-columns: 2;',
    '  /* a comment with: colons; and #fff */',
    '}',
  ].join('\n');
  assert.deepEqual(rules('src/x.css', css), []);
});

test('honours a token-exempt comment on the line or the line above', () => {
  const css = [
    '.wordmark {',
    '  font-size: 25px; /* token-exempt: wordmark */',
    '  /* token-exempt: wordmark */',
    '  letter-spacing: -1px;',
    '}',
  ].join('\n');
  assert.deepEqual(rules('src/x.css', css), []);
});

test('skips the :root token block in src/styles.css', () => {
  const css =
    ':root {\n  --workstel-border: #e0e6eb;\n  color: #000;\n}\n.a {\n  color: #111;\n}\n';
  assert.deepEqual(
    checkStyleFile('src/styles.css', css).map((v) => v.line),
    [6],
  );
});

test('checks Vue style blocks and templates with file line numbers', () => {
  const vue = [
    '<template>',
    '  <v-icon size="16" />',
    '  <v-icon size="15" />',
    '  <v-avatar color="#E8EDF0" />',
    '  <ModuleDialog :width="460" />',
    '</template>',
    '<style scoped>',
    '.a {',
    '  gap: 12px;',
    '}',
    '</style>',
  ].join('\n');
  assert.deepEqual(
    checkStyleFile('src/x.vue', vue).map((v) => v.line),
    [9, 4, 2, 5],
  );
});

test('flags raw Vuetify primitives in feature code only', () => {
  const vue = [
    '<template>',
    '  <v-dialog />',
    '  <v-menu />',
    '  <v-snackbar />',
    '  <v-list>',
    '    <v-list-item />',
    '  </v-list>',
    '  <!-- token-exempt: compact sub-list -->',
    '  <v-list />',
    '</template>',
  ].join('\n');
  assert.deepEqual(
    checkStyleFile('src/modules/x/pages/A.vue', vue).map((v) => v.line),
    [2, 3, 4, 5],
  );
  assert.deepEqual(rules('src/users/a.vue', '<template><v-snackbar /></template>').length, 1);
  assert.deepEqual(
    rules('src/shared/settings-page.vue', '<template><v-snackbar /></template>').length,
    1,
  );
  assert.deepEqual(rules('src/shared/module-dialog.vue', vue), []);
});

test('flags unapproved breakpoints in feature code only', () => {
  const css = [
    '@media (max-width: 680px) {}',
    '@media (max-width: 760px) {}',
    '@media (max-width: 359px) {}',
    '@media (max-width: 900px) {}',
    '/* token-exempt: summary tiles */',
    '@media (max-width: 1050px) {}',
  ].join('\n');
  assert.deepEqual(
    checkStyleFile('src/modules/x/styles.css', css).map((v) => v.line),
    [4],
  );
  const vue = '<template><div /></template>\n<style>\n@media (min-width: 600px) {}\n</style>';
  assert.deepEqual(
    checkStyleFile('src/profile/a.vue', vue).map((v) => v.line),
    [3],
  );
  assert.deepEqual(rules('src/styles.css', ':root {\n}\n' + css), []);
});

test('flags outlined labelled buttons but not outlined choice toggles', () => {
  const vue = [
    '<template>',
    '  <v-btn variant="outlined">Sign out</v-btn>',
    '  <v-btn',
    '    prepend-icon="mdi-lock-reset"',
    '    variant="outlined"',
    '  >Reset</v-btn>',
    '  <v-btn-toggle variant="outlined"><v-btn value="a">A</v-btn></v-btn-toggle>',
    '  <v-btn variant="tonal">Save</v-btn>',
    '</template>',
  ].join('\n');
  assert.deepEqual(
    checkStyleFile('src/shared/x.vue', vue).map((v) => v.line),
    [2, 5],
  );
});
