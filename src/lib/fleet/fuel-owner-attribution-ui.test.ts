import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FuelOwnerAttribution } from '../../components/accounting/FuelOwnerAttribution';
import { TruckOwnerHistory } from '../../components/fleet/TruckOwnerHistory';

test('owner editor initial render waits for authorized history/options without seeded inputs or write controls', () => {
  const html = renderToStaticMarkup(createElement(TruckOwnerHistory, { truck: { id: 'synthetic-truck', unitNumber: 'Synthetic UI' }, onClose: () => {} }));
  assert.ok(html.includes('Loading owner history and verified selectors'));
  assert.ok(html.includes('role="dialog"'));
  assert.ok(!html.includes('Save audited owner history'));
  assert.ok(!html.includes('type="date"'));
  assert.ok(!html.includes('<select'));
});

test('owner dialog exposes preview refresh failure and retry alongside the timeline', () => {
  const html = renderToStaticMarkup(createElement(TruckOwnerHistory, {
    truck: { id: 'synthetic-truck', unitNumber: 'Synthetic UI' }, onClose: () => {},
    previewStatus: createElement('div', { role: 'alert' }, 'Fuel preview unavailable. ', createElement('button', { type: 'button' }, 'Retry fuel preview')),
  }));
  assert.ok(html.includes('Fuel preview unavailable.'), 'refresh failure is visible inside the owner dialog');
  assert.ok(html.includes('Retry fuel preview'), 'preview retry is reachable within modal focus containment');
});

test('fuel detail renders durable owner provenance and calendar label without timezone conversion', () => {
  const html = renderToStaticMarkup(createElement(FuelOwnerAttribution, { attribution: { ownerPartyId: 'synthetic-party', periodId: 'synthetic-period', revisionId: 'synthetic-revision', businessDate: '2026-06-01' }, matchMethod: 'TRUCK_DATE', onOpenHistory: () => {} }));
  for (const text of ['synthetic-party', 'synthetic-period', 'synthetic-revision', '2026-06-01', 'Calendar date label', 'Owner history']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('T00:00'));
});

test('unresolved owner date stays explicitly in review; absent attribution never infers an owner', () => {
  const html = renderToStaticMarkup(createElement(FuelOwnerAttribution, { attribution: null, matchMethod: 'NEEDS_BUSINESS_DATE' }));
  assert.ok(html.includes('Purchase business date unresolved'));
  assert.ok(html.includes('NEEDS_BUSINESS_DATE'));
  assert.ok(!html.includes('Owner party:'));
  assert.ok(!html.includes('<button'));
});
