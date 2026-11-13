// Explicit DTO allowlists. Never spread a source profile or approved evidence JSON.
export function poolListDto(row) {
 return {id:row.id,firstName:row.firstName??null,lastName:row.lastName??null,fullName:row.fullName??null,employmentStatus:row.lifecycleStatus||'UNKNOWN',safetyRating:'NOT_RATED'};
}
export function poolDetailDto(row,canReadCompensation) {
 return {...poolListDto(row),phone:row.phone??null,email:row.email??null,hireDate:row.hireDateRaw??null,terminationDate:row.terminationDateRaw??null,rehireDate:row.rehireDateRaw??null,
  ...(canReadCompensation?{compensation:{type:row.compensationType??'UNKNOWN',amount:row.compensationAmount??null,frequency:row.compensationFrequency??null,currency:null}}:{})};
}
