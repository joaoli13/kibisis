"use client";

import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

const locales = ["pt", "en", "es"] as const;
const githubUrl = "https://github.com/joaoli13/kibisis";
const supportUrl = "https://www.buymeacoffee.com/joaoli13";
const twitterUrl = "https://x.com/joaoli13";
const projectLinks = [
  { href: "https://constitutionalmap.ai", label: "constitutionalmap.ai" },
  { href: "https://letterum.app", label: "letterum.app" }
] as const;

function localizedPath(pathname: string, locale: string) {
  const parts = pathname.split("/");
  if (locales.includes(parts[1] as (typeof locales)[number])) {
    parts[1] = locale;
    return parts.join("/") || `/${locale}`;
  }
  return `/${locale}`;
}

function navLinkClass(isActive: boolean) {
  return isActive ? "text-neutral-400" : "hover:text-[var(--accent)]";
}

export function TopBar() {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("nav");
  const atlasPath = `/${locale}`;
  const aboutPath = `/${locale}/about`;
  const brandPath = "/brand";

  return (
    <header className="col-span-full flex min-h-16 flex-wrap items-start justify-between gap-x-5 gap-y-2 border-b border-[var(--line)] bg-white px-4 py-2 sm:items-center">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2">
        <Link className="flex min-w-[176px] items-center gap-3" href={`/${locale}`} aria-label="kibisis home">
          <Image src="/brand/kibisis-mark.svg" alt="" width={34} height={34} priority />
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-semibold tracking-wide">kibisis.dev</span>
            <span className="text-xs text-neutral-500">{t("tagline")}</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-3 border-l border-[var(--line)] pl-4 text-sm text-neutral-600 md:flex">
          <Link className={navLinkClass(pathname === atlasPath)} href={atlasPath}>
            {t("atlas")}
          </Link>
          <Link className={navLinkClass(pathname === aboutPath)} href={aboutPath}>
            {t("about")}
          </Link>
          <Link className={navLinkClass(pathname === brandPath)} href={brandPath}>
            {t("brand")}
          </Link>
        </nav>
        <nav className="hidden items-center gap-2 border-l border-[var(--line)] pl-4 text-xs text-neutral-500 lg:flex">
          <span className="font-semibold uppercase tracking-wide">{t("projects")}</span>
          {projectLinks.map((link) => (
            <a
              className="rounded border border-[var(--line)] px-2 py-1 text-neutral-700 hover:border-[var(--accent)] hover:text-[var(--accent)]"
              href={link.href}
              key={link.href}
              rel="noreferrer"
              target="_blank"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 sm:w-auto sm:justify-end">
        <a
          className="rounded border border-[#c4593b] bg-[#c4593b] px-2 py-1 text-white hover:bg-[#a94731]"
          href={supportUrl}
          rel="noreferrer"
          target="_blank"
        >
          {t("support")}
        </a>
        <a className="rounded border border-[var(--line)] px-2 py-1 hover:border-[var(--accent)] hover:text-[var(--accent)]" href={githubUrl} rel="noreferrer" target="_blank">
          GitHub
        </a>
        <a className="rounded border border-[var(--line)] px-2 py-1 hover:border-[var(--accent)] hover:text-[var(--accent)]" href={twitterUrl} rel="noreferrer" target="_blank">
          Twitter
        </a>
        {locales.map((item) => (
          <Link
            className={`rounded border px-2 py-1 ${
              item === locale ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)]"
            }`}
            href={localizedPath(pathname, item)}
            key={item}
          >
            {item}
          </Link>
        ))}
      </div>
    </header>
  );
}
