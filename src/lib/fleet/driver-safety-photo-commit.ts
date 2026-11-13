// Browser-safe receipt comparison shared by the API and its independent UI readback.
export type PhotoCommit = { revision: string; photoId: string; photoVersion: string };
export function photoCommitMatches(expected: PhotoCommit | undefined, actual: { revision: string; photoId: string | null; photoVersion: string | null }): boolean {
  return !!expected && !!expected.photoId && !!expected.photoVersion &&
    expected.revision === actual.revision && expected.photoId === actual.photoId && expected.photoVersion === actual.photoVersion;
}
