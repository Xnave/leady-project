"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FlowMap } from "@/components/FlowMap";
import { flowForCatalog, isCatalogId, type CatalogId } from "@/lib/flow/catalog";
import {
  defaultBookingCollect,
  sanitizeBookingCollect,
  type BookingCollectId,
} from "@/lib/flow/booking-collect";
import { isChatLanguage, looksHebrew, type ChatLanguage } from "@/lib/flow/locale";
import { copyFor } from "@/lib/copy";
import { stepLabel, uiCopy, type UiLang } from "@/lib/ui";

const WIZARD_STEPS = ["knowledge", "business", "flow", "done"] as const;

type Props = {
  name: string;
  phone: string;
  intro: string;
  knowledgeText: string;
  catalogId: string;
  chatLanguage: string;
  idleResetDays: number;
  bookingCollect?: string[];
  venueAddress?: string;
  venueHours?: string;
  bookingRequestTemplate?: string;
  bookingApprovedTemplate?: string;
  bookingRejectedTemplate?: string;
  uiLang?: UiLang;
};

export function OnboardWizard(props: Props) {
  const ui = uiCopy(props.uiLang === "en" ? "en" : "he");
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(props.name);
  const [phone, setPhone] = useState(props.phone);
  const [intro, setIntro] = useState(props.intro);
  const [knowledgeText, setKnowledgeText] = useState(props.knowledgeText);
  const [catalogId, setCatalogId] = useState<CatalogId>(
    isCatalogId(props.catalogId) ? props.catalogId : "inbox",
  );
  const [chatLanguage, setChatLanguage] = useState<ChatLanguage>(() => {
    if (isChatLanguage(props.chatLanguage)) return props.chatLanguage;
    return looksHebrew(props.intro) ? "he" : "multi";
  });
  const [idleResetDays, setIdleResetDays] = useState(
    Number.isFinite(props.idleResetDays) ? props.idleResetDays : 5,
  );
  const [bookingCollect, setBookingCollect] = useState<BookingCollectId[]>(() =>
    sanitizeBookingCollect(props.bookingCollect?.length ? props.bookingCollect : defaultBookingCollect),
  );
  const [venueAddress, setVenueAddress] = useState(props.venueAddress ?? "");
  const [venueHours, setVenueHours] = useState(props.venueHours ?? "");
  const [bookingRequestTemplate, setBookingRequestTemplate] = useState(
    props.bookingRequestTemplate ?? "",
  );
  const [bookingApprovedTemplate, setBookingApprovedTemplate] = useState(
    props.bookingApprovedTemplate ?? "",
  );
  const [bookingRejectedTemplate, setBookingRejectedTemplate] = useState(
    props.bookingRejectedTemplate ?? "",
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const extractedSourceRef = useRef("");
  const flow = useMemo(
    () => flowForCatalog(catalogId, bookingCollect),
    [catalogId, bookingCollect],
  );

  const stepTitles = [ui.common.knowledge, ui.common.business, ui.common.flow, ui.common.done];

  function applyExtracted(extracted: {
    name?: string;
    phone?: string;
    intro?: string;
    venueAddress?: string;
    venueHours?: string;
    chatLanguage?: string;
  }) {
    const t = (v?: string) => v?.trim() ?? "";
    if (t(extracted.name)) setName(t(extracted.name));
    if (t(extracted.phone)) setPhone(t(extracted.phone));
    if (t(extracted.intro)) setIntro(t(extracted.intro));
    if (t(extracted.venueAddress)) setVenueAddress(t(extracted.venueAddress));
    if (t(extracted.venueHours)) setVenueHours(t(extracted.venueHours));
    if (extracted.chatLanguage && isChatLanguage(extracted.chatLanguage)) {
      setChatLanguage(extracted.chatLanguage);
    }
  }

  async function extractFrom(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed) return true;
    if (extractedSourceRef.current === trimmed) return true;
    setExtracting(true);
    setError("");
    try {
      const res = await fetch("/api/onboard/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        extracted?: Parameters<typeof applyExtracted>[0];
        error?: string;
        llmConfigured?: boolean;
      };
      if (!res.ok) {
        setError(data.error ?? ui.onboard.extractFailed);
        return false;
      }
      extractedSourceRef.current = trimmed;
      if (data.extracted) applyExtracted(data.extracted);
      if (data.llmConfigured === false) setError(ui.onboard.noLlm);
      return true;
    } finally {
      setExtracting(false);
    }
  }

  async function onDrop(files: FileList | null) {
    if (!files?.length) return;
    const chunks: string[] = [];
    for (const file of Array.from(files)) {
      if (!/\.(txt|md)$/i.test(file.name)) continue;
      chunks.push(await file.text());
    }
    if (!chunks.length) {
      setError(ui.onboard.dropInvalid);
      return;
    }
    const next = chunks.join("\n\n");
    setKnowledgeText(next);
    await extractFrom(next);
  }

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch("/api/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        phone,
        intro,
        knowledgeText,
        catalogId,
        chatLanguage,
        idleResetDays,
        bookingCollect,
        venueAddress,
        venueHours,
        bookingRequestTemplate,
        bookingApprovedTemplate,
        bookingRejectedTemplate,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? ui.onboard.saveFailed);
      return;
    }
    setStep(3);
  }

  const agentLang = chatLanguage === "he" ? "he" : "en";

  return (
    <div className="stack">
      <fieldset className="card language-card">
        <legend>{ui.onboard.agentLanguageLegend}</legend>
        <p className="muted">{ui.onboard.agentLanguageHint}</p>
        {(["multi", "he", "en"] as const).map((id) => (
          <label key={id} className="choice">
            <input
              type="radio"
              name="chatLanguage"
              checked={chatLanguage === id}
              onChange={() => setChatLanguage(id)}
            />
            <span>
              <strong>{ui.chatLanguage[id].title}</strong>
              <span className="muted"> — {ui.chatLanguage[id].blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="wizard-steps">
        {WIZARD_STEPS.map((_, i) => (
          <div
            key={stepTitles[i]}
            className={`wizard-step${i === step ? " active" : ""}${i < step ? " done" : ""}`}
          >
            {stepTitles[i]}
          </div>
        ))}
      </div>

      <div className="card stack">
        <p className="muted">{stepLabel(ui, Math.min(step + 1, 4), 4)}</p>

        {step === 0 ? (
          <>
            <h2>{ui.common.knowledge}</h2>
            <p className="muted">{ui.onboard.knowledgeHint}</p>
            <textarea
              rows={8}
              value={knowledgeText}
              onChange={(e) => setKnowledgeText(e.target.value)}
              placeholder={ui.onboard.knowledgePlaceholder}
              disabled={extracting}
            />
            <label className="dropzone">
              {extracting ? ui.onboard.dropzoneBusy : ui.onboard.dropzoneIdle}
              <input
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                multiple
                disabled={extracting}
                onChange={(e) => {
                  void onDrop(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <div className="row-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={extracting || !knowledgeText.trim()}
                onClick={() => void extractFrom(knowledgeText)}
              >
                {extracting ? ui.common.extracting : ui.common.extract}
              </button>
              <button type="button" onClick={() => setStep(1)} disabled={extracting}>
                {ui.common.next}
              </button>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h2>{ui.common.business}</h2>
            <p className="muted">{ui.onboard.businessHint}</p>
            <label>
              {ui.onboard.fieldName}
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              {ui.onboard.fieldPhone}
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label>
              {ui.onboard.fieldIntro}
              <textarea
                rows={4}
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                placeholder={ui.onboard.fieldIntroPlaceholder}
              />
            </label>
            <label>
              {ui.onboard.fieldAddress}
              <input
                value={venueAddress}
                onChange={(e) => setVenueAddress(e.target.value)}
                placeholder={ui.onboard.fieldAddressPlaceholder}
              />
            </label>
            <label>
              {ui.onboard.fieldHours}
              <input
                value={venueHours}
                onChange={(e) => setVenueHours(e.target.value)}
                placeholder={ui.onboard.fieldHoursPlaceholder}
              />
            </label>
            <label>
              {ui.onboard.fieldBookingRequest}
              <textarea
                rows={5}
                value={bookingRequestTemplate}
                onChange={(e) => setBookingRequestTemplate(e.target.value)}
                placeholder={copyFor(agentLang).chat.bookingRequestTemplate}
              />
            </label>
            <label>
              {ui.onboard.fieldBookingApproved}
              <textarea
                rows={4}
                value={bookingApprovedTemplate}
                onChange={(e) => setBookingApprovedTemplate(e.target.value)}
                placeholder={copyFor(agentLang).chat.bookingApprovedTemplate}
              />
            </label>
            <label>
              {ui.onboard.fieldBookingRejected}
              <textarea
                rows={3}
                value={bookingRejectedTemplate}
                onChange={(e) => setBookingRejectedTemplate(e.target.value)}
                placeholder={copyFor(agentLang).chat.bookingRejected}
              />
            </label>
            <p className="muted">{ui.onboard.templatesHint}</p>
            <label>
              {ui.onboard.fieldIdleDays}
              <input
                type="number"
                min={0}
                max={365}
                value={idleResetDays}
                onChange={(e) => setIdleResetDays(Number(e.target.value))}
              />
            </label>
            <p className="muted">{ui.onboard.idleHint}</p>
            <div className="row-actions">
              <button type="button" className="btn-secondary" onClick={() => setStep(0)}>
                {ui.common.back}
              </button>
              <button type="button" onClick={() => setStep(2)} disabled={!name.trim() || !intro.trim()}>
                {ui.common.next}
              </button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2>{ui.common.flow}</h2>
            <fieldset>
              <legend>{ui.onboard.catalogLegend}</legend>
              {(["inbox", "book", "faq"] as const).map((id) => (
                <label key={id} className="choice">
                  <input
                    type="radio"
                    name="catalogId"
                    checked={catalogId === id}
                    onChange={() => setCatalogId(id)}
                  />
                  <span>
                    <strong>{ui.catalog[id].title}</strong>
                    <span className="muted"> — {ui.catalog[id].blurb}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {catalogId !== "faq" ? (
              <fieldset>
                <legend>{ui.onboard.collectLegend}</legend>
                <p className="muted">{ui.onboard.collectHint}</p>
                {(
                  [
                    "time_preference",
                    "name",
                    "need",
                    "phone",
                    "email",
                    "visit_kind",
                  ] as BookingCollectId[]
                ).map((id) => {
                  const meta = ui.bookingCollect[id];
                  if (!meta) return null;
                  const locked = id === "time_preference";
                  return (
                    <label key={id} className="choice">
                      <input
                        type="checkbox"
                        checked={bookingCollect.includes(id)}
                        disabled={locked}
                        onChange={() => {
                          if (locked) return;
                          setBookingCollect((prev) =>
                            prev.includes(id)
                              ? prev.filter((x) => x !== id)
                              : [...prev, id],
                          );
                        }}
                      />
                      <span>
                        <strong>{meta.title}</strong>
                        <span className="muted"> — {meta.blurb}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ) : null}
            <FlowMap flow={flow} labels={ui.flow} />
            <div className="row-actions">
              <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
                {ui.common.back}
              </button>
              <button type="button" onClick={save} disabled={saving}>
                {saving ? ui.common.saving : ui.common.save}
              </button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h2>{ui.common.done}</h2>
            <p className="muted">{ui.onboard.doneHint}</p>
            <button type="button" onClick={() => router.push("/demo")}>
              {ui.page.homeChat}
            </button>
          </>
        ) : null}

        {error ? <p className="muted">{error}</p> : null}
      </div>
    </div>
  );
}
