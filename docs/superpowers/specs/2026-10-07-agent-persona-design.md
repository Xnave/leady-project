# Agent persona — Phase 1 design

ClickUp: [Create personalized experience for the agent](https://app.clickup.com/t/z8rp3f5cm9)
Status: draft for review · 2026-10-07

## Goal

Owners shape how their agent sounds — name, gender, tone, reply length, formality, emoji, question style, and a few always/never rules — from a preset-first settings page. Phase 1 must produce a **measurable** improvement in reply quality for every tenant, including tenants who never open the settings page.

Success means:

1. An owner can pick a preset, tweak it, see a live sample conversation, and save — without ops.
2. Every customer-facing reply path (LLM and fixed copy) respects the persona, including Hebrew grammatical gender.
3. On a fixed scenario set, the new prompts beat the current prompts on every voice metric, with no regression on rule compliance (see *Evaluation*).

## Non-goals (Phase 2)

- Tone that varies per conversation moment (greeting / pricing / objection / complaint / close).
- Sales-skill modules (objection handling, qualification, upsell) registered like capabilities.
- Learning style from operator edits of HITL drafts.
- Per-channel personas, multiple agents per tenant with different personas.
- Free-form system-prompt editing by owners.

## Why replies feel shallow today

From the current code:

- `talkGuardrails` (`src/lib/copy/en.ts`) opens with `ROLE: Front-desk chat assistant … You are not a professional.` followed by MAY / MUST NOT lists. Nothing describes a voice, so the model falls back to generic assistant register.
- `systemRole` reduces identity to `You represent X as a front-desk assistant only - not a professional.` No name, no character, no stance toward the customer.
- Fixed copy in `src/lib/copy/he.ts` (`askPhoneConfirm`, `savingVisit`, `tellMeMore`, booking templates, …) bypasses the LLM. It is masculine for the agent's self-reference (`קולט`) and masculine-singular toward the customer (`ספר לי`), so voice shifts mid-conversation.
- `answerFaq` (`src/lib/flow/llm.ts`) does not include `agent.systemPrompt` at all; `draftQuestion` includes it but with no style guidance.
- There is no quality measurement — tests cover behavior, not how replies read.

## Design overview

Three parts, shipped together:

- **A. Voice layer** — a rewritten default identity + conversational craft section, and a new prompt order. Improves every tenant.
- **B. Persona config** — `Agent.persona`, presets, owner settings page with live preview, persona applied to every reply path.
- **C. Evaluation harness** — scripted scenarios run against baseline and new prompts, scored by an LLM judge, producing a before/after scorecard.

## A. Voice layer

### Identity block (replaces `systemRole` usage at runtime)

Built per turn from tenant + persona instead of being frozen into `agent.systemPrompt` at onboarding:

```
You are {agentName || "the team"} at {business}, chatting with customers on {channel}.
You know this business well and you genuinely want to help the person in front of you.
You are not a licensed professional — you don't give professional advice — but you are
confident and knowledgeable about everything in the knowledge section.
```

`agent.systemPrompt` keeps working as an extra instruction line for existing tenants (ops-authored text, language rule), appended after the identity block. The onboarding-generated `"You represent … front-desk assistant only"` line is skipped when present, so legacy agents get the new identity without a data migration.

### Conversational craft (always on, persona-independent)

A short section in `copy/en.ts` (`prompts.voiceCraft`):

- Acknowledge what the customer said before answering; answer the actual question first.
- Mirror their language register and energy; never be more formal than the persona requires.
- Use the customer's name once known, sparingly (not every message).
- No canned openers ("Great question!", "Certainly!"), no repeating your previous message's phrasing, no restating the question back.
- One clear next step per message; at most one question per message unless the persona says otherwise.
- Write like a person in a chat app: short paragraphs, no headings, no bullet lists unless listing 3+ options.
- When you don't know, say so briefly and offer the concrete alternative (phone, handoff).

### Prompt order

`PromptBuilder` order changes from *base → stage → guardrails → channel → context → capabilities → closing* to:

1. Identity (`withIdentity`)
2. Persona (`withPersona`) — compiled from config, see B
3. Voice craft (`withVoiceCraft`)
4. Stage prompt, channel, business context, capabilities (unchanged content)
5. Boundaries (today's guardrails, reworded: drop the `ROLE:` line and the "not a professional" framing that now lives in identity; keep every MAY / MUST NOT rule)
6. Closing / tool instructions

Rule content is unchanged; only framing and order move. Safety rules stay last so they are not overridden by style.

## B. Persona config

### Data model

New column `Agent.persona Json @default("{}")`, with a Prisma migration. Type in `src/lib/persona/types.ts`:

```ts
type Persona = {
  presetId: "warm_concierge" | "precise_short" | "premium_formal" | "upbeat_sales" | "custom";
  agentName: string;           // "" = speak as the business ("we")
  gender: "female" | "male" | "neutral";
  tone: "friendly" | "professional" | "cheerful" | "direct";
  length: "short" | "medium" | "detailed";
  formality: "casual" | "formal";
  emoji: "none" | "light";
  questionStyle: "one_at_a_time" | "bundled";
  rules: string[];             // ≤ 5 entries, each ≤ 160 chars
};
```

`normalizePersona(raw): Persona` fills missing keys from the default preset, so `{}` (all existing agents) behaves as **Warm concierge with gender `neutral`** — the improved default. `validatePersona()` rejects unknown enum values, >5 rules, over-long rules, and rules that try to override boundaries (contain "ignore previous", "system prompt", URLs) with a typed `PersonaConfigError`.

`TurnContext.agent` (`AgentSnapshot`) gains `persona: Persona`, loaded in `src/lib/conversations.ts` next to `systemPrompt`.

### Presets

`src/lib/persona/presets.ts` — each preset is a full `Persona` minus `agentName`/`rules`, plus en/he display copy for the UI:

| Preset | tone | length | formality | emoji | questionStyle |
|---|---|---|---|---|---|
| Warm concierge (default) | friendly | medium | casual | light | one_at_a_time |
| Precise & short | direct | short | casual | none | one_at_a_time |
| Premium formal | professional | medium | formal | none | one_at_a_time |
| Upbeat sales | cheerful | medium | casual | light | one_at_a_time |

Changing any knob after picking a preset sets `presetId: "custom"`.

### Compiling persona → prompt

`personaSection(persona, lang)` in `src/lib/copy/` (prompt stays English per existing convention; `lang` only affects the Hebrew grammar line). Each knob maps to concrete, testable instructions, not adjectives alone. Examples:

- `length: short` → "Reply in 1–2 short sentences (max ~40 words). Never pad. If more detail is needed, give the essential part and offer more."
- `length: detailed` → "Up to ~5 sentences when the question needs it; still one idea per paragraph."
- `tone: direct` → "Lead with the answer. No small talk, no exclamation marks."
- `formality: formal` (he) → "Address the customer politely; avoid slang (אחלה, סבבה, יאללה)."
- `gender: female` (he) → "You refer to yourself in feminine forms (אני בודקת, שמחה לעזור, קולטת)."
- `gender: neutral` (he) → "Avoid gendered self-reference: use plural 'we' (אנחנו בודקים) or infinitive/impersonal phrasing."
- Customer address (he, always): "You don't know the customer's gender; address them with gender-neutral phrasing (infinitive, plural, or 'אפשר…') until they reveal it."
- `rules` → rendered under "Owner's rules (follow unless they conflict with Boundaries):".

### Applying persona to every reply path

| Path | Change |
|---|---|
| Talk turn (`buildTalkSystemPrompt`) | identity + persona + craft via new builder steps |
| Nudge (`buildNudgeSystemPrompt`) | same three steps |
| `draftQuestion` (`llm.ts`) | identity + persona + craft prepended |
| `answerFaq` (`llm.ts`, `faqSystem`) | identity + persona + craft prepended |
| Fixed copy (`copy/*.ts`) | `copyFor(lang, { gender })` — see below |
| First message intro | unchanged (`tenant.intro` is owner text); if `agentName` is set and the intro contains no name, the LLM body may introduce the agent by name once |

**Gender-aware fixed copy.** `copyFor(lang, opts?: { gender })`. English is unaffected. For Hebrew, only strings that contain agent self-reference or customer-directed imperatives change:

- Agent self-reference gets `{ male, female, neutral }` variants (neutral = "we" form), e.g. `savingVisit`: `קולט / קולטת / קולטים את ההזמנה במערכת`.
- Customer-directed masculine imperatives become neutral for everyone (`ספר לי עוד` → `אפשר לספר לי עוד`), since the customer's gender is unknown.

Call sites already pass `lang`; they additionally pass `ctx.agent.persona.gender`. A test asserts every Hebrew `chat` string has been reviewed (a fixture list of strings that need variants vs. strings that are gender-free) so new copy can't silently reintroduce masculine forms.

**Length enforcement.** Prompt-level only. `maxOutputTokens` is not lowered on the talk call because replies are produced through tool calls in a multi-step loop and a cap would truncate tool arguments. The eval measures adherence.

### Owner UI — Settings → "Your agent"

Route `src/app/(app)/settings/agent/page.tsx`, manager-level access (`requireTenantRoleForPage("manager")`), operator copy in `src/lib/ui/` (en + he).

Layout:

1. **Preset cards** (4) — name, one-line description, one sample reply in the operator's UI language.
2. **Customize** — agent name (text), gender (3-way), tone, length, formality, emoji, question style (segmented controls), rules (up to 5 short text rows with add/remove).
3. **Live preview** — 3 fixed sample customer messages (a pricing question, a vague "hi, interested", a complaint) in the tenant's chat language; replies regenerate on demand ("Refresh preview") using the unsaved draft persona.
4. **Save** — writes persona; toast on success.

Onboarding (`OnboardWizard`) gains one step: pick a preset + agent name + gender, defaulting to Warm concierge. Skippable.

### API

- `GET /api/agent/persona` → `{ persona }` (manager).
- `PUT /api/agent/persona` → validate, then in one transaction: write `agent.persona`, write `AgentConfigRevision { kind: "persona", version: n+1, payload }`. Does **not** bump `flowVersion` (style changes must not mark scheduled nudges `stale-flow`).
- `POST /api/agent/persona/preview` → body `{ persona, lang }`; runs the real talk prompt (`buildTalkSystemPrompt` + `generateText` with the reply tool only, no DB writes, no capability side-effect tools) for each sample message against the tenant's real knowledge/intro, returns replies. Rate-limited with the existing LLM route limiter. Without an LLM key, returns a 409 with a "preview needs an LLM key" message.

All queries filter by the `tenantId` from `requireTenantId()`.

## C. Evaluation harness

`scripts/persona-eval.ts` (run with `npx tsx scripts/persona-eval.ts`), not part of `npm test`.

- **Scenarios** — `scripts/persona-eval/scenarios.ts`, ~15 multi-turn scripts (he + en) against a fixture tenant (knowledge modeled on the kitchen business in `docs/conversation-simulations.md`): price question with no price in knowledge, vague opener, explicit booking request, product interest that must *not* trigger booking, complaint/warranty, out-of-scope ask, returning customer, customer reveals their gender, one-word replies, English customer on a `multi` tenant.
- **Runner** — drives `interpretTurn` with in-memory fake ports (same pattern as `previewFlow`) but real LLM functions, so tools and stage logic behave as in production without a DB.
- **Arms** — `baseline` (current prompt pipeline, captured behind a `PROMPT_PIPELINE=legacy` switch kept only until Phase 1 ships) vs. `new` × presets {Warm concierge, Precise & short, Premium formal}.
- **Judge** — a separate LLM call per agent reply with a fixed rubric, scoring 1–5: *human-sounding*, *persona match*, *helpfulness*, *length adherence*, *Hebrew gender correctness* (he only), and a pass/fail *rules respected* (no premature booking, no invented prices/terms, no confirmed slot). Judge sees the persona spec, the knowledge, and the conversation so far.
- **Output** — `eval-out/persona-<timestamp>/scorecard.md` (per-metric averages per arm, deltas) and `transcripts.md` (side-by-side replies), git-ignored.

**Acceptance bar for Phase 1:** `new` (default preset) ≥ baseline + 0.5 on *human-sounding* and *helpfulness* averages; each preset ≥ 4.0 on *persona match* and *length adherence*; Hebrew gender correctness ≥ 4.5; *rules respected* pass rate not lower than baseline. Results are attached to the PR.

## Testing (in `npm test`, no LLM key)

- `persona/validate.test.ts` — enums, rule limits, injection-ish rules rejected, `normalizePersona({})` = default.
- `prompt-builder.test.ts` — section order (identity before persona before craft before boundaries before closing); each knob produces its instruction; legacy `"You represent …"` line is skipped; boundaries text still present in full.
- `copy` tests — Hebrew gender variants for each self-referencing string; customer-directed strings are neutral; gender review fixture covers every `chat` key.
- `llm` path tests — `answerFaq` and `draftQuestion` system prompts include persona (via an injected/fake model or by asserting the built system string).
- API route test — PUT writes revision and leaves `flowVersion` untouched; tenant isolation.
- `architecture.test.ts` keeps passing (persona is generic; no domain names in the interpreter).

## Rollout

- Migration adds `persona` with default `{}`; all existing agents immediately get the voice layer + Warm concierge/neutral defaults. This is a deliberate behavior change for every tenant — the eval scorecard is the gate.
- Production migration by hand per `docs/setup.md`, only on explicit go-ahead.
- `PROMPT_PIPELINE=legacy` switch exists only for the eval baseline and is removed in Phase 2.

## Open risks

- **Default voice change for all tenants.** Mitigated by the eval gate; if a specific tenant complains, they can pick "Premium formal" or "Precise & short".
- **Model variance.** `gpt-4o-mini` may follow length/gender instructions loosely; the eval measures this, and if Hebrew gender correctness misses the bar we add a few-shot example pair per gender to the persona section.
- **Prompt length.** Identity + persona + craft adds ~250–400 tokens per talk turn; acceptable, tracked via the existing `talk_prompt_chars` perf metric.
