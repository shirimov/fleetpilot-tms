import { NextResponse } from 'next/server';
import { driverSafetyService } from '@/lib/fleet/driver-safety-runtime';
import { readSafetyBody, requireSafetyMutation, safetyError, safetyJson } from '@/lib/fleet/driver-safety-http';
import { privateDownloadHeaders } from '@/lib/storage/private-file-storage';
import { photoCommitMatches } from '@/lib/fleet/driver-safety-photo-commit';
import { DriverSafetyConflictError } from '@/lib/fleet/driver-safety-catalog';
export const dynamic='force-dynamic';
export const runtime='nodejs';
type Params={params:Promise<{id:string}>};
export async function GET(_request:Request,{params}:Params) {
  try {const {id}=await params;const bytes=await (await driverSafetyService(id)).photo(id);return bytes?new NextResponse(new Uint8Array(bytes).buffer,{headers:privateDownloadHeaders('driver-photo.webp','image/webp','inline')}):safetyJson({error:'Photo not supplied.'},404);}catch(error){return safetyError(error);}
}
export async function PUT(request:Request,{params}:Params) {
  try {const revision=requireSafetyMutation(request),{id}=await params;const service=await driverSafetyService(id,revision);const photoCommit=await service.setPhoto(id,await readSafetyBody(request,5*1024*1024),request.headers.get('content-type')??'');const readback=await service.get(id);if(!photoCommitMatches(photoCommit,readback))throw new DriverSafetyConflictError('Photo changed after saving. Reload and review the latest record.');return safetyJson({...readback,photoCommit});}catch(error){return safetyError(error);}
}
export async function DELETE(request:Request,{params}:Params) {
  try {const revision=requireSafetyMutation(request),{id}=await params;const service=await driverSafetyService(id,revision);await service.removePhoto(id);const readback=await service.get(id);if(readback.photoVersion!==null)throw new Error('Photo readback changed.');return safetyJson(readback);}catch(error){return safetyError(error);}
}
