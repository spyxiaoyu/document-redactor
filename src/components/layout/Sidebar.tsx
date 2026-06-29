import { clsx } from 'clsx';
import { Home, Upload, FileText, History, Settings, Unlock } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const navItems = [
  { path: '/', label: '首页', icon: Home },
  { path: '/upload', label: '上传', icon: Upload },
  { path: '/restore', label: '恢复', icon: Unlock },
  { path: '/files', label: '文件', icon: FileText },
  { path: '/history', label: '历史', icon: History },
  { path: '/settings', label: '设置', icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="sticky top-16 z-50 h-[calc(100vh-4rem)] w-56 border-r bg-background py-4">
      <nav className="space-y-1 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )
              }
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
