import { notFound } from "next/navigation";
import { getGuide } from "@/lib/guides";
import { MAX_UPLOAD_MB } from "@/lib/http";
import GuideVariantPicker from "@/components/tester/GuideVariantPicker";

export default async function GuidePage({ params }: { params: Promise<{ guideId: string }> }) {
  const { guideId } = await params;
  const guide = getGuide(guideId);
  if (!guide) notFound();
  // Guía con variante para celular (otra guía): se elige en el navegador según el dispositivo
  const mobileGuide = guide.mobileGuideId ? getGuide(guide.mobileGuideId) : undefined;
  return <GuideVariantPicker guide={guide} mobileGuide={mobileGuide} maxUploadMb={MAX_UPLOAD_MB} />;
}
