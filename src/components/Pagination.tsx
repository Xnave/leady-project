import Link from "next/link";
import { fillUi, type UiCopy } from "@/lib/ui";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  ui: UiCopy;
  extraParams?: Record<string, string>;
};

function hrefFor(
  basePath: string,
  page: number,
  pageSize: number,
  extraParams?: Record<string, string>,
) {
  const params = new URLSearchParams({ page: String(page), size: String(pageSize) });
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) params.set(k, v);
  }
  return `${basePath}?${params.toString()}`;
}

export function Pagination({ page, pageSize, total, basePath, ui, extraParams }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  return (
    <div className="pagination-bar">
      <p className="muted pagination-summary">
        {fillUi(ui.pagination.showing, { from, to, total })}
      </p>
      <div className="pagination-controls">
        {safePage > 1 ? (
          <Link
            href={hrefFor(basePath, safePage - 1, pageSize, extraParams)}
            className="btn-secondary"
          >
            {ui.pagination.prev}
          </Link>
        ) : (
          <span className="btn-secondary disabled">{ui.pagination.prev}</span>
        )}
        <span className="pagination-page">
          {fillUi(ui.pagination.page, { current: safePage, total: pages })}
        </span>
        {safePage < pages ? (
          <Link
            href={hrefFor(basePath, safePage + 1, pageSize, extraParams)}
            className="btn-secondary"
          >
            {ui.pagination.next}
          </Link>
        ) : (
          <span className="btn-secondary disabled">{ui.pagination.next}</span>
        )}
      </div>
      <form method="get" action={basePath} className="pagination-size">
        <label>
          {ui.pagination.perPage}
          <select name="size" defaultValue={String(pageSize)}>
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="page" value="1" />
        <button type="submit" className="btn-ghost">
          {ui.common.save}
        </button>
      </form>
    </div>
  );
}
