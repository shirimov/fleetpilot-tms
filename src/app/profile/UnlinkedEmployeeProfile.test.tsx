import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import UnlinkedEmployeeProfile from './UnlinkedEmployeeProfile';

test('unlinked MEMBER receives a safe profile state without HR directory access', () => {
  const markup = renderToStaticMarkup(
    <UnlinkedEmployeeProfile role="MEMBER" />,
  );

  assert.match(markup, /Your employee profile has not been linked yet\./);
  assert.match(markup, /Ask a company owner or administrator/);
  assert.doesNotMatch(markup, /href="\/hr/);
});

test('unlinked OWNER and ADMIN receive profile-linking guidance', () => {
  for (const role of ['OWNER', 'ADMIN'] as const) {
    const markup = renderToStaticMarkup(
      <UnlinkedEmployeeProfile role={role} />,
    );

    assert.match(markup, /Link your FleetPilot user to an employee profile/);
    assert.doesNotMatch(markup, /href="\/hr/);
  }
});
