"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RadioCard } from "@/components/RadioCard";
import {
  isBookingStance,
  isCapabilityId,
  type BookingStance,
  type CapabilityId,
  type CatalogId,
} from "@/lib/flow/catalog";
import {
  defaultBookingCollect,
  sanitizeBookingCollect,
  type BookingCollectId,
} from "@/lib/flow/booking-collect";
import {
  DEFAULT_RESERVATION_COLLECT,
  RESERVATION_COLLECT_PRESETS,
  RESERVATION_CORE_FIELDS,
  parseReservationConfig,
  type ReservationConfig,
  type ReservationSubmitMode,
} from "@/lib/flow/reservation-config";
import { isChatLanguage, looksHebrew, type ChatLanguage } from "@/lib/flow/locale";
import { copyFor } from "@/lib/copy";
import { fillUi, stepLabel, uiCopy, type UiLang } from "@/lib/ui";

const WIZARD_STEPS = ["knowledge", "business", "flow", "done"] as const;
const PRODUCT_CAPABILITIES: CapabilityId[] = ["booking", "reservations"];
const READY_CAPABILITIES = new Set<CapabilityId>(["booking", "reservations"]);

type Props = {
  name: string;
  phone: string;
  intro: string;
  knowledgeText: string;
  catalogId: string;
  capabilities?: string[];
  bookingStance?: string;
  chatLanguage: string;
  idleResetDays: number;
  bookingCollect?: string[];
  venueAddress?: string;
  venueHours?: string;
  bookingRequestTemplate?: string;
  bookingApprovedTemplate?: string;
  bookingRejectedTemplate?: string;
  reservationConfig?: unknown;
  uiLang?: UiLang;
};

function initialCapabilities(props: Props): CapabilityId[] {
  if (props.capabilities?.length) {
    return props.capabilities.filter(isCapabilityId);
  }
  const catalog = props.catalogId;
  if (catalog === "faq") return [];
  return ["booking"];
}

function initialStance(props: Props): BookingStance {
  if (props.bookingStance && isBookingStance(props.bookingStance)) {
    return props.bookingStance;
  }
  if (props.catalogId === "book") return "proactive";
  return "passive";
}

