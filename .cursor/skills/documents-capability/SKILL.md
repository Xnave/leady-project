---
name: documents-capability
description: >-
  Adds and changes Zapidly document types, checklist requirements, and
  validation checks for the documents capability. Use when the user mentions a
  doc type, document checklist, mortgage file rules, a new validation, Smart
  NPV document rules, or files the agent should collect.
---

# Documents capability

Read [docs/documents.md](docs/documents.md) before editing. Use its dictionary for dossier status, requirement, slot, and file status. The same page has the JSON shape, the profile keys, and the check table. If it disagrees with `src/lib/documents/rules.ts`, the source wins.

A new document type that uses `field_present`, `matches_profile`, `date_within_months`, or `min_items` is JSON. A new comparison is a check op in code. PDF, PNG, JPG, and JPEG are file formats in `src/lib/documents/file-types.ts`, not document types.

## Add a document type

1. Add `documents.<id>` with `labels.he`, `labels.en`, `fields`, and `checks` that use an existing op.
2. Add a `requirements` row: `docType`, `stage`, optional `count` (default 1), optional `when`.
3. Put that JSON where the tenant will run it. Ops save it on the documents capability instance. Also update `MORTGAGE_RULES` in `src/lib/documents/mortgage-rules.ts` when the default checklist for unsaved tenants should include it.
4. Extend `requiredSlots` coverage in `src/lib/documents/rules.test.ts` when the default checklist changed.
5. Run `npx vitest run src/lib/documents/rules.test.ts src/lib/documents/validate.test.ts`.

`when` can only read profile keys `mapSmartProfile` writes: `employment`, `hasLoans`, `nationalId`, `fullName`, `phone`. A new key is a change to `mapSmartProfile` in `src/lib/documents/smart-npv.ts`, then JSON.

Slot id is `<docType>#<index>`. Stage order is the `stages` array.

## Add a check

1. Add the op to the `Check` union and `CHECK_OPS`, and parse it in `parseCheck` (`src/lib/documents/rules.ts`).
2. Implement it in `runChecks` (`src/lib/documents/validate.ts`). First failure wins. Return `{ op, field }` or null.
3. Add the reason key in both lead copies (`src/lib/copy/en.ts`, `src/lib/copy/he.ts`, `chat.documents.reasons`) and both operator copies (`src/lib/ui/en.ts`, `src/lib/ui/he.ts`, `documentsUi.reasons`).
4. Add a pass and a failure in `src/lib/documents/validate.test.ts`.
5. Run the same vitest command, plus `npx vitest run src/lib/flow/architecture.test.ts` if a file outside `src/lib/documents/` changed.

## Leave these alone

- `src/lib/flow/interpreter.ts`. The pack is `src/lib/flow/capabilities/documents.ts`.
- New tables, new `InterpreterPorts` fields, and a second approval form. Accepted files are a `LeadDocument` on the dossier.
- Prisma inside the capability pack. Writes stay in `src/lib/documents/dossier.ts`.
- Customer wording in `src/lib/ui/`, and operator wording in `src/lib/copy/`.
