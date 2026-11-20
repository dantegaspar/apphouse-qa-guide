import type { Metadata } from "next";
import { MAX_UPLOAD_MB } from "@/lib/http";
import CourierSurvey from "@/components/courier/CourierSurvey";

export const metadata: Metadata = { title: "AppHouse · Encuesta para repartidores" };

export default function RepartidorPage() {
  return <CourierSurvey maxUploadMb={MAX_UPLOAD_MB} />;
}
