import { getUiLang } from "@/lib/cookies";
import { uiCopy } from "@/lib/ui";

const ROWS = [0, 1, 2, 3, 4];

/**
 * Streamed while the ledger's queries run — switching date range or submitting a
 * filter is a full navigation, and a frozen page reads as a broken one. The
 * shapes match the real rows so nothing shifts when the data lands.
 */
export default async function LeadsLoading() {
  const lang = await getUiLang();
  const ui = uiCopy(lang);
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{ui.conversations.loading}</span>
      <div className="pulse-row" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="pulse">
            <div className="skeleton skeleton-pulse" />
          </div>
        ))}
      </div>
      <div aria-hidden="true">
        <div className="skeleton skeleton-day" />
        <div className="conv-list">
          {ROWS.map((i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton skeleton-avatar" />
              <div>
                <div className="skeleton skeleton-line skeleton-name" />
                <div className="skeleton skeleton-line skeleton-preview" />
                <div className="skeleton skeleton-line skeleton-meta" />
              </div>
              <div className="skeleton skeleton-control" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
