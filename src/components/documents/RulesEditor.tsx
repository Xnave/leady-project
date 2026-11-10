"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { MORTGAGE_RULES } from "@/lib/documents/mortgage-rules";
import {
  conditionShape,
  explainRulesIssue,
  moveBy,
  nextNumericId,
  renameDocument,
  renameStage,
  renameWave,
  rulesIssueList,
  uniqueId,
  type RulesIssueText,
} from "@/lib/documents/rules-form";
import {
  CHECK_OPS,
  RulesError,
  parseRules,
  type Check,
  type Condition,
  type DocTypeDef,
  type Requirement,
  type RulesDocument,
  type StageDef,
} from "@/lib/documents/rules";
import { fillUi, type UiCopy } from "@/lib/ui";

type EditorCopy = UiCopy["documentsUi"]["editor"];
type Leaf = Exclude<Condition, { op: "all" | "any" }>;

export function RulesEditor({
  value,
  onChange,
  copy,
}: {
  value: RulesDocument;
  onChange: (next: RulesDocument) => void;
  copy: EditorCopy;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const issues = useMemo(() => rulesIssueList(value), [value]);
  const explained = issues.map((raw) => ({ raw, message: explainRulesIssue(raw, issueText(copy)) }));

  function edit(recipe: (draft: RulesDocument) => void) {
    const next = structuredClone(value);
    recipe(next);
    if (next.collectionStages && next.collectionStages.length === 0) delete next.collectionStages;
    onChange(next);
  }

  const docName = (id: string) => value.documents[id]?.labels.he || value.documents[id]?.labels.en || id;

  return (
    <div className="rules-editor">
      <header className="rules-editor-head">
        <h3>{copy.stagesTitle}</h3>
        <p className="rules-hint">{copy.stagesHint}</p>
      </header>
      <StageList
        stages={value.stages}
        copy={copy}
        issues={explained}
        path="stages"
        onChange={(stages) => edit((draft) => { draft.stages = stages; })}
        onRename={(from, to) => {
          const next = renameStage(value, from, to);
          if (!next) return false;
          onChange(next);
          return true;
        }}
        inUse={(id) => value.requirements.filter((req) => req.stage === id).map((req) => docName(req.docType))}
        addLabel={copy.addStage}
        blank={{ he: copy.newStage, en: copy.newStageEn }}
        newId={(taken) => uniqueId("stage", taken)}
      />

      <header className="rules-editor-head">
        <h3>{copy.collectionTitle}</h3>
        <p className="rules-hint">{copy.collectionHint}</p>
      </header>
      <StageList
        stages={value.collectionStages ?? []}
        copy={copy}
        issues={explained}
        path="collectionStages"
        onChange={(stages) => edit((draft) => { draft.collectionStages = stages; })}
        onRename={(from, to) => {
          const next = renameWave(value, from, to);
          if (!next) return false;
          onChange(next);
          return true;
        }}
        inUse={(id) =>
          value.requirements.filter((req) => req.collectionStage === id).map((req) => docName(req.docType))
        }
        addLabel={copy.addWave}
        blank={{ he: copy.newWave, en: copy.newWaveEn }}
        newId={(taken) => nextNumericId(taken)}
      />

      <header className="rules-editor-head">
        <div className="rules-editor-title">
          <h3>{copy.documentsTitle}</h3>
          {resetting ? (
            <span className="rules-confirm">
              <span>{copy.resetConfirm}</span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  onChange(structuredClone(MORTGAGE_RULES));
                  setOpenId(null);
                  setResetting(false);
                }}
              >
                {copy.resetYes}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setResetting(false)}>
                {copy.cancel}
              </button>
            </span>
          ) : (
            <button type="button" className="btn-ghost" onClick={() => setResetting(true)}>
              {copy.reset}
            </button>
          )}
        </div>
        <p className="rules-hint">{copy.documentsHint}</p>
      </header>
      <ul className="rules-cards">
        {Object.entries(value.documents).map(([id, doc]) => (
          <li key={id}>
            <DocumentCard
              id={id}
              doc={doc}
              open={openId === id}
              copy={copy}
              issues={explained.filter((issue) => issue.raw.startsWith(`documents.${id}`))}
              onToggle={() => setOpenId(openId === id ? null : id)}
              onChange={(next) => edit((draft) => { draft.documents[id] = next; })}
              onRename={(to) => {
                const renamed = renameDocument(value, id, to);
                if (!renamed) return false;
                onChange(renamed);
                setOpenId(to.trim());
                return true;
              }}
              usedBy={value.requirements.some((req) => req.docType === id)}
              onRemove={() => {
                edit((draft) => { delete draft.documents[id]; });
                setOpenId(null);
              }}
            />
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          const id = uniqueId("doc", Object.keys(value.documents));
          const stage = value.stages[0]?.id ?? "identity";
          edit((draft) => {
            draft.documents[id] = {
              labels: { he: copy.newDocument, en: copy.newDocumentEn },
              fields: [],
              checks: [],
            };
            draft.requirements.push({ docType: id, stage, count: 1 });
          });
          setOpenId(id);
        }}
      >
        {copy.addDocument}
      </button>

      <header className="rules-editor-head">
        <h3>{copy.askTitle}</h3>
        <p className="rules-hint">{copy.askHint}</p>
      </header>
      <RequirementList value={value} copy={copy} issues={explained} onChange={onChange} edit={edit} />

      <label>
        {copy.taxYear}
        <input
          type="number"
          inputMode="numeric"
          value={value.taxYear ?? ""}
          onChange={(e) => edit((draft) => setYear(draft, "taxYear", e.target.value))}
        />
      </label>
      <label>
        {copy.accountantYear}
        <input
          type="number"
          inputMode="numeric"
          value={value.accountantYear ?? ""}
          onChange={(e) => edit((draft) => setYear(draft, "accountantYear", e.target.value))}
        />
      </label>

      {explained.length > 0 ? (
        <div className="rules-summary" role="alert">
          <strong>{copy.issuesTitle}</strong>
          <ul>
            {explained.map((issue) => (
              <li key={issue.raw}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <JsonPanel value={value} copy={copy} onApply={onChange} />
    </div>
  );
}

function issueText(copy: EditorCopy): RulesIssueText {
  return {
    nameHeRequired: copy.nameHeRequired,
    nameEnRequired: copy.nameEnRequired,
    idRequired: copy.idRequired,
    idTaken: copy.idTaken,
    fieldRequired: copy.fieldRequired,
    checkUnknown: copy.checkUnknown,
    docMissing: copy.docMissing,
    stageMissing: copy.stageMissing,
    countInvalid: copy.countInvalid,
    condKeyRequired: copy.condKeyRequired,
    condValueRequired: copy.condValueRequired,
    monthsInvalid: copy.monthsInvalid,
    stagesRequired: copy.stagesRequired,
    collectionRequired: copy.collectionRequired,
    blankFileRequired: copy.blankFileRequired,
  };
}

function setYear(draft: RulesDocument, key: "taxYear" | "accountantYear", raw: string) {
  if (!raw.trim()) {
    delete draft[key];
    return;
  }
  const n = Number(raw);
  if (Number.isInteger(n)) draft[key] = n;
}

function StageList({
  stages,
  copy,
  issues,
  path,
  onChange,
  onRename,
  inUse,
  addLabel,
  blank,
  newId,
}: {
  stages: StageDef[];
  copy: EditorCopy;
  issues: { raw: string; message: string }[];
  path: string;
  onChange: (stages: StageDef[]) => void;
  onRename: (from: string, to: string) => boolean;
  inUse: (id: string) => string[];
  addLabel: string;
  blank: { he: string; en: string };
  newId: (taken: string[]) => string;
}) {
  const [blockedId, setBlockedId] = useState<string | null>(null);
  return (
    <div className="rules-stack">
      {stages.map((stage, index) => {
        const rowIssues = issues.filter((issue) => issue.raw.startsWith(`${path}[${index}]`));
        const users = inUse(stage.id);
        return (
          <div key={`${path}-${index}`} className="rules-stage">
            <div className="rules-stage-names">
              <label>
                {copy.nameHe}
                <input
                  value={stage.labels.he}
                  dir="rtl"
                  aria-invalid={rowIssues.some((issue) => issue.raw.includes("labels.he")) || undefined}
                  onChange={(e) => {
                    const next = stages.slice();
                    next[index] = { ...stage, labels: { ...stage.labels, he: e.target.value } };
                    onChange(next);
                  }}
                />
              </label>
              <label>
                {copy.nameEn}
                <input
                  value={stage.labels.en}
                  dir="ltr"
                  aria-invalid={rowIssues.some((issue) => issue.raw.includes("labels.en")) || undefined}
                  onChange={(e) => {
                    const next = stages.slice();
                    next[index] = { ...stage, labels: { ...stage.labels, en: e.target.value } };
                    onChange(next);
                  }}
                />
              </label>
            </div>
            <IdField
              id={stage.id}
              label={copy.id}
              hint={copy.idHint}
              rejectLabel={copy.idTaken}
              invalid={rowIssues.some((issue) => issue.raw.includes(".id") || issue.raw.includes("duplicates"))}
              onCommit={(to) => onRename(stage.id, to)}
            />
            <div className="rules-actions">
              <button type="button" className="btn-secondary" aria-label={copy.moveUp} disabled={index === 0} onClick={() => onChange(moveBy(stages, index, -1))}>
                {copy.moveUp}
              </button>
              <button type="button" className="btn-secondary" aria-label={copy.moveDown} disabled={index === stages.length - 1} onClick={() => onChange(moveBy(stages, index, 1))}>
                {copy.moveDown}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  if (users.length > 0) {
                    setBlockedId(stage.id);
                    return;
                  }
                  setBlockedId(null);
                  onChange(stages.filter((_, i) => i !== index));
                }}
              >
                {copy.remove}
              </button>
            </div>
            {blockedId === stage.id && users.length > 0 ? (
              <p className="rules-error" role="alert">{fillUi(copy.inUse, { name: users.join(", ") })}</p>
            ) : null}
            {rowIssues.map((issue) => (
              <p key={issue.raw} className="rules-error" role="alert">{issue.message}</p>
            ))}
          </div>
        );
      })}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => onChange([...stages, { id: newId(stages.map((stage) => stage.id)), labels: { ...blank } }])}
      >
        {addLabel}
      </button>
    </div>
  );
}

function IdField({
  id,
  label,
  hint,
  rejectLabel,
  invalid,
  onCommit,
}: {
  id: string;
  label: string;
  hint: string;
  rejectLabel: string;
  invalid?: boolean;
  onCommit: (next: string) => boolean;
}) {
  const hintId = useId();
  const [text, setText] = useState(id);
  const [rejected, setRejected] = useState<string | null>(null);
  useEffect(() => setText(id), [id]);
  return (
    <label className="rules-id">
      {label}
      <input
        value={text}
        dir="ltr"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid || Boolean(rejected) || undefined}
        aria-describedby={hintId}
        onChange={(e) => {
          setText(e.target.value);
          setRejected(null);
        }}
        onBlur={() => {
          const trimmed = text.trim();
          if (!trimmed || trimmed === id) {
            setText(id);
            setRejected(null);
            return;
          }
          if (!onCommit(trimmed)) {
            setText(id);
            setRejected(rejectLabel.replace("{id}", trimmed));
            return;
          }
          setRejected(null);
        }}
      />
      <span id={hintId} className="rules-hint">{hint}</span>
      {rejected ? <span className="rules-error" role="alert">{rejected}</span> : null}
    </label>
  );
}

