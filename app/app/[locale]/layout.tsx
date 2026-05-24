import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { LocaleHtmlSync } from "@/components/LocaleHtmlSync";

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <LocaleHtmlSync locale={locale} />
      {children}
    </NextIntlClientProvider>
  );
}
