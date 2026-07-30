import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Header, Sidebar } from '@/components/layout';
import { Dashboard, UploadPage, SettingsPage, HistoryPage, RestorePage } from '@/pages';
import { useSettingsStore } from '@/stores';
import { useEffect } from 'react';
import { BUILD_LABEL } from '@/utils/buildInfo';

function App() {
  const { settings, loadSettings } = useSettingsStore();

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(settings.theme);
  }, [settings.theme]);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <div className="flex flex-1 min-w-0">
          <Sidebar />
          <main className="flex-1 min-w-0">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/restore" element={<RestorePage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
        <footer className="text-xs text-muted-foreground px-4 py-2 border-t font-mono" data-testid="build-footer">
          {BUILD_LABEL}
        </footer>
      </div>
    </BrowserRouter>
  );
}

export default App;
