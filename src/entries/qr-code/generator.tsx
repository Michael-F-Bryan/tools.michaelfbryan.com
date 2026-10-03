"use client";

import { useMemo, useState, type ReactNode } from "react";

import { FIELD_LABEL, LINK_BUTTON, SECONDARY_BUTTON } from "./controls";
import { detectPastedStructuredContent, evaluate } from "./payload";
import { DEFAULT_APPEARANCE, PreviewPanel, type Appearance } from "./preview-panel";
import {
  CalendarForm,
  ContactForm,
  EmailForm,
  LocationForm,
  PhoneForm,
  SmsForm,
  TextForm,
  UrlForm,
  WifiForm,
} from "./type-forms";
import { QR_TYPE_LABELS, QR_TYPE_ORDER, defaultValues, type QrType, type QrValues } from "./types";

function emptyTouched(): Record<QrType, Set<string>> {
  return Object.fromEntries(QR_TYPE_ORDER.map((t) => [t, new Set<string>()])) as Record<QrType, Set<string>>;
}

type PasteBanner = { kind: "vcard" | "url"; message: string; apply: () => void };

export function Generator() {
  const [type, setType] = useState<QrType>("url");
  const [values, setValues] = useState<QrValues>(defaultValues);
  const [touched, setTouched] = useState<Record<QrType, Set<string>>>(emptyTouched);
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [pasteBanner, setPasteBanner] = useState<PasteBanner | null>(null);

  const outcome = useMemo(() => evaluate(type, values), [type, values]);
  const errors = outcome.errors;
  const touchedForType = touched[type];

  function patch<T extends QrType>(target: T, partial: Partial<QrValues[T]>) {
    setValues((prev) => ({ ...prev, [target]: { ...prev[target], ...partial } }));
  }

  function blur(field: string) {
    setTouched((prev) => {
      const next = new Set(prev[type]);
      next.add(field);
      return { ...prev, [type]: next };
    });
  }

  function handleTypeChange(next: QrType) {
    setType(next);
    setPasteBanner(null);
  }

  function handleRawPaste(text: string) {
    const suggestion = detectPastedStructuredContent(text);
    if (!suggestion) {
      setPasteBanner(null);
      return;
    }
    if (suggestion.type === "vcard") {
      setPasteBanner({
        kind: "vcard",
        message: "This looks like a contact card (vCard). Switching imports the basic fields only; keep Raw text to preserve the complete card.",
        apply: () => {
          setValues((prev) => ({ ...prev, contact: { ...defaultValues().contact, ...suggestion.parsed } }));
          setType("contact");
          setPasteBanner(null);
        },
      });
    } else {
      setPasteBanner({
        kind: "url",
        message: "This looks like a web address.",
        apply: () => {
          setValues((prev) => ({ ...prev, url: { url: suggestion.url } }));
          setType("url");
          setPasteBanner(null);
        },
      });
    }
  }

  let form: ReactNode;
  switch (type) {
    case "url":
      form = <UrlForm value={values.url} errors={errors} touched={touchedForType} onChange={(p) => patch("url", p)} onBlur={blur} />;
      break;
    case "wifi":
      form = <WifiForm value={values.wifi} errors={errors} touched={touchedForType} onChange={(p) => patch("wifi", p)} onBlur={blur} />;
      break;
    case "contact":
      form = (
        <ContactForm value={values.contact} errors={errors} touched={touchedForType} onChange={(p) => patch("contact", p)} onBlur={blur} />
      );
      break;
    case "email":
      form = <EmailForm value={values.email} errors={errors} touched={touchedForType} onChange={(p) => patch("email", p)} onBlur={blur} />;
      break;
    case "phone":
      form = <PhoneForm value={values.phone} errors={errors} touched={touchedForType} onChange={(p) => patch("phone", p)} onBlur={blur} />;
      break;
    case "sms":
      form = <SmsForm value={values.sms} errors={errors} touched={touchedForType} onChange={(p) => patch("sms", p)} onBlur={blur} />;
      break;
    case "location":
      form = (
        <LocationForm value={values.location} errors={errors} touched={touchedForType} onChange={(p) => patch("location", p)} onBlur={blur} />
      );
      break;
    case "calendar":
      form = (
        <CalendarForm value={values.calendar} errors={errors} touched={touchedForType} onChange={(p) => patch("calendar", p)} onBlur={blur} />
      );
      break;
    case "text":
      form = (
        <TextForm
          value={values.text}
          errors={errors}
          touched={touchedForType}
          onChange={(p) => patch("text", p)}
          onBlur={blur}
          onPaste={handleRawPaste}
        />
      );
      break;
  }

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_22rem] md:items-start lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <label htmlFor="qr-type" className={FIELD_LABEL}>
              QR code type
            </label>
            <select
              id="qr-type"
              value={type}
              onChange={(event) => handleTypeChange(event.target.value as QrType)}
              className="mt-1 block min-h-11 border border-rule bg-surface px-3 text-base sm:min-h-0 sm:py-1.5 sm:text-sm"
            >
              {QR_TYPE_ORDER.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {QR_TYPE_LABELS[candidate]}
                </option>
              ))}
            </select>
          </div>
          <a href="#qr-preview" className={LINK_BUTTON}>
            View code ↓
          </a>
        </div>

        {pasteBanner && (
          <div
            role="status"
            className="mt-4 flex flex-wrap items-center gap-3 border border-accent bg-accent/5 px-4 py-3 text-sm text-ink"
          >
            <span>{pasteBanner.message}</span>
            <button type="button" className={SECONDARY_BUTTON} onClick={pasteBanner.apply}>
              Switch to {pasteBanner.kind === "vcard" ? "Contact" : "Link"}
            </button>
            <button type="button" className={LINK_BUTTON} onClick={() => setPasteBanner(null)}>
              Dismiss
            </button>
          </div>
        )}

        <div className="mt-6">{form}</div>
      </div>

      <PreviewPanel type={type} build={outcome.build} appearance={appearance} onAppearanceChange={setAppearance} />
    </div>
  );
}
