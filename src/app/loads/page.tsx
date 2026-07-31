import DispatchWorkspace from '@/components/dispatch/DispatchWorkspace';
import { Suspense } from 'react';

export default function LoadsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-950 p-8 text-sm text-gray-400">
          Loading dispatch workspace…
        </div>
      }
    >
      <DispatchWorkspace />
    </Suspense>
  );
}
