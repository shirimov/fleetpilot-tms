import test from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import type { CompanyAuthorization } from '../auth/authorization';
import { DriverPoolService } from './driver-pool-service';
test('roster search is bounded and parameterized before pagination',async()=>{
 const queries:{sql:string;values:unknown[]}[]=[];
 const database={$queryRaw:async(strings:TemplateStringsArray,...values:unknown[])=>{queries.push({sql:strings.join('?'),values});return [];}} as unknown as PrismaClient;
 const service=new DriverPoolService(database);
 const result=await service.list(context,{page:1,search:'  Synthetic  '});
 assert.equal(result.search,'Synthetic');
 assert.ok(queries[0].values.includes('Synthetic'));
 assert.match(queries[0].sql,/strpos/i);
 assert.ok(queries[0].sql.indexOf('strpos')<queries[0].sql.indexOf('LIMIT'));
 await assert.rejects(service.list(context,{page:1,search:'x'.repeat(121)}),RangeError);
});
const context={companyId:'synthetic-company',role:'OWNER',user:{id:'synthetic-user'}} as CompanyAuthorization;
test('pool list queries only authorized company and rejects members before DB',async()=>{
 const queries:unknown[][]=[];
 const database={$queryRaw:async (_strings:TemplateStringsArray,...values:unknown[])=>{queries.push(values);return [];}} as unknown as PrismaClient;
 const service=new DriverPoolService(database);
 await service.list(context,{page:1}); assert.equal(queries.length,1); assert.equal(queries[0].filter(value=>value===context.companyId).length,2);
 await assert.rejects(service.list({...context,role:'MEMBER'},{page:1})); assert.equal(queries.length,1);
});
test('pool detail includes company restriction and cannot return absent driver',async()=>{
 const queries:unknown[][]=[];
 const database={$queryRaw:async (_strings:TemplateStringsArray,...values:unknown[])=>{queries.push(values);return [];}} as unknown as PrismaClient;
 await assert.rejects(new DriverPoolService(database).detail(context,'source:synthetic-id'),/Not found/);
 assert.ok(queries[0].includes(context.companyId));
});
