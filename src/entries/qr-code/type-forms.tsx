"use client";

import { CheckboxField, SelectField, TextAreaField, TextField } from "./fields";
import type {
  CalendarValue,
  ContactValue,
  EmailValue,
  LocationValue,
  PhoneValue,
  SmsValue,
  TextValue,
  UrlValue,
  WifiValue,
} from "./types";
import type { ValidationErrors } from "./payload";

export type FormProps<T> = Readonly<{
  value: T;
  errors: ValidationErrors;
  touched: ReadonlySet<string>;
  onChange: (patch: Partial<T>) => void;
  onBlur: (field: string) => void;
}>;

function shown(errors: ValidationErrors, touched: ReadonlySet<string>, field: string): string | undefined {
  return touched.has(field) ? errors[field] : undefined;
}

export function UrlForm({ value, errors, touched, onChange, onBlur }: FormProps<UrlValue>) {
  return (
    <TextField
      id="qr-url"
      label="Web address"
      type="url"
      inputMode="url"
      value={value.url}
      onChange={(url) => onChange({ url })}
      onBlur={() => onBlur("url")}
      error={shown(errors, touched, "url")}
      placeholder="https://example.com"
      autoFocus
    />
  );
}

const WIFI_ENCRYPTION_OPTIONS = [
  { value: "WPA", label: "WPA/WPA2 (most home networks)" },
  { value: "WEP", label: "WEP" },
  { value: "nopass", label: "None (open network)" },
] as const;

export function WifiForm({ value, errors, touched, onChange, onBlur }: FormProps<WifiValue>) {
  return (
    <div className="grid gap-4">
      <TextField
        id="qr-wifi-ssid"
        label="Network name (SSID)"
        value={value.ssid}
        onChange={(ssid) => onChange({ ssid })}
        onBlur={() => onBlur("ssid")}
        error={shown(errors, touched, "ssid")}
        autoFocus
      />
      <SelectField
        id="qr-wifi-encryption"
        label="Security"
        value={value.encryption}
        onChange={(encryption) => onChange({ encryption: encryption as WifiValue["encryption"] })}
        options={WIFI_ENCRYPTION_OPTIONS}
      />
      {value.encryption !== "nopass" && (
        <TextField
          id="qr-wifi-password"
          label="Password"
          type="text"
          value={value.password}
          onChange={(password) => onChange({ password })}
          onBlur={() => onBlur("password")}
          error={shown(errors, touched, "password")}
          hint="Anyone who scans this code can read the password in plain text — QR codes are not encrypted."
        />
      )}
      <CheckboxField
        id="qr-wifi-hidden"
        label="Network is hidden"
        checked={value.hidden}
        onChange={(hidden) => onChange({ hidden })}
      />
      {value.hidden && <p className="text-sm text-muted">Hidden-network codes are not supported by every phone scanner. Test on the device that will join.</p>}
    </div>
  );
}

export function ContactForm({ value, errors, touched, onChange, onBlur }: FormProps<ContactValue>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        id="qr-contact-first"
        label="First name"
        value={value.firstName}
        onChange={(firstName) => onChange({ firstName })}
        onBlur={() => onBlur("firstName")}
        error={shown(errors, touched, "firstName")}
        autoFocus
      />
      <TextField
        id="qr-contact-last"
        label="Last name"
        value={value.lastName}
        onChange={(lastName) => onChange({ lastName })}
        onBlur={() => onBlur("lastName")}
      />
      <TextField
        id="qr-contact-org"
        label="Organisation (optional)"
        value={value.org}
        onChange={(org) => onChange({ org })}
      />
      <TextField
        id="qr-contact-phone"
        label="Phone (optional)"
        type="tel"
        inputMode="tel"
        value={value.phone}
        onChange={(phone) => onChange({ phone })}
        onBlur={() => onBlur("phone")}
        error={shown(errors, touched, "phone")}
      />
      <TextField
        id="qr-contact-job"
        label="Job title (optional)"
        value={value.jobTitle ?? ""}
        onChange={(jobTitle) => onChange({ jobTitle })}
      />
      <TextAreaField
        id="qr-contact-address"
        label="Address (optional)"
        value={value.address ?? ""}
        onChange={(address) => onChange({ address })}
      />
      <TextField
        id="qr-contact-email"
        label="Email (optional)"
        type="email"
        inputMode="email"
        value={value.email}
        onChange={(email) => onChange({ email })}
        onBlur={() => onBlur("email")}
        error={shown(errors, touched, "email")}
      />
      <TextField
        id="qr-contact-url"
        label="Website (optional)"
        type="url"
        inputMode="url"
        value={value.url}
        onChange={(url) => onChange({ url })}
        onBlur={() => onBlur("url")}
        error={shown(errors, touched, "url")}
        placeholder="https://example.com"
      />
    </div>
  );
}