function DocumentCard({
  id,
  doc,
  open,
  copy,
  issues,
  onToggle,
  onChange,
  onRename,
  usedBy,
  onRemove,
}: {
  id: string;
  doc: DocTypeDef;
  open: boolean;
  copy: EditorCopy;
  issues: { raw: string; message: string }[];
  onToggle: () => void;
  onChange: (next: DocTypeDef) => void;
  onRename: (to: string) => boolean;
  usedBy: boolean;
  onRemove: () => void;
}) {
  const [fieldDraft, setFieldDraft] = useState("");
  const [removeNote, setRemoveNote] = useState<string | null>(null);
  const name = doc.labels.he || doc.labels.en || id;
  const checkFields = new Set(doc.checks.map((check) => check.field));

  return (
    <article className={`rules-card${open ? " open" : ""}`}>
      <button
        type="button"
        className="rules-hit"
        aria-expanded={open}
        aria-label={fillUi(copy.openDocument, { name })}
        onClick={(e) => {
          onToggle();
          const card = e.currentTarget.closest(".rules-card");
          requestAnimationFrame(() => card?.scrollIntoView({ block: "center" }));
        }}
      >
        <strong>{name}</strong>
        <span className="rules-meta">
          {fillUi(copy.checksCount, { n: doc.checks.length })}
        </span>
      </button>
      {open ? (
        <div className="rules-card-body">
          <div className="rules-stage-names">
            <label>
              {copy.nameHe}
              <input dir="rtl" value={doc.labels.he} aria-invalid={issues.some((issue) => issue.raw.includes("labels.he")) || undefined} onChange={(e) => onChange({ ...doc, labels: { ...doc.labels, he: e.target.value } })} />
            </label>
            <label>
              {copy.nameEn}
              <input dir="ltr" value={doc.labels.en} aria-invalid={issues.some((issue) => issue.raw.includes("labels.en")) || undefined} onChange={(e) => onChange({ ...doc, labels: { ...doc.labels, en: e.target.value } })} />
            </label>
          </div>
          <IdField id={id} label={copy.id} hint={copy.idHint} rejectLabel={copy.idTaken} invalid={issues.some((issue) => issue.raw.includes("duplicates"))} onCommit={onRename} />
          <h4>{copy.checks}</h4>
          <ul className="rules-checks">
            {doc.checks.map((check, index) => (
              <li key={`${check.op}-${index}`}>
                <p className="rules-sentence">{checkSentence(check, copy)}</p>
                <div className="rules-check-grid">
                  <label>
                    {copy.checkKind}
                    <select
                      value={check.op}
                      aria-label={copy.checkKind}
                      onChange={(e) => onChange(withCheck(doc, index, checkWithOp(check, e.target.value as Check["op"])))}
                    >
                      {CHECK_OPS.map((op) => (
                        <option key={op} value={op}>{copy.checkOps[op]}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {copy.checkField}
                    <input
                      dir="ltr"
                      spellCheck={false}
                      value={check.field}
                      aria-invalid={!check.field.trim() || undefined}
                      onChange={(e) => onChange(withCheck(doc, index, { ...check, field: e.target.value }))}
                    />
                  </label>
                  {check.op === "matches_profile" ? (
                    <label>
                      {copy.checkProfileKey}
                      <input dir="ltr" spellCheck={false} value={check.profileKey} onChange={(e) => onChange(withCheck(doc, index, { ...check, profileKey: e.target.value }))} />
                    </label>
                  ) : null}
                  {check.op === "date_within_months" || check.op === "prior_calendar_months" ? (
                    <label>
                      {copy.checkMonths}
                      <input type="number" min={1} inputMode="numeric" value={check.months} onChange={(e) => onChange(withCheck(doc, index, { ...check, months: Math.max(1, Number(e.target.value) || 1) }))} />
                    </label>
                  ) : null}
                  {check.op === "min_items" ? (
                    <label>
                      {copy.checkCount}
                      <input type="number" min={1} inputMode="numeric" value={check.count} onChange={(e) => onChange(withCheck(doc, index, { ...check, count: Math.max(1, Number(e.target.value) || 1) }))} />
                    </label>
                  ) : null}
                  <button type="button" className="btn-ghost" onClick={() => onChange(withCheck(doc, index, null))}>
                    {copy.remove}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onChange(withCheck(doc, doc.checks.length, { op: "field_present", field: "fullName" }))}
          >
            {copy.addCheck}
          </button>

          <h4>{copy.fields}</h4>
          <p className="rules-hint">{copy.fieldsHint}</p>
          <ul className="rules-chips">
            {doc.fields.map((field) => {
              const locked = checkFields.has(field);
              return (
                <li key={field}>
                  {locked ? (
                    <span className="rules-chip">{field}</span>
                  ) : (
                    <button type="button" className="rules-chip" aria-label={fillUi(copy.removeField, { field })} onClick={() => onChange({ ...doc, fields: doc.fields.filter((item) => item !== field) })}>
                      {field}
                      <span aria-hidden="true"> ×</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="rules-inline">
            <label>
              {copy.addField}
              <input dir="ltr" spellCheck={false} value={fieldDraft} placeholder={copy.fieldPlaceholder} onChange={(e) => setFieldDraft(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                const field = fieldDraft.trim();
                if (!field || doc.fields.includes(field)) return;
                onChange({ ...doc, fields: [...doc.fields, field] });
                setFieldDraft("");
              }}
            >
              {copy.addField}
            </button>
          </div>

          <label className="choice">
            <input
              type="checkbox"
              checked={Boolean(doc.blankForm)}
              onChange={(e) => onChange({ ...doc, blankForm: e.target.checked ? { file: doc.blankForm?.file ?? "", once: "conversation" } : undefined })}
            />
            {copy.blankForm}
          </label>
          {doc.blankForm ? (
            <label>
              {copy.blankFile}
              <input dir="ltr" value={doc.blankForm.file} spellCheck={false} onChange={(e) => onChange({ ...doc, blankForm: { file: e.target.value, once: "conversation" } })} />
            </label>
          ) : null}

          {issues.map((issue) => (
            <p key={issue.raw} className="rules-error" role="alert">{issue.message}</p>
          ))}
          {removeNote ? <p className="rules-error" role="alert">{removeNote}</p> : null}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              if (usedBy) {
                setRemoveNote(fillUi(copy.inUse, { name: doc.labels.he || id }));
                return;
              }
              onRemove();
            }}
          >
            {copy.remove}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function withCheck(doc: DocTypeDef, index: number, check: Check | null): DocTypeDef {
  const checks = check === null ? doc.checks.filter((_, i) => i !== index) : doc.checks.map((item, i) => (i === index ? check : item));
  const inserted = check !== null && index >= doc.checks.length ? [...doc.checks, check] : checks;
  return { ...doc, checks: inserted, fields: mergeFields(doc.fields, inserted) };
}

function mergeFields(existing: string[], checks: Check[]): string[] {
  const needed = checks.map((check) => check.field.trim()).filter(Boolean);
  const extras = existing.filter((field) => !checks.some((check) => check.field === field));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const field of [...needed, ...extras]) {
    if (seen.has(field)) continue;
    seen.add(field);
    out.push(field);
  }
  return out;
}

function checkWithOp(prev: Check, op: Check["op"]): Check {
  const field = prev.field || "fullName";
  if (op === "field_present") return { op, field };
  if (op === "matches_profile") {
    return { op, field, profileKey: prev.op === "matches_profile" ? prev.profileKey : "nationalId" };
  }
  if (op === "date_within_months" || op === "prior_calendar_months") {
    const months = prev.op === "date_within_months" || prev.op === "prior_calendar_months" ? prev.months : 3;
    return { op, field, months };
  }
  return { op: "min_items", field, count: prev.op === "min_items" ? prev.count : 1 };
}

function checkSentence(check: Check, copy: EditorCopy): string {
  const field = check.field || "…";
  if (check.op === "field_present") return fillUi(copy.checkSentence.field_present, { field });
  if (check.op === "matches_profile") return fillUi(copy.checkSentence.matches_profile, { field, profileKey: check.profileKey || "…" });
  if (check.op === "date_within_months") return fillUi(copy.checkSentence.date_within_months, { field, months: check.months });
  if (check.op === "prior_calendar_months") return fillUi(copy.checkSentence.prior_calendar_months, { field, months: check.months });
  return fillUi(copy.checkSentence.min_items, { field, count: check.count });
}

function RequirementList({
  value,
  copy,
  issues,
  onChange,
  edit,
}: {
  value: RulesDocument;
  copy: EditorCopy;
  issues: { raw: string; message: string }[];
  onChange: (next: RulesDocument) => void;
  edit: (recipe: (draft: RulesDocument) => void) => void;
}) {
  const docs = Object.keys(value.documents);
  const waves = value.collectionStages ?? [];
  return (
    <div className="rules-stack">
      {value.requirements.map((req, index) => {
        const rowIssues = issues.filter((issue) => issue.raw.startsWith(`requirements[${index}]`));
        const shape = conditionShape(req.when);
        return (
          <div key={`${req.docType}-${index}`} className="rules-stage">
            <div className="rules-check-grid">
              <label>
                {copy.document}
                <select value={req.docType} onChange={(e) => patchReq(edit, index, { docType: e.target.value })}>
                  {docs.map((id) => (
                    <option key={id} value={id}>{value.documents[id]?.labels.he || id}</option>
                  ))}
                </select>
              </label>
              <label>
                {copy.stage}
                <select value={req.stage} onChange={(e) => patchReq(edit, index, { stage: e.target.value })}>
                  {value.stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>{stage.labels.he || stage.id}</option>
                  ))}
                </select>
              </label>
              <label>
                {copy.count}
                <input type="number" min={1} inputMode="numeric" value={req.count ?? 1} onChange={(e) => patchReq(edit, index, { count: Math.max(1, Number(e.target.value) || 1) })} />
              </label>
              <label>
                {copy.each}
                <select
                  value={req.each ?? ""}
                  onChange={(e) => {
                    const each = e.target.value;
                    patchReq(edit, index, {
                      each: each === "borrower" || each === "account" ? each : undefined,
                      empty: each === "account" ? "one" : undefined,
                    });
                  }}
                >
                  <option value="">{copy.eachOnce}</option>
                  <option value="borrower">{copy.eachBorrower}</option>
                  <option value="account">{copy.eachAccount}</option>
                </select>
              </label>
              <label>
                {copy.yearField}
                <select
                  value={req.year ?? ""}
                  onChange={(e) => {
                    const year = e.target.value;
                    patchReq(edit, index, { year: year === "taxYear" || year === "accountantYear" ? year : undefined });
                  }}
                >
                  <option value="">{copy.yearNone}</option>
                  <option value="taxYear">{copy.taxYear}</option>
                  <option value="accountantYear">{copy.accountantYear}</option>
                </select>
              </label>
              <label>
                {copy.monthsField}
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={req.months ?? ""}
                  onChange={(e) => {
                    const months = Number(e.target.value);
                    patchReq(edit, index, { months: Number.isFinite(months) && months >= 1 ? Math.floor(months) : undefined });
                  }}
                />
              </label>
              <label>
                {copy.countFromField}
                <select
                  value={req.countFrom ?? ""}
                  onChange={(e) => patchReq(edit, index, { countFrom: e.target.value === "loanCount" ? "loanCount" : undefined })}
                >
                  <option value="">{copy.countFixed}</option>
                  <option value="loanCount">{copy.countLoans}</option>
                </select>
              </label>
              {waves.length > 0 ? (
                <label>
                  {copy.collectionWave}
                  <select
                    value={req.collectionStage || waves[0]?.id || ""}
                    onChange={(e) => {
                      const picked = e.target.value;
                      patchReq(edit, index, { collectionStage: picked === waves[0]?.id ? undefined : picked });
                    }}
                  >
                    {waves.map((wave) => (
                      <option key={wave.id} value={wave.id}>{wave.labels.he || wave.id}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {shape === "nested" && req.when ? (
              <p className="rules-hint" role="note">{copy.nestedCondition}</p>
            ) : (
              <ConditionEditor when={req.when} copy={copy} onChange={(when) => patchReq(edit, index, { when })} />
            )}
            {rowIssues.map((issue) => (
              <p key={issue.raw} className="rules-error" role="alert">{issue.message}</p>
            ))}
            <button type="button" className="btn-ghost" onClick={() => edit((draft) => { draft.requirements = draft.requirements.filter((_, i) => i !== index); })}>
              {copy.remove}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          const docType = docs[0];
          const stage = value.stages[0]?.id;
          if (!docType || !stage) return;
          onChange({ ...value, requirements: [...value.requirements, { docType, stage, count: 1 }] });
        }}
      >
        {copy.addRequirement}
      </button>
    </div>
  );
}

function patchReq(edit: (recipe: (draft: RulesDocument) => void) => void, index: number, patch: Partial<Requirement>) {
  edit((draft) => {
    const current = draft.requirements[index];
    if (!current) return;
    const next = { ...current, ...patch };
    if (!next.collectionStage) delete next.collectionStage;
    if (!next.when) delete next.when;
    if (!next.each) delete next.each;
    if (!next.empty) delete next.empty;
    if (!next.year) delete next.year;
    if (!next.months) delete next.months;
    if (!next.countFrom) delete next.countFrom;
    draft.requirements[index] = next;
  });
}

function ConditionEditor({
  when,
  copy,
  onChange,
}: {
  when: Condition | undefined;
  copy: EditorCopy;
  onChange: (when: Condition | undefined) => void;
}) {
  const mode = !when ? "always" : when.op === "any" ? "any" : when.op === "all" ? "all" : "all";
  const leaves: Leaf[] = !when
    ? []
    : when.op === "all" || when.op === "any"
      ? when.of.filter((item): item is Leaf => item.op !== "all" && item.op !== "any")
      : [when];

  function commit(nextMode: "always" | "all" | "any", nextLeaves: Leaf[]) {
    if (nextMode === "always" || nextLeaves.length === 0) {
      onChange(undefined);
      return;
    }
    onChange({ op: nextMode === "any" ? "any" : "all", of: nextLeaves });
  }

  return (
    <div className="rules-condition">
      <label>
        {copy.when}
        <select
          value={mode === "any" ? "any" : when ? "all" : "always"}
          onChange={(e) => {
            const picked = e.target.value;
            if (picked === "always") commit("always", []);
            else commit(picked === "any" ? "any" : "all", leaves.length ? leaves : [defaultLeaf()]);
          }}
        >
          <option value="always">{copy.always}</option>
          <option value="all">{copy.onlyWhenAll}</option>
          <option value="any">{copy.onlyWhenAny}</option>
        </select>
      </label>
      {when ? (
        <ul className="rules-checks">
          {leaves.map((leaf, index) => (
            <li key={`${leaf.op}-${index}`} className="rules-check-grid">
              <label>
                {copy.condKey}
                <select
                  value={leaf.op}
                  aria-label={copy.condKey}
                  onChange={(e) => {
                    const op = e.target.value as Leaf["op"];
                    const next = leaves.slice();
                    next[index] = leafWithOp(leaf, op);
                    commit(mode === "any" ? "any" : "all", next);
                  }}
                >
                  {(["eq", "neq", "gt", "truthy"] as const).map((op) => (
                    <option key={op} value={op}>{copy.condOps[op]}</option>
                  ))}
                </select>
              </label>
              <label>
                {copy.condKey}
                <input
                  dir="ltr"
                  spellCheck={false}
                  value={leaf.key}
                  onChange={(e) => {
                    const next = leaves.slice();
                    next[index] = { ...leaf, key: e.target.value };
                    commit(mode === "any" ? "any" : "all", next);
                  }}
                />
              </label>
              {leaf.op === "eq" || leaf.op === "neq" ? (
                <ValueField
                  value={leaf.value}
                  copy={copy}
                  onChange={(nextValue) => {
                    const next = leaves.slice();
                    next[index] = { ...leaf, value: nextValue };
                    commit(mode === "any" ? "any" : "all", next);
                  }}
                />
              ) : null}
              {leaf.op === "gt" ? (
                <label>
                  {copy.condValue}
                  <input
                    type="number"
                    inputMode="numeric"
                    value={leaf.value}
                    onChange={(e) => {
                      const next = leaves.slice();
                      next[index] = { ...leaf, value: Number(e.target.value) };
                      commit(mode === "any" ? "any" : "all", next);
                    }}
                  />
                </label>
              ) : null}
              <button
                type="button"
                className="btn-ghost"
                onClick={() => commit(mode === "any" ? "any" : "all", leaves.filter((_, i) => i !== index))}
              >
                {copy.remove}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {when ? (
        <button type="button" className="btn-secondary" onClick={() => commit(mode === "any" ? "any" : "all", [...leaves, defaultLeaf()])}>
          {copy.addCondition}
        </button>
      ) : null}
    </div>
  );
}

function defaultLeaf(): Leaf {
  return { op: "truthy", key: "employment" };
}

function leafValue(prev: Leaf): string | number | boolean {
  if (prev.op === "truthy") return "";
  return prev.value;
}

function leafWithOp(prev: Leaf, op: Leaf["op"]): Leaf {
  const current = leafValue(prev);
  if (op === "truthy") return { op, key: prev.key };
  if (op === "gt") return { op, key: prev.key, value: typeof current === "number" ? current : 0 };
  return { op, key: prev.key, value: typeof current === "boolean" ? "" : current };
}

function ValueField({
  value,
  copy,
  onChange,
}: {
  value: string | number | boolean;
  copy: EditorCopy;
  onChange: (value: string | number | boolean) => void;
}) {
  const kind = value === true ? "yes" : value === false ? "no" : typeof value === "number" ? "number" : "text";
  return (
    <>
      <label>
        {copy.valueKind}
        <select
          value={kind}
          aria-label={copy.valueKind}
          onChange={(e) => {
            const next = e.target.value;
            if (next === "yes") onChange(true);
            else if (next === "no") onChange(false);
            else if (next === "number") onChange(typeof value === "number" ? value : 0);
            else onChange(typeof value === "string" ? value : "");
          }}
        >
          <option value="text">{copy.valueText}</option>
          <option value="number">{copy.valueNumber}</option>
          <option value="yes">{copy.valueYes}</option>
          <option value="no">{copy.valueNo}</option>
        </select>
      </label>
      {kind === "text" || kind === "number" ? (
        <label>
          {copy.condValue}
          <input
            dir="ltr"
            type={kind === "number" ? "number" : "text"}
            inputMode={kind === "number" ? "numeric" : "text"}
            value={typeof value === "string" || typeof value === "number" ? value : ""}
            onChange={(e) => onChange(kind === "number" ? Number(e.target.value) : e.target.value)}
          />
        </label>
      ) : null}
    </>
  );
}

function JsonPanel({
  value,
  copy,
  onApply,
}: {
  value: RulesDocument;
  copy: EditorCopy;
  onApply: (next: RulesDocument) => void;
}) {
  const serialized = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const [draft, setDraft] = useState(serialized);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) setDraft(serialized);
  }, [serialized, dirty]);

  return (
    <details className="rules-json">
      <summary>{copy.jsonTitle}</summary>
      <p className="rules-hint">{copy.jsonHint}</p>
      {dirty && draft !== serialized ? <p className="rules-hint">{copy.jsonStale}</p> : null}
      <label>
        {copy.jsonTitle}
        <textarea
          className="rules-json-box"
          rows={14}
          dir="ltr"
          spellCheck={false}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
            setError(null);
          }}
        />
      </label>
      {error ? <p className="rules-error" role="alert">{error}</p> : null}
      <div className="rules-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            try {
              onApply(loadParsed(draft));
              setDirty(false);
              setError(null);
            } catch (err) {
              setError(jsonErrorMessage(err, copy));
            }
          }}
        >
          {copy.jsonApply}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setDraft(serialized);
            setDirty(false);
            setError(null);
          }}
        >
          {copy.jsonDiscard}
        </button>
      </div>
    </details>
  );
}

function loadParsed(raw: string): RulesDocument {
  return parseRules(JSON.parse(raw) as unknown);
}

function jsonErrorMessage(err: unknown, copy: EditorCopy): string {
  if (err instanceof RulesError) {
    return err.errors.map((raw) => explainRulesIssue(raw, issueText(copy))).join(" ");
  }
  return copy.jsonInvalid;
}

