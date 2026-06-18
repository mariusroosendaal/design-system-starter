import { Button } from './components';

export function App() {
  return (
    <div className="min-h-screen bg-background-default p-6 lg:p-10">
      <div className="mx-auto flex max-w-content-standard flex-col gap-8">
        <header className="flex flex-col gap-2">
          <p className="type-label-small text-text-secondary">SNAP — Agentic Design System</p>
          <h1 className="type-heading-display text-text-default">Component gallery</h1>
          <p className="type-body-large text-text-secondary">
            Everything here is driven by semantic SNAP tokens — no hardcoded values.
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-lg border border-border-default bg-background-surface p-6">
          <p className="type-label-small text-text-secondary">Button — variants</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button disabled>Disabled</Button>
          </div>

          <p className="type-label-small text-text-secondary">Button — sizes</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="md" fullWidth>
              Full width
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border-default bg-background-surface p-6">
          <p className="type-label-small text-text-secondary">Type ramp</p>
          <p className="type-heading-large text-text-default">Heading large — GT America</p>
          <p className="type-heading-expressive-large text-text-default">Expressive large — Tobias</p>
          <p className="type-body-medium text-text-default">
            Body medium. The quick brown fox jumps over the lazy dog.
          </p>
          <p className="type-numeral text-text-accent-2">42</p>
        </section>
      </div>
    </div>
  );
}
