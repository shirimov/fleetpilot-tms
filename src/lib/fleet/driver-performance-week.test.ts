import test from 'node:test';
import assert from 'node:assert/strict';

test('Pacific calendar weeks span real DST changes and own exact half-open boundaries',async()=>{
 const module=await import('./driver-performance-week').catch(()=>null);
 assert.ok(module,'Pacific calendar module is not implemented');
 const {pacificReportingWeek,withinReportingWeek}=module;
 for(const [instant,start,end,hours] of [
  ['2026-03-08T08:00:00.000Z','2026-03-08T08:00:00.000Z','2026-03-15T07:00:00.000Z',167],
  ['2026-11-01T07:00:00.000Z','2026-11-01T07:00:00.000Z','2026-11-08T08:00:00.000Z',169],
  ['2026-07-08T12:00:00.000Z','2026-07-05T07:00:00.000Z','2026-07-12T07:00:00.000Z',168],
  ['2026-01-01T06:00:00.000Z','2025-12-28T08:00:00.000Z','2026-01-04T08:00:00.000Z',168],
 ] as const) {
  const week=pacificReportingWeek(new Date(instant));
  assert.deepEqual(week,{start,end,timeZone:'America/Los_Angeles'});
  assert.equal((Date.parse(end)-Date.parse(start))/3600000,hours);
  assert.equal(withinReportingWeek(new Date(start),week),true);
  assert.equal(withinReportingWeek(new Date(Date.parse(start)-1),week),false);
  assert.equal(withinReportingWeek(new Date(Date.parse(end)-1),week),true);
  assert.equal(withinReportingWeek(new Date(end),week),false);
  assert.equal(pacificReportingWeek(new Date(end)).start,end);
  assert.equal(pacificReportingWeek(new Date(Date.parse(start)-1)).end,start);
 }
 for(const instant of ['2026-03-08T09:59:59.999Z','2026-03-08T10:00:00.000Z','2026-11-01T08:30:00.000Z','2026-11-01T09:30:00.000Z']) {
  const week=pacificReportingWeek(new Date(instant));
  assert.equal(week.start,instant.startsWith('2026-03')?'2026-03-08T08:00:00.000Z':'2026-11-01T07:00:00.000Z');
 }
 assert.throws(()=>pacificReportingWeek(new Date('invalid')));
});
