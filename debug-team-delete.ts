import 'dotenv/config';
import { prisma } from '@/lib/prisma';
import { authorizationService } from '@/lib/auth/authorization';
import * as TeamRoute from '@/app/api/company/team/route';

async function run(){
  try{
    const company = await prisma.company.create({ data: { name: `debug-team-${Date.now()}` } });
    const owner = await prisma.user.create({ data: { email: `debug-owner-${Date.now()}@example.test`, displayName: 'Owner' } });
    await prisma.companyMembership.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
    (authorizationService as any).requireActiveCompany = async (_minRole?: any) => ({ user: { id: owner.id }, companyId: company.id, role: 'OWNER' });
    const req = new Request('https://example.test/api/company/team', { method: 'DELETE', body: JSON.stringify({ userId: owner.id }), headers: { 'Content-Type': 'application/json' } });
    const res = await (TeamRoute as any).DELETE(req as any);
    console.log('status', res.status);
    try{
      const text = await res.text();
      console.log('body:', text);
    }catch(e){
      console.log('could not read body', e);
    }
  }catch(e){
    console.error('error', e);
  }finally{
    await prisma.$disconnect();
  }
}
run();