import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Header, Sidebar } from '@/components/layout';
import { Dashboard, UploadPage, SettingsPage, HistoryPage, FilesPage, RestorePage } from '@/pages';
import { useSettingsStore } from '@/stores';
import { useEffect } from 'react';

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
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex">
          <Sidebar />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/restore" element={<RestorePage />} />
              <Route path="/files" element={<FilesPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
