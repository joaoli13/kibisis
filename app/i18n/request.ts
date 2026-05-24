import { getRequestConfig } from "next-intl/server";

const locales = ["en", "pt", "es"] as const;
type Locale = (typeof locales)[number];

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = locales.includes(requested as Locale) ? (requested as Locale) : "pt";
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});
