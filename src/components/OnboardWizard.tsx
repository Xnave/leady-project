"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FlowMap } from "@/components/FlowMap";
import { catalogMeta, flowForCatalog, isCatalogId, type CatalogId } from "@/lib/flow/catalog";
import { chatLanguageMeta, isChatLanguage, looksHebrew, type ChatLanguage } from "@/lib/flow/locale";

type Props = {
  name: string;
  phone: string;
  intro: string;
  knowledgeText: string;
  catalogId: string;
  chatLanguage: string;
  idleResetDays: number;
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
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const flow = useMemo(() => flowForCatalog(catalogId), [catalogId]);

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
    setError("");
    setKnowledgeText((prev) => [prev.trim(), ...chunks].filter(Boolean).join("\n\n"));
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
          <h2>Business</h2>
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
              placeholder="We design and install kitchens in Tel Aviv."
            />
          </label>
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
          <button type="button" onClick={() => setStep(1)} disabled={!name.trim() || !intro.trim()}>
            Next
          </button>
        </>
      ) : null}
      {step === 1 ? (
        <>
          <h2>Knowledge</h2>
          <p className="muted">Paste notes or drop .txt / .md files. They are stored as text on this tenant.</p>
          <textarea
            rows={8}
            value={knowledgeText}
            onChange={(e) => setKnowledgeText(e.target.value)}
          />
          <label className="dropzone">
            Drop files here
            <input
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              multiple
              onChange={(e) => onDrop(e.target.files)}
            />
          </label>
          <div className="row-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep(0)}>
              Back
            </button>
            <button type="button" onClick={() => setStep(2)}>
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
