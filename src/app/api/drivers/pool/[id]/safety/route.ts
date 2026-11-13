import { driverSafetyService } from '@/lib/fleet/driver-safety-runtime';
import { readSafetyBody, requireSafetyMutation, safetyError, safetyJson } from '@/lib/fleet/driver-safety-http';
import { DriverSafetyValidationError } from '@/lib/fleet/driver-safety-validation';
export const dynamic='force-dynamic';
export const runtime='nodejs';
type Params={params:Promise<{id:string}>};
export async function GET(_request:Request,{params}:Params) {
  try {const {id}=await params;return safetyJson(await (await driverSafetyService(id)).get(id));}catch(error){return safetyError(error);}
}
export async function POST(request:Request,{params}:Params) {
  try {
    const revision=requireSafetyMutation(request),{id}=await params;
    const service=await driverSafetyService(id,revision);
    const type=request.headers.get('content-type')??'';
    if(type.startsWith('application/json')) {
      const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readSafetyBody(request,16384)));
      if(body.action!=='policy')throw new DriverSafetyValidationError('Unknown safety action.');
      const version=await service.setPolicy(id,body.policy);
      const readback=await service.get(id);
      if(readback.policy?.id!==version)throw new Error('Policy readback changed.');
      return safetyJson(readback);
    }
    if(!type.startsWith('multipart/form-data;'))throw new DriverSafetyValidationError('Use a report attachment with structured metadata.');
    const bytes=await readSafetyBody(request,10*1024*1024+32768);
    const form=await new Response(bytes.buffer as ArrayBuffer,{headers:{'content-type':type}}).formData();
    const metadata=form.get('metadata'),attachment=form.get('report'),supersedes=form.get('supersedes');
    if(typeof metadata!=='string'||metadata.length>16384)throw new DriverSafetyValidationError('Structured report metadata is required.');
    if(supersedes!==null&&(typeof supersedes!=='string'||!/^[0-9a-f-]{36}$/.test(supersedes)))throw new DriverSafetyValidationError('Invalid review reference.');
    if(attachment!==null&&!(attachment instanceof File))throw new DriverSafetyValidationError('Invalid report attachment.');
    const reportId=await service.addInspection(id,JSON.parse(metadata),attachment instanceof File?new Uint8Array(await attachment.arrayBuffer()):undefined,supersedes as string|null);
    const readback=await service.get(id);
    if(!readback.inspections.some(report=>report.id===reportId))throw new Error('Report readback missing.');
    return safetyJson(readback,201);
  }catch(error){return safetyError(error);}
}
