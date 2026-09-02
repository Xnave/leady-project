import Link from "next/link";
import type { UiCopy } from "@/lib/ui";

type Step = {
  href: string;
  label: string;
  done: boolean;
  count?: number;
};

export function SetupJourney({ ui, steps }: { ui: UiCopy; steps: Step[] }) {
  return (
    <div className="card setup-journey">
      <h2>{ui.home.journeyTitle}</h2>
      <p className="muted">{ui.home.journeyBlurb}</p>
      <ol className="journey-steps">
        {steps.map((step, i) => (
          <li key={step.href} className={`journey-step${step.done ? " done" : ""}`}>
            <span className="journey-index">{i + 1}</span>
            <Link href={step.href} className="journey-link">
              {step.label}
              {step.count && step.count > 0 ? (
                <span className="nav-badge">{step.count > 99 ? "99+" : step.count}</span>
              ) : null}
            </Link>
            {step.done ? (
              <span className="journey-check" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
