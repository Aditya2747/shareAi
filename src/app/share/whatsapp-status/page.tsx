import { Suspense } from 'react';
import WhatsAppStatusShareClient from './share-client';

export default function WhatsAppStatusSharePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center text-sm text-gray-400">
          Loading...
        </div>
      }
    >
      <WhatsAppStatusShareClient />
    </Suspense>
  );
}
