import { ReactNode, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { LogOut, Languages } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { profile, signOut } = useAuth();
  const { language, toggleLanguage, t } = useLanguage();

  useEffect(() => {
    // Wait for DOM to be fully ready
    const loadLiveChat = () => {
      // Check if script already exists
      const existingScript = document.querySelector('script[src*="live_chat.v1.0.0.js"]');
      if (existingScript) {
        console.log('Live chat script already loaded');
        return;
      }

      // Load live chat script
      const script = document.createElement('script');
      script.src = 'https://spicy_meal.ras.yeastar.com/live_chat.v1.0.0.js?channelNumber=LC00000';
      script.onload = () => {
        console.log('Live chat script loaded successfully');
        // Check if container was created
        setTimeout(() => {
          const container = document.getElementById('ys-chatbot-container');
          if (container) {
            console.log('Live chat container found:', container);
          } else {
            console.warn('Live chat container not found');
          }
        }, 1000);
      };
      script.onerror = (error) => {
        console.error('Failed to load live chat script:', error);
      };
      document.body.appendChild(script);
    };

    // Load after a short delay to ensure DOM is ready
    const timer = setTimeout(loadLiveChat, 500);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white shadow-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex flex-col">
              <h1 className="text-xl font-bold text-slate-900">
                {t('app_title')}
              </h1>
              <span className="text-[9px] text-slate-400 font-mono leading-none mt-0.5">V-260430-0.0.0</span>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-sm text-slate-600">
                <span className="font-medium">{profile?.display_name}</span>
                <span className="mx-2">•</span>
                <span className="text-slate-500">{t(profile?.role || '')}</span>
              </div>

              <button
                onClick={toggleLanguage}
                className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                title={language === 'en' ? 'العربية' : 'English'}
              >
                <Languages className="w-5 h-5" />
              </button>

              <button
                onClick={() => signOut()}
                className="flex items-center gap-2 px-4 py-2 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>{t('sign_out')}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
