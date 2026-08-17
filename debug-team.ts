import { authorizationService } from '@/lib/auth/authorization';
import * as TeamRoute from '@/app/api/company/team/route';

async function run() {
  console.log('Overriding requireActiveCompany to OWNER context for tests');
  (authorizationService as any).requireActiveCompany = async (_minRole?: any) => ({ user: { id: 'debug-owner' }, companyId: undefined, role: 'OWNER' });

  // Case 1: only start
  const startOnly = new Request(`https://example.test/api/company/team?start=${new Date().toISOString()}`);
  const res1 = await (TeamRoute as any).GET(startOnly as any);
  console.log('\nCase: only start -> status', res1.status);
  try { console.log(await res1.json()); } catch(e){ console.log('no json', e); }

  // Case 2: start >= end
  const s = new Date().toISOString();
  const e = new Date(s).toISOString();
  const req2 = new Request(`https://example.test/api/company/team?start=${s}&end=${e}`);
  const res2 = await (TeamRoute as any).GET(req2 as any);
  console.log('\nCase: start >= end -> status', res2.status);
  try { console.log(await res2.json()); } catch(e){ console.log('no json', e); }

  // Case 3: valid start/end (UTC today)
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 1);
  const req3 = new Request(`https://example.test/api/company/team?start=${start.toISOString()}&end=${end.toISOString()}`);
  const res3 = await (TeamRoute as any).GET(req3 as any);
  console.log('\nCase: valid start/end -> status', res3.status);
  try { const j = await res3.json(); console.log('body keys', Object.keys(j)); } catch(e){ console.log('no json', e); }

  // Case 4: POST create new user
  const payload = { displayName: 'Debug New', email: `debug-${Date.now()}@example.test`, role: 'MEMBER' };
  const req4 = new Request('https://example.test/api/company/team', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
  const res4 = await (TeamRoute as any).POST(req4 as any);
  console.log('\nCase: POST create -> status', res4.status);
  try { console.log(await res4.json()); } catch(e){ console.log('no json', e); }
}

run().catch((err)=>{ console.error('debug run error', err); process.exit(1); });
