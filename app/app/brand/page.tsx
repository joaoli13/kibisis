import Image from "next/image";
import Link from "next/link";

const assets = [
  { name: "Mark", path: "/brand/kibisis-mark.svg" },
  { name: "Minimal mark", path: "/brand/kibisis-mark-minimal.svg" },
  { name: "Wordmark", path: "/brand/kibisis-wordmark.svg" },
  { name: "Lockup", path: "/brand/kibisis-lockup.svg" }
];

const palette = [
  { name: "Ink", value: "#1a1a1a" },
  { name: "Pomegranate", value: "#c4593b" },
  { name: "Aegean teal", value: "#3d746f" },
  { name: "Mist", value: "#f1f8f7" },
  { name: "Sea glass line", value: "#d3e5e2" }
];

export default function BrandPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--line)] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link className="flex items-center gap-3" href="/pt">
            <Image src="/brand/kibisis-mark.svg" alt="" width={34} height={34} priority />
            <span className="text-lg font-semibold">kibisis.dev</span>
          </Link>
          <Link className="text-sm text-neutral-600 hover:text-[var(--accent)]" href="/pt">
            Open atlas
          </Link>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#c4593b]">kibisis.dev</p>
            <h1 className="text-4xl font-semibold tracking-normal">A semantic pouch for the classical corpus.</h1>
          </div>
          <p className="max-w-2xl text-lg leading-8 text-neutral-700">
            Kibisis names the pouch carried by Perseus. The mark adapts that object into a compact research identity:
            a vessel for passages, authors, works, and semantic coordinates.
          </p>
        </div>
        <div className="flex items-center justify-center rounded border border-[var(--line)] bg-white p-8">
          <Image src="/brand/kibisis-lockup.svg" alt="kibisis lockup" width={520} height={160} priority />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-10">
        <h2 className="mb-4 text-xl font-semibold">Assets</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {assets.map((asset) => (
            <a
              className="rounded border border-[var(--line)] bg-white p-4 hover:border-[var(--accent)]"
              href={asset.path}
              key={asset.path}
            >
              <div className="mb-4 flex h-32 items-center justify-center bg-[var(--background)]">
                <Image src={asset.path} alt={asset.name} width={180} height={90} />
              </div>
              <div className="text-sm font-semibold">{asset.name}</div>
              <div className="mt-1 text-xs text-neutral-500">{asset.path}</div>
            </a>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-6 pb-14 lg:grid-cols-2">
        <div>
          <h2 className="mb-4 text-xl font-semibold">Palette</h2>
          <div className="grid gap-3">
            {palette.map((color) => (
              <div className="flex items-center justify-between rounded border border-[var(--line)] bg-white p-3" key={color.value}>
                <div className="flex items-center gap-3">
                  <span className="h-8 w-8 rounded border border-[var(--line)]" style={{ backgroundColor: color.value }} />
                  <span className="font-medium">{color.name}</span>
                </div>
                <code className="text-sm text-neutral-600">{color.value}</code>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="mb-4 text-xl font-semibold">Interface Use</h2>
          <div className="space-y-3 rounded border border-[var(--line)] bg-white p-5 text-sm leading-7 text-neutral-700">
            <p>Use the mark in compact navigation, favicon, and small touchpoints.</p>
            <p>Use the lockup for brand pages, repository headers, launch material, and documentation covers.</p>
            <p>Keep generous space around the pouch silhouette so the three internal points remain legible.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
