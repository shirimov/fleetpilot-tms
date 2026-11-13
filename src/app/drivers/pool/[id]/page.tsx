import {notFound} from 'next/navigation';
import DriverPoolWorkspace from '@/components/fleet/DriverPoolWorkspace';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{id:string}>}) {
 const {id}=await params;
 let driverId:string;
 try {
  // Normalize once at the page boundary; malformed escapes are not record IDs.
  driverId=decodeURIComponent(id);
 } catch(error) {
  if(error instanceof URIError) notFound();
  throw error;
 }
 return <DriverPoolWorkspace driverId={driverId}/>;
}
