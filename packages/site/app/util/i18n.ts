import type { Resource } from "i18next";

import i18n_ar from "../i18n/ar.json";
import i18n_de from "../i18n/de.json";
import i18n_en_gb from "../i18n/en-GB.json";
import i18n_en from "../i18n/en.json";
import i18n_es from "../i18n/es.json";
import i18n_fr from "../i18n/fr.json";
import i18n_it from "../i18n/it.json";
import i18n_nl from "../i18n/nl.json";
import i18n_sv from "../i18n/sv.json";
import i18n_zh from "../i18n/zh.json";

export const resources = {
  en: { translation: i18n_en },
  "en-GB": { translation: i18n_en_gb },
  zh: { translation: i18n_zh },
  ar: { translation: i18n_ar },
  nl: { translation: i18n_nl },
  de: { translation: i18n_de },
  it: { translation: i18n_it },
  es: { translation: i18n_es },
  sv: { translation: i18n_sv },
  fr: { translation: i18n_fr },
} satisfies Resource;

export type i18nResources = typeof resources;
