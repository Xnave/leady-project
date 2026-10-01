"use client";

import { Suspense, type RefObject } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ShowDemoLeadsToggle } from "@/components/ShowDemoLeadsToggle";
import type { UiCopy } from "@/lib/ui";
import { Icon } from "./Icon";

/** Page title, the search field (`/` focuses it) and the legacy "show demo leads" toggle. */
export function LeadsHeader({
  ui,
  q,
  onQ,
  searchRef,
}: {
  ui: UiCopy;
  q: string;
  onQ: (q: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <PageHeader
      title={ui.page.leadsTitle}
      actions={
        <div className="crm-tools">
          <label className="crm-search">
            <Icon name="search" />
            <input
              ref={searchRef}
              type="search"
              value={q}
              onChange={(e) => onQ(e.target.value)}
              placeholder={ui.crm.search}
              aria-label={ui.crm.search}
              aria-keyshortcuts="/"
            />
            <kbd className="crm-kbd" aria-hidden="true">
              /
            </kbd>
          </label>
          <Suspense fallback={null}>
            <ShowDemoLeadsToggle label={ui.common.showDemoLeads} />
          </Suspense>
        </div>
      }
    />
  );
}
