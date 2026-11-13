import test from 'node:test';
import assert from 'node:assert/strict';
import { readSafetyBody, requireSafetyMutation } from './driver-safety-http';

test('upload timeout cannot commit a partially received original',async()=>{
 const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array([1,2,3]));}});
 const request=new Request('https://synthetic.invalid',{method:'POST',body:stream,duplex:'half'} as RequestInit);
 await assert.rejects(readSafetyBody(request,10,10),/timed out/i);
});
test('driver uploads enforce same-origin and streamed bounds, not just declared length',async()=>{
 const origin='https://synthetic.invalid';
 assert.throws(()=>requireSafetyMutation(new Request(origin+'/api/drivers/pool/source:x/photo',{method:'PUT',headers:{origin:'https://other.invalid','if-match':'0'}})),/origin/i);
 assert.throws(()=>requireSafetyMutation(new Request(origin+'/api/drivers/pool/source:x/photo',{method:'PUT',headers:{origin}})),/Reload/i);
 assert.equal(requireSafetyMutation(new Request(origin+'/api/drivers/pool/source:x/photo',{method:'PUT',headers:{origin,'if-match':'0'}})),'0');
 const request=new Request(origin,{method:'POST',body:'123456'});
 await assert.rejects(readSafetyBody(request,5),/large/i);
 assert.deepEqual(Array.from(await readSafetyBody(new Request(origin,{method:'POST',body:'abc'}),5)),[97,98,99]);
});