export function OnboardWizard(props: Props) {
  const ui = uiCopy(props.uiLang === "en" ? "en" : "he");
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(props.name);
  const [phone, setPhone] = useState(props.phone);
  const [intro, setIntro] = useState(props.intro);
  const [knowledgeText, setKnowledgeText] = useState(props.knowledgeText);
  const [capabilities, setCapabilities] = useState<CapabilityId[]>(() =>
    initialCapabilities(props),
  );
  const [bookingStance, setBookingStance] = useState<BookingStance>(() =>
    initialStance(props),
  );
  const [chatLanguage, setChatLanguage] = useState<ChatLanguage>(() => {
    if (isChatLanguage(props.chatLanguage)) return props.chatLanguage;
    return looksHebrew(props.intro) ? "he" : "multi";
  });
  const idleResetDays = Number.isFinite(props.idleResetDays) ? props.idleResetDays : 5;
  const [bookingCollect, setBookingCollect] = useState<BookingCollectId[]>(() =>
    sanitizeBookingCollect(props.bookingCollect?.length ? props.bookingCollect : defaultBookingCollect),
  );
  const initialReservation = parseReservationConfig(props.reservationConfig);
  const [reservationCollect, setReservationCollect] = useState<string[]>(
    () => initialReservation.collect,
  );
  const [reservationFieldLabels, setReservationFieldLabels] = useState<Record<string, string>>(
    () => initialReservation.fieldLabels ?? {},
  );
  const [reservationSubmitMode, setReservationSubmitMode] = useState<ReservationSubmitMode>(
    () => initialReservation.submitMode,
  );
  const [bookingLinkTemplate, setBookingLinkTemplate] = useState(
    () => initialReservation.bookingLinkTemplate ?? "",
  );
  const [sendLinkTemplate, setSendLinkTemplate] = useState(
    () => initialReservation.messageTemplates?.sendLink ?? "",
  );
  const [customFieldDraft, setCustomFieldDraft] = useState("");
  const bookingEnabled = capabilities.includes("booking");
  const reservationsEnabled = capabilities.includes("reservations");
  const catalogId: CatalogId =
    bookingEnabled || reservationsEnabled ? "inbox" : "faq";
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
  const [filledCount, setFilledCount] = useState<number | null>(null);
  const extractedSourceRef = useRef("");

  const bookingLinkValid =
    reservationSubmitMode !== "send_link" ||
    (bookingLinkTemplate.includes("{{checkIn}}") &&
      bookingLinkTemplate.includes("{{checkOut}}") &&
      bookingLinkTemplate.trim().length > 0);

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
      if (data.extracted) {
        applyExtracted(data.extracted);
        const e = data.extracted;
        const n = [e.name, e.phone, e.intro, e.venueAddress, e.venueHours].filter(
          (v) => (v ?? "").trim(),
        ).length;
        setFilledCount(n);
      }
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
    const reservationConfig: ReservationConfig | undefined = reservationsEnabled
      ? {
          ...parseReservationConfig(props.reservationConfig),
          collect: reservationCollect.length
            ? reservationCollect
            : [...DEFAULT_RESERVATION_COLLECT],
          fieldLabels: Object.keys(reservationFieldLabels).length
            ? reservationFieldLabels
            : undefined,
          submitMode: reservationSubmitMode,
          bookingLinkTemplate: bookingLinkTemplate.trim() || undefined,
          messageTemplates: {
            ...parseReservationConfig(props.reservationConfig).messageTemplates,
            sendLink: sendLinkTemplate.trim() || undefined,
          },
        }
      : undefined;
    const res = await fetch("/api/onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        phone,
        intro,
        knowledgeText,
        catalogId,
        capabilities,
        bookingStance,
        chatLanguage,
        idleResetDays,
        bookingCollect,
        venueAddress,
        venueHours,
        bookingRequestTemplate,
        bookingApprovedTemplate,
        bookingRejectedTemplate,
        reservationConfig,
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

  function toggleReservationCollect(id: string) {
    setReservationCollect((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function addCustomReservationField() {
    const draft = customFieldDraft.trim();
    if (!draft) return;
    const key = draft
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) return;
    if (key === "check_in" || key === "check_out") return;
    const label = draft.includes(" ") || draft !== key ? draft : key.replaceAll("_", " ");
    setReservationCollect((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setReservationFieldLabels((prev) =>
      prev[key] ? prev : { ...prev, [key]: label },
    );
    setCustomFieldDraft("");
  }

  const agentLang = chatLanguage === "he" ? "he" : "en";
  const tokens = [
    "{{date}}",
    "{{time}}",
    "{{slot}}",
    "{{name}}",
    "{{phone}}",
    "{{email}}",
    "{{need}}",
    "{{details}}",
    "{{kind}}",
    "{{address}}",
    "{{hours}}",
  ];

  function appendToken(current: string, set: (v: string) => void, token: string) {
    set(`${current}${current ? " " : ""}${token}`);
  }

  return (
    <div className="stack form-narrow">
      <div className="wizard-steps">
        {WIZARD_STEPS.map((_, i) => (
          <button
            key={stepTitles[i]}
            type="button"
            className={`wizard-step${i === step ? " active" : ""}${i < step ? " done" : ""}`}
            onClick={() => setStep(i)}
          >
            {stepTitles[i]}
          </button>
        ))}
      </div>

      <div className="card stack">
        <p className="muted">{stepLabel(ui, Math.min(step + 1, 4), 4)}</p>

        {step === 0 ? (
          <>
            <h2>{ui.common.knowledge}</h2>
            <p className="muted">{ui.onboard.knowledgeHint}</p>
            <div className="knowledge-split">
              <textarea
                rows={10}
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
            </div>
            {filledCount != null ? (
              <p className="muted">{fillUi(ui.onboard.filledFields, { count: filledCount })}</p>
            ) : null}
            <div className="wizard-footer">
              <button
                type="button"
                className="btn-secondary"
                disabled={extracting || !knowledgeText.trim()}
                onClick={() => void extractFrom(knowledgeText)}
              >
                {extracting ? ui.common.extracting : ui.common.extract}
              </button>
              <button type="button" className="btn" onClick={() => setStep(1)} disabled={extracting}>
                {ui.common.next}
              </button>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h2>{ui.common.business}</h2>
            <fieldset>
              <legend>{ui.onboard.agentLanguageLegend}</legend>
              <p className="muted">{ui.onboard.agentLanguageHint}</p>
              <div className="segmented">
                {(["multi", "he", "en"] as const).map((id) => (
                  <label key={id} className={chatLanguage === id ? "selected" : ""}>
                    <input
                      type="radio"
                      name="chatLanguage"
                      checked={chatLanguage === id}
                      onChange={() => setChatLanguage(id)}
                    />
                    {ui.chatLanguage[id].title}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="row">
              <label>
                {ui.onboard.fieldName}
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label>
                {ui.onboard.fieldPhone}
                <input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
            </div>
            <label>
              {ui.onboard.fieldIntro}
              <textarea
                rows={3}
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                placeholder={ui.onboard.fieldIntroPlaceholder}
              />
            </label>
            <div className="row">
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
            </div>
            {bookingEnabled ? (
            <details className="onboard-advanced">
              <summary>{ui.common.advanced}</summary>
              <div className="stack" style={{ marginTop: "0.75rem" }}>
                <label>
                  {ui.onboard.fieldBookingRequest}
                  <textarea
                    rows={3}
                    value={bookingRequestTemplate}
                    onChange={(e) => setBookingRequestTemplate(e.target.value)}
                    placeholder={copyFor(agentLang).chat.bookingRequestTemplate}
                  />
                </label>
                <div className="token-chips">
                  {tokens.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        appendToken(bookingRequestTemplate, setBookingRequestTemplate, t)
                      }
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <label>
                  {ui.onboard.fieldBookingApproved}
                  <textarea
                    rows={3}
                    value={bookingApprovedTemplate}
                    onChange={(e) => setBookingApprovedTemplate(e.target.value)}
                    placeholder={copyFor(agentLang).chat.bookingApprovedTemplate}
                  />
                </label>
                <label>
                  {ui.onboard.fieldBookingRejected}
                  <textarea
                    rows={2}
                    value={bookingRejectedTemplate}
                    onChange={(e) => setBookingRejectedTemplate(e.target.value)}
                    placeholder={copyFor(agentLang).chat.bookingRejected}
                  />
                </label>
                <p className="muted">{ui.onboard.templatesHint}</p>
              </div>
            </details>
            ) : null}
            <div className="wizard-footer">
              <button type="button" className="btn-secondary" onClick={() => setStep(0)}>
                {ui.common.back}
              </button>
              <button type="button" className="btn" onClick={() => setStep(2)} disabled={!name.trim() || !intro.trim()}>
                {ui.common.next}
              </button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2>{ui.common.flow}</h2>
            <fieldset>
              <legend>{ui.onboard.capabilitiesLegend}</legend>
              <p className="muted">{ui.onboard.capabilitiesHint}</p>
              <div className="chip-row">
                {PRODUCT_CAPABILITIES.map((id) => {
                  const meta = ui.capabilities[id];
                  const ready = READY_CAPABILITIES.has(id);
                  const checked = capabilities.includes(id);
                  return (
                    <label
                      key={id}
                      className={`chip-toggle${checked ? " selected" : ""}${ready ? "" : " muted"}`}
                      title={meta.blurb}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!ready}
                        onChange={() => {
                          if (!ready) return;
                          setCapabilities((prev) =>
                            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                          );
                        }}
                      />
                      {meta.title}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {bookingEnabled ? (
              <>
              <fieldset>
                <legend>{ui.onboard.bookingStanceLegend}</legend>
                <div className="radio-card-grid compact">
                  {(["passive", "proactive"] as const).map((id) => (
                    <RadioCard
                      key={id}
                      name="bookingStance"
                      value={id}
                      checked={bookingStance === id}
                      onChange={() => setBookingStance(id)}
                      title={ui.bookingStance[id].title}
                      blurb={ui.bookingStance[id].blurb}
                    />
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>{ui.onboard.collectLegend}</legend>
                <p className="muted">{ui.onboard.collectHint}</p>
                <div className="chip-row">
                  {(["need", "phone", "email", "visit_kind"] as BookingCollectId[]).map((id) => {
                    const meta = ui.bookingCollect[id];
                    if (!meta) return null;
                    const checked = bookingCollect.includes(id);
                    return (
                      <label key={id} className={`chip-toggle${checked ? " selected" : ""}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setBookingCollect((prev) =>
                              sanitizeBookingCollect(
                                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                              ),
                            );
                          }}
                        />
                        {meta.title}
                      </label>
                    );
                  })}
                </div>
                <p className="muted">
                  {ui.bookingCollect.time_preference?.title} · {ui.bookingCollect.name?.title}:{" "}
                  {ui.onboard.timeAlwaysCollected}
                </p>
              </fieldset>
              </>
            ) : null}
            {reservationsEnabled ? (
              <>
              <fieldset>
                <legend>{ui.onboard.reservationCollectLegend}</legend>
                <p className="muted">{ui.onboard.reservationCollectHint}</p>
                <div className="chip-row">
                  {RESERVATION_CORE_FIELDS.map((id) => {
                    const meta = ui.reservationCollect[id];
                    return (
                      <label
                        key={id}
                        className="chip-toggle selected muted"
                        title={ui.onboard.reservationDatesAlways}
                      >
                        <input type="checkbox" checked disabled readOnly />
                        {meta?.title ?? id}
                      </label>
                    );
                  })}
                  {RESERVATION_COLLECT_PRESETS.map((id) => {
                    const meta = ui.reservationCollect[id];
                    const checked = reservationCollect.includes(id);
                    return (
                      <label
                        key={id}
                        className={`chip-toggle${checked ? " selected" : ""}`}
                        title={meta?.blurb}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleReservationCollect(id)}
                        />
                        {meta?.title ?? id}
                      </label>
                    );
                  })}
                  {reservationCollect
                    .filter((id) => !(RESERVATION_COLLECT_PRESETS as readonly string[]).includes(id))
                    .map((id) => (
                      <label key={id} className="chip-toggle selected">
                        <input
                          type="checkbox"
                          checked
                          onChange={() => toggleReservationCollect(id)}
                        />
                        {reservationFieldLabels[id] ?? id}
                      </label>
                    ))}
                </div>
                <p className="muted">{ui.onboard.reservationDatesAlways}</p>
                <div className="row-actions" style={{ marginTop: "0.75rem", gap: "0.5rem" }}>
                  <input
                    type="text"
                    value={customFieldDraft}
                    placeholder={ui.onboard.reservationCustomFieldHint}
                    aria-label={ui.onboard.reservationCustomField}
                    onChange={(e) => setCustomFieldDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomReservationField();
                      }
                    }}
                  />
                  <button type="button" className="btn-secondary" onClick={addCustomReservationField}>
                    {ui.onboard.reservationAddField}
                  </button>
                </div>
              </fieldset>
              <fieldset>
                <legend>{ui.onboard.reservationSubmitModeLegend}</legend>
                <div className="radio-card-grid compact">
                  <RadioCard
                    name="reservationSubmitMode"
                    value="hitl"
                    checked={reservationSubmitMode === "hitl"}
                    onChange={() => setReservationSubmitMode("hitl")}
                    title={ui.onboard.reservationSubmitModeHitl}
                    blurb={ui.onboard.reservationSubmitModeHitlBlurb}
                  />
                  <RadioCard
                    name="reservationSubmitMode"
                    value="send_link"
                    checked={reservationSubmitMode === "send_link"}
                    onChange={() => setReservationSubmitMode("send_link")}
                    title={ui.onboard.reservationSubmitModeLink}
                    blurb={ui.onboard.reservationSubmitModeLinkBlurb}
                  />
                </div>
                {reservationSubmitMode === "send_link" ? (
                  <>
                    <label style={{ display: "block", marginTop: "0.75rem" }}>
                      {ui.onboard.reservationBookingLinkLegend}
                      <textarea
                        value={bookingLinkTemplate}
                        onChange={(e) => setBookingLinkTemplate(e.target.value)}
                        rows={3}
                        placeholder="https://app.b-on.co.il/online/order-v2/{{propertySlug}}?dateFrom={{checkIn}}&dateTo={{checkOut}}"
                        style={{ width: "100%", marginTop: "0.35rem" }}
                      />
                    </label>
                    <p className="muted">{ui.onboard.reservationBookingLinkHint}</p>
                    {!bookingLinkValid ? (
                      <p className="muted" role="alert">
                        {ui.onboard.reservationBookingLinkInvalid}
                      </p>
                    ) : null}
                    <label style={{ display: "block", marginTop: "0.75rem" }}>
                      {ui.onboard.reservationSendLinkTemplateLegend}
                      <textarea
                        value={sendLinkTemplate}
                        onChange={(e) => setSendLinkTemplate(e.target.value)}
                        rows={2}
                        placeholder="{{bookingUrl}}"
                        style={{ width: "100%", marginTop: "0.35rem" }}
                      />
                    </label>
                    <p className="muted">{ui.onboard.reservationSendLinkTemplateHint}</p>
                  </>
                ) : null}
              </fieldset>
              </>
            ) : null}
            <div className="wizard-footer">
              <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
                {ui.common.back}
              </button>
              <button
                type="button"
                className="btn"
                onClick={save}
                disabled={saving || (reservationsEnabled && !bookingLinkValid)}
              >
                {saving ? ui.common.saving : ui.common.save}
              </button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h2>{ui.common.done}</h2>
            <p className="muted">{ui.onboard.doneHint}</p>
            <dl className="detail-list">
              <dt>{ui.onboard.fieldName}</dt>
              <dd>{name}</dd>
              <dt>{ui.onboard.agentLanguageLegend}</dt>
              <dd>{ui.chatLanguage[chatLanguage].title}</dd>
              <dt>{ui.onboard.capabilitiesLegend}</dt>
              <dd>
                {capabilities.length
                  ? capabilities.map((id) => ui.capabilities[id].title).join(" · ")
                  : ui.catalog.faq.title}
              </dd>
            </dl>
            <div className="wizard-footer">
              <button type="button" className="btn-secondary" onClick={() => router.push("/inbox")}>
                {ui.nav.inbox}
              </button>
              <button type="button" className="btn" onClick={() => router.push("/demo")}>
                {ui.page.homeChat}
              </button>
            </div>
          </>
        ) : null}

        {error ? <p className="muted">{error}</p> : null}
      </div>
    </div>
  );
}
