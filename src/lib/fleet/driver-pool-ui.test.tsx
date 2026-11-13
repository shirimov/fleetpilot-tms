import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {DriverPoolList,DriverPoolDetail} from '@/components/fleet/DriverPoolWorkspace';
import {navigationForRole} from '@/components/app-shell/navigation';
import DriverPoolPage from '@/app/drivers/pool/[id]/page';

test('detail page normalizes encoded route IDs before the client builds an API URL',async()=>{
 // Next compiles JSX automatically; the node test runner uses classic JSX.
 const globals=globalThis as unknown as {React?:typeof React};
 const previous=globals.React; globals.React=React;
 try {
  for(const id of ['source:synthetic','driver:synthetic']) {
   for(const routeId of [id,encodeURIComponent(id)]) {
    const page=await DriverPoolPage({params:Promise.resolve({id:routeId})});
    assert.equal(page.props.driverId,id);
   }
   // Encoded percent sequences must survive a single decode, even when the
   // resulting ID contains escapes that would be invalid on a second pass.
   for(const suffix of ['%','%ZZ','%E0%A4','/segment?query#fragment']) {
    const literalId=id+suffix;
    const page=await DriverPoolPage({params:Promise.resolve({id:encodeURIComponent(literalId)})});
    assert.equal(page.props.driverId,literalId);
   }
   const encodedId=encodeURIComponent(id);
   const page=await DriverPoolPage({params:Promise.resolve({id:encodeURIComponent(encodedId)})});
   assert.equal(page.props.driverId,encodedId);
  }
 }finally{if(previous)globals.React=previous;else delete globals.React;}
});
test('detail page deliberately returns not-found for malformed route escapes',async()=>{
 for(const prefix of ['source:','driver:']) {
  for(const suffix of ['%','%ZZ','%E0%A4']) {
   await assert.rejects(
    DriverPoolPage({params:Promise.resolve({id:prefix+suffix})}),
    {message:'NEXT_HTTP_ERROR_FALLBACK;404',digest:'NEXT_HTTP_ERROR_FALLBACK;404'},
   );
  }
 }
});
test('authorized fleet navigation exposes driver pool',()=>{
 assert.ok(navigationForRole('OWNER').some(section=>section.items.some(item=>item.href==='/drivers/pool')));
 assert.ok(!navigationForRole('MEMBER').some(section=>section.items.some(item=>item.href==='/drivers/pool')));
});
test('explore roster exposes searchable cards, honest photo state and lifecycle navigation',()=>{
 const html=renderToStaticMarkup(<DriverPoolList result={{page:1,status:'active',search:'Synthetic',hasMore:true,drivers:[{id:'source:synthetic',firstName:'Synthetic',lastName:'Driver',fullName:null,employmentStatus:'active',safetyRating:'NOT_RATED'}]}}/>);
 assert.match(html,/Search drivers/);assert.match(html,/Photo not supplied/);assert.match(html,/SD/);
 assert.match(html,/Former/);assert.match(html,/aria-current="page"/);assert.match(html,/q=Synthetic/);
 assert.doesNotMatch(html,/<img|0\/100|five.star/i);
});
test('inspection detail explains evidence and policy prerequisites without suggesting a clean record',()=>{
 const html=renderToStaticMarkup(<DriverPoolDetail driver={{id:'source:synthetic',firstName:'Synthetic',lastName:'Driver',fullName:null,employmentStatus:'active',safetyRating:'NOT_RATED',phone:null,email:null,hireDate:null,terminationDate:null,rehireDate:null}}/>);
 assert.match(html,/Inspection history/);assert.match(html,/Scoring policy/);assert.match(html,/Not configured/);
 assert.match(html,/Missing history is not evidence of safe driving/);assert.doesNotMatch(html,/restricted HR access/);
});
test('pool renders source lifecycle and Not rated without invented salary',()=>{
 const html=renderToStaticMarkup(<DriverPoolList result={{page:1,status:'ALL',hasMore:false,drivers:[{id:'source:synthetic',firstName:null,lastName:null,fullName:null,employmentStatus:'terminated',safetyRating:'NOT_RATED'}]}}/>);
 assert.match(html,/terminated/); assert.match(html,/Not rated/); assert.match(html,/Name not recorded/);
});
test('legacy compensation is identified as configured settlement pay, not provider evidence',()=>{
 const html=renderToStaticMarkup(<DriverPoolDetail driver={{id:'driver:synthetic',firstName:null,lastName:null,fullName:null,employmentStatus:'UNKNOWN',safetyRating:'NOT_RATED',phone:null,email:null,hireDate:null,terminationDate:null,rehireDate:null,compensation:{type:'PERCENTAGE',amount:'0.25',frequency:null,currency:null}}}/>);
 assert.match(html,/Configured settlement pay/);
 assert.match(html,/Configured rate: 0.25/);
 assert.doesNotMatch(html,/Provider codes and amounts are evidence|Source amount/);
});

test('detail unknown compensation and dates are explicit',()=>{
 const html=renderToStaticMarkup(<DriverPoolDetail driver={{id:'source:synthetic',firstName:null,lastName:null,fullName:null,employmentStatus:'invited',safetyRating:'NOT_RATED',phone:null,email:null,hireDate:null,terminationDate:null,rehireDate:null,compensation:{type:'UNKNOWN',amount:null,frequency:null,currency:null}}}/>);
 assert.match(html,/Amount not recorded/);assert.doesNotMatch(html,/\$0/);assert.match(html,/Not rated/);
});
