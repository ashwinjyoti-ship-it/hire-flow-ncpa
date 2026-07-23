interface PageHeaderProps {
  title: string;
  titleAccessory?: React.ReactNode;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, titleAccessory, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end sm:gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold text-ink-primary etched-deep">{title}</h1>
          {titleAccessory}
        </div>
        {subtitle && <p className="mt-1 text-sm text-ink-muted etched">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
