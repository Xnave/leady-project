import { ReactNode } from "react";

export function PageHeader({
  title,
  blurb,
  actions,
}: {
  title: string;
  blurb?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {blurb ? <p className="muted">{blurb}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </div>
  );
}
