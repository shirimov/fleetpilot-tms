import DriverPoolWorkspace from '@/components/fleet/DriverPoolWorkspace';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{page?:string;status?:string;q?:string}>}) {const query=await searchParams;return <DriverPoolWorkspace page={query.page} status={query.status} search={query.q}/>;}
