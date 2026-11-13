import test from 'node:test';
import assert from 'node:assert/strict';
import {poolListDto,poolDetailDto} from '../src/lib/fleet/qm-driver-dto.mjs';

test('list DTO never leaks source, pay, contact or license; no rating invented',()=>{
 const dto=poolListDto({id:'source:synthetic',firstName:null,lastName:null,fullName:'',lifecycleStatus:'invited',source:{phone:'private'},phone:'private',compensationAmount:'0'});
 assert.deepEqual(dto,{id:'source:synthetic',firstName:null,lastName:null,fullName:'',employmentStatus:'invited',safetyRating:'NOT_RATED'});
});
test('detail compensation is HR-only, unknown stays null, raw lifecycle preserved',()=>{
 const row={id:'source:synthetic',firstName:'S',lastName:'T',fullName:'S T',lifecycleStatus:'active',hireDateRaw:'',terminationDateRaw:null,rehireDateRaw:null,phone:'synthetic',email:'',compensationType:'UNKNOWN',compensationAmount:null,source:{ssn:'never'}};
 assert.equal(poolDetailDto(row,false).compensation,undefined);
 const detail=poolDetailDto(row,true);
 assert.equal(detail.compensation.amount,null); assert.equal(detail.hireDate,'');
 assert.equal(detail.source,undefined); assert.equal(detail.safetyRating,'NOT_RATED');
});
