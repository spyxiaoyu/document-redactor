import { Button } from '@/components/common';
import { Shield, Settings, HelpCircle } from 'lucide-react';

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background">
      <div className="container flex h-16 items-center justify-between py-4">
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          <span className="text-xl font-semibold">Data Masking Tool</span>
        </div>

        <nav className="flex items-center gap-2">
          <Button variant="ghost" size="icon" title="帮助">
            <HelpCircle className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" title="设置">
            <Settings className="h-5 w-5" />
          </Button>
        </nav>
      </div>
    </header>
  );
}
