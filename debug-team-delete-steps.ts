import 'dotenv/config';
import { prisma } from '@/lib/prisma';

async function run(){
  try{
    const company = await prisma.company.create({ data: { name: `debug-team-steps-${Date.now()}` } });
    const owner = await prisma.user.create({ data: { email: `debug-owner-steps-${Date.now()}@example.test`, displayName: 'Owner' } });
    const m = await prisma.companyMembership.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
    console.log('created membership', m.id);

    const membership = await prisma.companyMembership.findUnique({ where: { userId_companyId: { userId: owner.id, companyId: company.id } } });
    console.log('found membership', membership?.id, 'role', membership?.role);

    if (membership?.role === 'OWNER'){
      const ownerCount = await prisma.companyMembership.count({ where: { companyId: company.id, role: 'OWNER' } });
      console.log('ownerCount', ownerCount);
      if (ownerCount <= 1){
        console.log('would block deletion - last owner');
      }
    }

    try{
      await prisma.companyMembership.delete({ where: { id: m.id } });
      console.log('deleted membership successfully');
    }catch(e){
      console.error('delete failed', e);
    }

  }catch(e){
    console.error('outer error', e);
  }finally{
    await prisma.$disconnect();
  }
}
run();