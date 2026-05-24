import createMiddleware from "next-intl/middleware";

const locales = ["en", "pt", "es"] as const;
type Locale = (typeof locales)[number];

function defaultLocale(): Locale {
  const configured = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
  return locales.includes(configured as Locale) ? (configured as Locale) : "pt";
}

export default createMiddleware({
  locales,
  defaultLocale: defaultLocale()
});

export const config = {
  matcher: ["/", "/(pt|en|es)/:path*"]
};

