export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { Suspense } from 'react';
import HomeClient from './HomeClient';

export default function Home() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-600">Loading page...</div>}>
      <HomeClient />
    </Suspense>
  );
}
