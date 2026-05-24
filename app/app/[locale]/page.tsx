import { getTranslations } from "next-intl/server";
import { AtlasWorkspace } from "@/components/AtlasWorkspace";
import { provenance } from "@/lib/provenance";

export default async function AtlasPage() {
  const t = await getTranslations("provenance");
  const meta = provenance();
  const footer = {
    datasetSnapshotLabel: t("datasetSnapshot"),
    datasetSnapshotValue: meta.dataset_snapshot ?? t("notExported"),
    license: meta.license,
    source: meta.source,
    sourceLabel: t("source"),
    sourceUrl: meta.source_url
  };
  return <AtlasWorkspace footer={footer} />;
}
