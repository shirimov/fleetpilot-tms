import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePolicy, calculateRating, validateInspection, validatePhoto } from './driver-safety-validation';

test('rating remains null until explicitly enabled policy and reviewed evidence exist',()=>{
 assert.equal(calculateRating(null,[]).score,null);
 assert.equal(calculateRating(null,[]).state,'POLICY_NOT_CONFIGURED');
 const policy=validatePolicy({label:'Synthetic policy',enabled:true,maximum:100,minimum:0,violationPenalty:3,outOfServicePenalty:10,windowStart:'2026-01-01',windowEnd:'2026-12-31'});
 assert.equal(calculateRating(policy,[]).state,'EVIDENCE_PENDING');
 const record=validateInspection({source:'Synthetic source',reportIdentifier:'SYN-01',inspectionDate:'2026-05-01',violations:2,outOfService:true,reviewed:true});
 assert.equal(calculateRating(policy,[record]).score,84);
 assert.equal(calculateRating({...policy,enabled:false},[record]).score,null);
 assert.throws(()=>validatePolicy({...policy,violationPenalty:-1}));
 assert.throws(()=>validatePolicy({...policy,maximum:NaN}));
 assert.throws(()=>validateInspection({...record,inspectionDate:'2026-02-30'}));
 assert.throws(()=>validateInspection({...record,violations:-1}));
 assert.equal(calculateRating(policy,[{...record,violations:null}]).score,null);
});
test('photo validator rejects fake MIME and empty images',async()=>{
 await assert.rejects(validatePhoto(new Uint8Array(), 'image/png'));
 await assert.rejects(validatePhoto(new TextEncoder().encode('<svg/>'),'image/png'));
 await assert.rejects(validatePhoto(new Uint8Array([137]),'image/png'));
});
