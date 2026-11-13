import test from 'node:test';
import assert from 'node:assert/strict';
import { photoCommitMatches } from './driver-safety-photo-commit';

test('photo verification pins the committed revision, identity and hash, not two later matching snapshots', () => {
  const committed = { revision: 'write-a', photoId: 'photo-a', photoVersion: 'hash-a' };
  assert.equal(photoCommitMatches(committed, committed), true);
  for (const later of [
    { ...committed, revision: 'write-b' },
    { ...committed, photoId: 'photo-b' },
    { ...committed, photoVersion: 'hash-b' },
    { revision: 'write-b', photoId: 'photo-b', photoVersion: 'hash-b' },
  ]) assert.equal(photoCommitMatches(committed, later), false);
  assert.equal(photoCommitMatches(undefined, committed), false);
});
