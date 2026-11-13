// Owner-confirmed calendar policy. No request timezone or fixed elapsed-week assumption.
export const PACIFIC_REPORTING_TIME_ZONE='America/Los_Angeles';
const calendar=new Intl.DateTimeFormat('en-US',{timeZone:PACIFIC_REPORTING_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function localParts(date:Date) {
 if(!Number.isFinite(date.getTime()))throw new Error('Invalid reporting instant');
 const parts=Object.fromEntries(calendar.formatToParts(date).map(part=>[part.type,part.value]));
 return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),hour:Number(parts.hour),minute:Number(parts.minute),second:Number(parts.second)};
}
function localMidnight(calendarDate:Date) {
 const target=calendarDate.getTime();let instant=target;
 // Resolve each local calendar midnight independently, including its own DST offset.
 for(let i=0;i<4;i++) {
  const p=localParts(new Date(instant));
  const correction=target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
  if(correction===0)return new Date(instant).toISOString();
  instant+=correction;
 }
 throw new Error('Reporting midnight could not be resolved');
}
export function pacificReportingWeek(now:Date) {
 const p=localParts(now),sunday=new Date(Date.UTC(p.year,p.month-1,p.day));
 sunday.setUTCDate(sunday.getUTCDate()-sunday.getUTCDay());
 const nextSunday=new Date(sunday);nextSunday.setUTCDate(nextSunday.getUTCDate()+7);
 return {start:localMidnight(sunday),end:localMidnight(nextSunday),timeZone:PACIFIC_REPORTING_TIME_ZONE};
}
export function withinReportingWeek(instant:Date,week:{start:string;end:string}) {
 return instant.getTime()>=Date.parse(week.start)&&instant.getTime()<Date.parse(week.end);
}
