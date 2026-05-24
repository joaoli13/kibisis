import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { TopBar } from "@/components/TopBar";
import { provenance } from "@/lib/provenance";

const sectionKeys = ["what", "vectors", "name", "sources", "ai", "cite", "press", "contact"] as const;
const githubUrl = "https://github.com/joaoli13/kibisis";

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("about");
  const provenanceT = await getTranslations("provenance");
  const meta = provenance();

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <TopBar />

      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-[#c4593b]">{t("eyebrow")}</p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-normal">{t("title")}</h1>
          <p className="max-w-2xl text-lg leading-8 text-neutral-700">{t("summary")}</p>
          <div className="flex flex-wrap gap-3">
            <Link className="border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" href={`/${locale}`}>
              {t("openAtlas")}
            </Link>
            <Link className="border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-neutral-700" href="/brand">
              {t("brandAssets")}
            </Link>
            <a
              className="border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-neutral-700"
              href={githubUrl}
              rel="noreferrer"
              target="_blank"
            >
              GitHub
            </a>
          </div>
        </div>
        <aside className="border border-[var(--line)] bg-white p-5">
          <div className="mb-4 flex items-center gap-3">
            <Image src="/brand/kibisis-lockup.svg" alt="kibisis.dev" width={260} height={80} priority />
          </div>
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{provenanceT("source")}</dt>
              <dd className="mt-1">
                <a className="text-[var(--accent)] underline" href={meta.source_url} rel="noreferrer" target="_blank">
                  {meta.source}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">License</dt>
              <dd className="mt-1 text-neutral-800">{meta.license}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{provenanceT("datasetSnapshot")}</dt>
              <dd className="mt-1 text-neutral-800">{meta.dataset_snapshot ?? provenanceT("notExported")}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-14 md:grid-cols-2">
        {sectionKeys.map((key) => (
          <article className="border border-[var(--line)] bg-white p-5" key={key}>
            <h2 className="text-lg font-semibold">{t(`sections.${key}.title`)}</h2>
            <p className="mt-3 text-sm leading-7 text-neutral-700">{t(`sections.${key}.body`)}</p>
          </article>
        ))}
      </section>

      <footer className="border-t border-[var(--line)] px-6 py-4 text-xs text-neutral-600">
        <div className="mx-auto max-w-6xl">
          {provenanceT("source")}:{" "}
          <a className="text-[var(--accent)] underline" href={meta.source_url} rel="noreferrer" target="_blank">
            {meta.source}
          </a>{" "}
          - {meta.license} - {provenanceT("datasetSnapshot")}: {meta.dataset_snapshot ?? provenanceT("notExported")}
        </div>
      </footer>
    </main>
  );
}
