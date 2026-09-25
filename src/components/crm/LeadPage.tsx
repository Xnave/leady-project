"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LeadViewDTO } from "@/lib/crm/view";
import type { UiCopy } from "@/lib/ui";
import { LeadView } from "./LeadView";

/**
 * The full `/leads/[id]` page under `crmV2`: a breadcrumb back to the list, then the
 * `page` variant of `LeadView`. There is no list here to absorb row patches, so an
 * action just asks the server component to refresh once it lands — the view itself
 * already shows the optimistic and rolled-back state.
 */
export function LeadPage({
  dto,
  ui,
  lang,
  wonLabel,
}: {
  dto: LeadViewDTO;
  ui: UiCopy;
  lang: "he" | "en";
  wonLabel: string;
}) {
  const router = useRouter();
  return (
    <div>
      <nav className="crm-crumb" aria-label="breadcrumb">
        <Link href="/leads">{ui.page.leadsTitle}</Link>
        {" / "}
        <bdi>{dto.name}</bdi>
      </nav>
      <LeadView
        dto={dto}
        ui={ui}
        lang={lang}
        variant="page"
        wonLabel={wonLabel}
        onChanged={(report) => {
          if (report.phase === "optimistic") return;
          router.refresh();
        }}
      />
    </div>
  );
}
