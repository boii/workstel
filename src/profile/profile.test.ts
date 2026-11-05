import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialsOf, parseProfile, validateProfile } from './use-profile';

test('profile input follows the server rules', () => {
  assert.deepEqual(validateProfile({ displayName: 'Alice', extension: '+62 (21) 101' }), {});
  assert.deepEqual(validateProfile({ displayName: '', jobTitle: '  ', extension: '' }), {});
  assert.deepEqual(validateProfile({ displayName: 'x'.repeat(81) }), {
    displayName: 'fieldTooLong',
  });
  assert.deepEqual(validateProfile({ jobTitle: 'Line\nbreak' }), { jobTitle: 'fieldTooLong' });
  assert.deepEqual(validateProfile({ extension: 'ext. 12' }), { extension: 'extensionInvalid' });
});

test('profile responses are validated', () => {
  const empty = { displayName: null, jobTitle: null, extension: null, locale: null };
  assert.deepEqual(parseProfile(empty), empty);
  assert.deepEqual(parseProfile({ ...empty, displayName: 'Alice', locale: 'id' }), {
    ...empty,
    displayName: 'Alice',
    locale: 'id',
  });
  assert.throws(() => parseProfile(null));
  assert.throws(() => parseProfile({ ...empty, locale: 'fr' }));
  assert.throws(() => parseProfile({ ...empty, jobTitle: 7 }));
});

test('initials come from the first and last name, or the email', () => {
  assert.equal(initialsOf('Alice Maria Hartono'), 'AH');
  assert.equal(initialsOf('alice'), 'AL');
  assert.equal(initialsOf('budi.s@example.com'), 'BU');
});
