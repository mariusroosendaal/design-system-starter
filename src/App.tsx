import { useEffect, useState } from 'react';
import { Button } from './components';

type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['light', 'dark'];

export function App() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    if (theme === 'light') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className="min-h-screen bg-background-default p-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="type-label-sm-2xl text-text-secondary">Design System Starter</p>
            <h1 className="type-heading">Component gallery</h1>
          </div>
          <div className="flex gap-2" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <Button key={t} size="sm" variant={t === theme ? 'primary' : 'secondary'} onClick={() => setTheme(t)}>
                {t}
              </Button>
            ))}
          </div>
        </header>

        <section className="flex flex-col gap-4 rounded-container border border-border-default bg-background-secondary p-6">
          <p className="type-label-sm-2xl text-text-secondary">Button</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button disabled>Disabled</Button>
          </div>
          <p className="type-body text-text-default">
            Body text rendered with <code className="type-ui-sm-2xl-strong">.type-body</code>. Everything here is driven by
            semantic tokens — switch the theme to see it re-skin with no component changes.
          </p>
        </section>
      </div>
    </div>
  );
}
