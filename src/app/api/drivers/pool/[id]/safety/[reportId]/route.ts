import { NextResponse } from 'next/server';
import { driverSafetyService } from '@/lib/fleet/driver-safety-runtime';
import { safetyError } from '@/lib/fleet/driver-safety-http';
import { privateDownloadHeaders } from '@/lib/storage/private-file-storage';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string;reportId:string}>}) {
  try {const {id,reportId}=await params;const bytes=await (await driverSafetyService(id)).download(id,reportId);return new NextResponse(new Uint8Array(bytes).buffer,{headers:privateDownloadHeaders('original-inspection-report','application/octet-stream')});}catch(error){return safetyError(error);}
}
