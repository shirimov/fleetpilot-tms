'use client';
import React,{useEffect,useState} from 'react';
import type {DriverPerformanceResult} from '@/lib/fleet/driver-performance-report';
import DriverPerformanceReportView from './DriverPerformanceReportView';

type PanelState={driverId:string;result?:DriverPerformanceResult;error?:boolean}|null;
type ReadResponse=(url:string,options:RequestInit)=>Promise<Response>;
export async function loadDriverPerformance(driverId:string,signal:AbortSignal,read:ReadResponse=fetch):Promise<DriverPerformanceResult> {
 const response=await read(`/api/drivers/pool/${encodeURIComponent(driverId)}/performance`,{method:'GET',credentials:'same-origin',cache:'no-store',signal});
 if(!response.ok)throw new Error('Unable to load performance report. Check access or retry.');
 return response.json();
}
export function DriverPerformancePanelState({driverId,state}:{driverId:string;state:PanelState}) {
 const current=state?.driverId===driverId?state:null;
 if(!current)return <section aria-label="Driver performance report"><h2>Driver profitability &amp; performance</h2><p role="status">Loading performance report…</p></section>;
 if(current.error)return <p role="alert">Unable to load performance report. Check access or retry.</p>;
 return current.result?<DriverPerformanceReportView result={current.result}/>:null;
}
export default function DriverPerformancePanel({driverId}:{driverId:string}) {
 const [state,setState]=useState<PanelState>(null);
 useEffect(()=>{
  const controller=new AbortController();
  loadDriverPerformance(driverId,controller.signal)
   .then(result=>{if(!controller.signal.aborted)setState({driverId,result});})
   .catch(()=>{if(!controller.signal.aborted)setState({driverId,error:true});});
  return ()=>controller.abort();
 },[driverId]);
 return <DriverPerformancePanelState driverId={driverId} state={state}/>;
}
