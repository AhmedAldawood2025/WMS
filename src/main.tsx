import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const root = createRoot(document.getElementById('root')!);

// src/lib/supabase.ts throws at import time when these are missing, which
// leaves a blank white page. Check first so the page says what is wrong.
const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter(
  (name) => !import.meta.env[name]
);

if (missing.length > 0) {
  root.render(
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-lg bg-white border border-red-200 rounded-lg p-6 text-slate-700">
        <h1 className="text-lg font-semibold text-red-700 mb-2">The app is not configured</h1>
        <p className="mb-2">These environment variables were not set when the site was built:</p>
        <ul className="list-disc pl-6 mb-2 font-mono text-sm">
          {missing.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p>Add them in the hosting settings (Vercel: Project, Settings, Environment Variables) and redeploy.</p>
      </div>
    </div>
  );
} else {
  import('./App.tsx').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  });
}
