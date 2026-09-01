"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FlowMap } from "@/components/FlowMap";
import { catalogMeta, flowForCatalog, isCatalogId, type CatalogId } from "@/lib/flow/catalog";
import {
  bookingCollectMeta,
  defaultBookingCollect,
  sanitizeBookingCollect,
  type BookingCollectId,
} from "@/lib/flow/booking-collect";
import { chatLanguageMeta, isChatLanguage, looksHebrew, type ChatLanguage } from "@/lib/flow/locale";
import { copyFor } from "@/lib/copy";

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
};

export function OnboardWizard(props: Props) {
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
        setError(data.error ?? "Could not extract from the file");
        return false;
      }
      extractedSourceRef.current = trimmed;
      if (data.extracted) applyExtracted(data.extracted);
      if (data.llmConfigured === false) {
        setError("No LLM key configured — fill business details on the next step.");
      }
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
      setError("Drop .txt or .md files only");
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
      setError(data.error ?? "Could not save");
      return;
    }
    setStep(3);
  }

  return (
    <div className="stack">
      <fieldset className="card language-card">
        <legend>שפת הסוכן · Agent language</legend>
        <p className="muted">חובה לבחור. זה קובע באיזו שפה הסוכן עונה בצ׳אט.</p>
        {chatLanguageMeta.map((item) => (
          <label key={item.id} className="choice">
            <input
              type="radio"
              name="chatLanguage"
              checked={chatLanguage === item.id}
              onChange={() => setChatLanguage(item.id)}
            />
            <span>
              <strong>{item.title}</strong>
              <span className="muted"> — {item.blurb}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="card stack">
      <p className="muted">Step {Math.min(step + 1, 4)} of 4</p>
      {step === 0 ? (
        <>
          <h2>Knowledge</h2>
          <p className="muted">
            Upload a .txt or .md file first. We fill name, phone, intro, address, and hours from
            it so you can skip typing if they are already in the document.
          </p>
          <textarea
            rows={8}
            value={knowledgeText}
            onChange={(e) => setKnowledgeText(e.target.value)}
            placeholder="Or paste notes here, then extract."
            disabled={extracting}
          />
          <label className="dropzone">
            {extracting ? "Reading the file…" : "Drop a new .txt / .md file here"}
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
              {extracting ? "Extracting…" : "Extract details"}
            </button>
            <button type="button" onClick={() => setStep(1)} disabled={extracting}>
              Next
            </button>
          </div>
        </>
      ) : null}
      {step === 1 ? (
        <>
          <h2>Business</h2>
          <p className="muted">Review what we pulled from the file. Edit anything that is wrong or missing.</p>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Public phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label>
            Intro (what the agent should say it is)
            <textarea
              rows={4}
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              placeholder="We help local customers book a visit with the team."
            />
          </label>
          <label>
            Address (shown after a visit is requested)
            <input
              value={venueAddress}
              onChange={(e) => setVenueAddress(e.target.value)}
              placeholder="Street, city"
            />
          </label>
          <label>
            Opening hours (included when asking for a time)
            <input
              value={venueHours}
              onChange={(e) => setVenueHours(e.target.value)}
              placeholder="Sun–Thu 09:00–19:00"
            />
          </label>
          <label>
            Tentative booking message
            <textarea
              rows={5}
              value={bookingRequestTemplate}
              onChange={(e) => setBookingRequestTemplate(e.target.value)}
              placeholder={copyFor(chatLanguage === "he" ? "he" : "en").chat.bookingRequestTemplate}
            />
          </label>
          <label>
            Approved booking message
            <textarea
              rows={4}
              value={bookingApprovedTemplate}
              onChange={(e) => setBookingApprovedTemplate(e.target.value)}
              placeholder={copyFor(chatLanguage === "he" ? "he" : "en").chat.bookingApprovedTemplate}
            />
          </label>
          <label>
            Declined booking message
            <textarea
              rows={3}
              value={bookingRejectedTemplate}
              onChange={(e) => setBookingRejectedTemplate(e.target.value)}
              placeholder={copyFor(chatLanguage === "he" ? "he" : "en").chat.bookingRejected}
            />
          </label>
          <p className="muted">
            Leave templates empty to use the language defaults. Placeholders: {"{{slot}}"} {"{{address}}"}{" "}
            {"{{hours}}"} {"{{name}}"} {"{{phone}}"} {"{{email}}"} {"{{need}}"} {"{{kind}}"}
          </p>
          <label>
            Reset conversation after idle days
            <input
              type="number"
              min={0}
              max={365}
              value={idleResetDays}
              onChange={(e) => setIdleResetDays(Number(e.target.value))}
            />
          </label>
          <p className="muted">
            The first customer message always gets this intro (no AI). After a conversation is
            done, or after this many days of silence, the next message gets the intro again. 0 =
            do not reset on idle.
          </p>
          <div className="row-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep(0)}>
              Back
            </button>
            <button type="button" onClick={() => setStep(2)} disabled={!name.trim() || !intro.trim()}>
              Next
            </button>
          </div>
        </>
      ) : null}
      {step === 2 ? (
        <>
          <h2>Flow</h2>
          <fieldset>
            <legend>Catalog</legend>
            {catalogMeta.map((item) => (
              <label key={item.id} className="choice">
                <input
                  type="radio"
                  name="catalogId"
                  checked={catalogId === item.id}
                  onChange={() => setCatalogId(item.id)}
                />
                <span>
                  <strong>{item.title}</strong>
                  <span className="muted"> — {item.blurb}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {catalogId !== "faq" ? (
            <fieldset>
              <legend>What to collect for a visit</legend>
              <p className="muted">
                The agent asks only the checked items. WhatsApp already has their number — leave
                Phone unchecked unless you also want a typed number.
              </p>
              {bookingCollectMeta.map((item) => (
                <label key={item.id} className="choice">
                  <input
                    type="checkbox"
                    checked={bookingCollect.includes(item.id)}
                    disabled={item.locked}
                    onChange={() => {
                      if (item.locked) return;
                      setBookingCollect((prev) =>
                        prev.includes(item.id)
                          ? prev.filter((id) => id !== item.id)
                          : [...prev, item.id],
                      );
                    }}
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <span className="muted"> — {item.blurb}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <FlowMap flow={flow} />
          <div className="row-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
              Back
            </button>
            <button type="button" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      ) : null}
      {step === 3 ? (
        <>
          <h2>Done</h2>
          <p>The first message is always your intro. The next message is when the agent starts talking.</p>
          <button type="button" onClick={() => router.push("/demo")}>
            Open chat
          </button>
        </>
      ) : null}
      {error ? <p className="muted">{error}</p> : null}
      </div>
    </div>
  );
}