export function EmailForm({ value, errors, touched, onChange, onBlur }: FormProps<EmailValue>) {
  return (
    <div className="grid gap-4">
      <TextField
        id="qr-email-to"
        label="Email address"
        type="email"
        inputMode="email"
        value={value.to}
        onChange={(to) => onChange({ to })}
        onBlur={() => onBlur("to")}
        error={shown(errors, touched, "to")}
        autoFocus
      />
      <TextField
        id="qr-email-subject"
        label="Subject (optional)"
        value={value.subject}
        onChange={(subject) => onChange({ subject })}
      />
      <TextAreaField
        id="qr-email-body"
        label="Body (optional)"
        value={value.body}
        onChange={(body) => onChange({ body })}
      />
    </div>
  );
}

export function PhoneForm({ value, errors, touched, onChange, onBlur }: FormProps<PhoneValue>) {
  return (
    <TextField
      id="qr-phone"
      label="Phone number"
      type="tel"
      inputMode="tel"
      value={value.phone}
      onChange={(phone) => onChange({ phone })}
      onBlur={() => onBlur("phone")}
      error={shown(errors, touched, "phone")}
      hint="Include a country code (e.g. +1 555 0100) for numbers that may be dialled from abroad."
      placeholder="+1 555 0100"
      autoFocus
    />
  );
}

export function SmsForm({ value, errors, touched, onChange, onBlur }: FormProps<SmsValue>) {
  return (
    <div className="grid gap-4">
      <TextField
        id="qr-sms-phone"
        label="Phone number"
        type="tel"
        inputMode="tel"
        value={value.phone}
        onChange={(phone) => onChange({ phone })}
        onBlur={() => onBlur("phone")}
        error={shown(errors, touched, "phone")}
        placeholder="+1 555 0100"
        autoFocus
      />
      <TextAreaField
        id="qr-sms-message"
        label="Message (optional)"
        value={value.message}
        onChange={(message) => onChange({ message })}
        hint="Uses the SMSTO: format to prepare a draft, not send it. Scanner and messaging-app support varies; test on your target device."
      />
    </div>
  );
}

export function LocationForm({ value, errors, touched, onChange, onBlur }: FormProps<LocationValue>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField
        id="qr-location-lat"
        label="Latitude"
        inputMode="decimal"
        value={value.latitude}
        onChange={(latitude) => onChange({ latitude })}
        onBlur={() => onBlur("latitude")}
        error={shown(errors, touched, "latitude")}
        placeholder="-37.8136"
        autoFocus
      />
      <TextField
        id="qr-location-lon"
        label="Longitude"
        inputMode="decimal"
        value={value.longitude}
        onChange={(longitude) => onChange({ longitude })}
        onBlur={() => onBlur("longitude")}
        error={shown(errors, touched, "longitude")}
        placeholder="144.9631"
      />
    </div>
  );
}

export function CalendarForm({ value, errors, touched, onChange, onBlur }: FormProps<CalendarValue>) {
  return (
    <div className="grid gap-4">
      <TextField
        id="qr-cal-title"
        label="Title"
        value={value.title}
        onChange={(title) => onChange({ title })}
        onBlur={() => onBlur("title")}
        error={shown(errors, touched, "title")}
        autoFocus
      />
      <CheckboxField
        id="qr-cal-allday"
        label="All-day event"
        checked={value.allDay}
        onChange={(allDay) => onChange({ allDay })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="qr-cal-start"
          label="Starts"
          type={value.allDay ? "date" : "datetime-local"}
          value={value.start}
          onChange={(start) => { onChange({ start }); onBlur("start"); }}
          onBlur={() => onBlur("start")}
          error={shown(errors, touched, "start")}
        />
        <TextField
          id="qr-cal-end"
          label="Ends"
          type={value.allDay ? "date" : "datetime-local"}
          value={value.end}
          onChange={(end) => { onChange({ end }); onBlur("end"); }}
          onBlur={() => onBlur("end")}
          error={shown(errors, touched, "end")}
        />
      </div>
      {!value.allDay && <p className="text-sm text-muted">Times are local wall-clock times on the phone importing the event, not a fixed timezone.</p>}
      <TextField
        id="qr-cal-location"
        label="Location (optional)"
        value={value.location}
        onChange={(location) => onChange({ location })}
      />
      <TextAreaField
        id="qr-cal-description"
        label="Description (optional)"
        value={value.description}
        onChange={(description) => onChange({ description })}
        hint="Calendar apps vary in how they import a scanned event — check the result before relying on it."
      />
    </div>
  );
}

export function TextForm({
  value,
  errors,
  touched,
  onChange,
  onBlur,
  onPaste,
}: FormProps<TextValue> & { onPaste?: (text: string) => void }) {
  return (
    <TextAreaField
      id="qr-text"
      label="Text"
      value={value.text}
      onChange={(text) => onChange({ text })}
      onBlur={() => onBlur("text")}
      error={shown(errors, touched, "text")}
      onPaste={onPaste}
      rows={5}
      autoFocus
    />
  );
}
