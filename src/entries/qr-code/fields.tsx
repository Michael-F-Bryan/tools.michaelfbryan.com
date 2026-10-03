"use client";

import { type ChangeEvent, type ReactNode } from "react";

import { CHECKBOX_INPUT, CHECKBOX_ROW, FIELD_ERROR, FIELD_HINT, FIELD_LABEL, fieldClass } from "./controls";

function FieldShell({
  id,
  label,
  hint,
  error,
  children,
}: Readonly<{ id: string; label: string; hint?: string; error?: string; children: ReactNode }>) {
  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className={FIELD_ERROR} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className={FIELD_HINT}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type SharedProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  autoFocus?: boolean;
};

export type TextFieldProps = SharedProps & {
  type?: "text" | "email" | "tel" | "url" | "date" | "datetime-local" | "search";
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "url" | "search";
  onPaste?: (text: string) => void;
};

export function TextField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  type = "text",
  inputMode,
  placeholder,
  autoFocus,
  onPaste,
}: TextFieldProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        onPaste={
          onPaste
            ? (event) => {
                const text = event.clipboardData.getData("text");
                if (text) setTimeout(() => onPaste(text), 0);
              }
            : undefined
        }
        onBlur={onBlur}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={fieldClass(Boolean(error))}
      />
    </FieldShell>
  );
}

export type TextAreaFieldProps = SharedProps & { rows?: number; onPaste?: (text: string) => void };

export function TextAreaField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  placeholder,
  autoFocus,
  rows = 3,
  onPaste,
}: TextAreaFieldProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        onPaste={
          onPaste
            ? (event) => {
                const text = event.clipboardData.getData("text");
                if (text) setTimeout(() => onPaste(text), 0);
              }
            : undefined
        }
        onBlur={onBlur}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={fieldClass(Boolean(error))}
      />
    </FieldShell>
  );
}

export type SelectFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  hint?: string;
};

export function SelectField({ id, label, value, onChange, options, hint }: SelectFieldProps) {
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={fieldClass(false)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function CheckboxField({
  id,
  label,
  checked,
  onChange,
}: Readonly<{ id: string; label: string; checked: boolean; onChange: (checked: boolean) => void }>) {
  return (
    <div className={CHECKBOX_ROW}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={CHECKBOX_INPUT}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
