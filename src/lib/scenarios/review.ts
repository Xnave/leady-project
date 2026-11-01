import type { CheckResult, ScenarioMessage } from "./types";

export type ReviewSection = {
  title: string;
  leadId?: string;
  personaGender?: string;
  review?: string;
  checks: CheckResult[];
  warnings: string[];
  messages: ScenarioMessage[];
  skipped?: string;
};

export function renderReview(input: {
  when: string;
  target: string;
  baseUrl: string;
  tenantNote: string;
  sections: ReviewSection[];
}): string {
  const checks = input.sections.flatMap((section) => section.checks);
  const passed = checks.filter((check) => check.ok).length;
  const failed = checks.length - passed;
  const lines: string[] = [
    `# Test conversations ${input.when}`,
    "",
    `Target: ${input.target} ${input.baseUrl}`,
    `Tenants: ${input.tenantNote}`,
    `Hard checks: ${passed} passed, ${failed} failed`,
    "",
    "## Summary",
    "",
  ];
  if (input.sections.length === 0) lines.push("No scenarios ran.");
  for (const section of input.sections) {
    if (section.skipped) {
      lines.push(`- skipped ${section.title} — ${section.skipped}`);
      continue;
    }
    const bad = section.checks.filter((check) => !check.ok).length;
    const mark = bad === 0 ? "x" : " ";
    lines.push(`- [${mark}] ${section.title} — ${section.checks.length - bad} passed, ${bad} failed`);
  }
  for (const section of input.sections) {
    lines.push("", `## ${section.title}`, "");
    if (section.skipped) {
      lines.push(section.skipped, "");
      continue;
    }
    if (section.leadId) {
      lines.push(
        `Lead \`${section.leadId}\`. Delete with \`npm run scenarios -- --purge-lead ${section.leadId}\`.`,
        "",
      );
    }
    if (section.personaGender) lines.push(`Persona gender: ${section.personaGender}`, "");
    lines.push("### Hard checks", "");
    for (const check of section.checks) {
      lines.push(`- [${check.ok ? "x" : " "}] ${check.name} — ${check.detail}`);
    }
    if (section.review) {
      lines.push("", "### Review", "", section.review, "");
    }
    if (section.warnings.length > 0) {
      lines.push("### Warnings", "");
      for (const warning of section.warnings) lines.push(`- ${warning}`);
      lines.push("");
    }
    lines.push("### Conversation", "");
    let conversationId = "";
    for (const message of section.messages) {
      if (message.conversationId !== conversationId) {
        conversationId = message.conversationId;
        lines.push("", `Conversation \`${conversationId}\``, "");
      }
      const who = message.role === "lead" ? "Lead" : message.role === "agent" ? "Agent" : message.role;
      lines.push(`**${who}:** ${message.text}`, "");
    }
  }
  lines.push(
    "",
    "Delete every scenario lead on this target with `npm run scenarios -- --purge`. Delete leads created before a day with `npm run scenarios -- --purge-before YYYY-MM-DD`.",
    "",
  );
  return lines.join("\n");
}
