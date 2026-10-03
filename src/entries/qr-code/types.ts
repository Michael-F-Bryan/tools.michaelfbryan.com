export type QrType =
  | "url"
  | "wifi"
  | "contact"
  | "email"
  | "phone"
  | "sms"
  | "location"
  | "calendar"
  | "text";

export type UrlValue = { url: string };

export type WifiEncryption = "WPA" | "WEP" | "nopass";

export type WifiValue = {
  ssid: string;
  password: string;
  encryption: WifiEncryption;
  hidden: boolean;
};

export type ContactValue = {
  firstName: string;
  lastName: string;
  org: string;
  jobTitle?: string;
  address?: string;
  phone: string;
  email: string;
  url: string;
};

export type EmailValue = { to: string; subject: string; body: string };

export type PhoneValue = { phone: string };

export type SmsValue = { phone: string; message: string };

export type LocationValue = { latitude: string; longitude: string };

export type CalendarValue = {
  title: string;
  location: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
};

export type TextValue = { text: string };

export type QrValues = {
  url: UrlValue;
  wifi: WifiValue;
  contact: ContactValue;
  email: EmailValue;
  phone: PhoneValue;
  sms: SmsValue;
  location: LocationValue;
  calendar: CalendarValue;
  text: TextValue;
};

export const QR_TYPE_LABELS: Record<QrType, string> = {
  url: "Link",
  wifi: "Wi-Fi",
  contact: "Contact",
  email: "Email",
  phone: "Phone",
  sms: "Text message",
  location: "Location",
  calendar: "Calendar event",
  text: "Raw text",
};

export const QR_TYPE_ORDER: readonly QrType[] = [
  "url",
  "wifi",
  "contact",
  "email",
  "phone",
  "sms",
  "location",
  "calendar",
  "text",
];

export function defaultValues(): QrValues {
  return {
    url: { url: "" },
    wifi: { ssid: "", password: "", encryption: "WPA", hidden: false },
    contact: { firstName: "", lastName: "", org: "", jobTitle: "", address: "", phone: "", email: "", url: "" },
    email: { to: "", subject: "", body: "" },
    phone: { phone: "" },
    sms: { phone: "", message: "" },
    location: { latitude: "", longitude: "" },
    calendar: { title: "", location: "", description: "", start: "", end: "", allDay: false },
    text: { text: "" },
  };
}
