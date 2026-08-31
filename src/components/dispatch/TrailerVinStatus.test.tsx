import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrailerVinStatus } from './TrailerVinStatus';

test('trailer with a VIN has no list warning', () => {
  const markup = renderToStaticMarkup(<TrailerVinStatus vin="1HGCM82633A004352" />);
  assert.doesNotMatch(markup, /VIN MISSING/);
});

test('trailer without a VIN has list and detail warnings', () => {
  const list = renderToStaticMarkup(<TrailerVinStatus vin={null} />);
  const detail = renderToStaticMarkup(
    <TrailerVinStatus vin={null} detail notes="VIN MISSING — add the verified VIN later." />,
  );
  assert.match(list, /VIN MISSING/);
  assert.match(detail, /MISSING — ACTION REQUIRED/);
  assert.match(detail, /add the verified VIN later/);
});
