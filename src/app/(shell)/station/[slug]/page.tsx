import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { StationDossier } from "@/components/dossier/StationDossier";
import { SITE_NAME } from "@/lib/site";
import { stationDescription, stationTitle } from "@/lib/stations/metadata";
import { getStationDetail } from "./data";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const result = await getStationDetail(slug);
  if (result.kind !== "found") return {};
  const title = stationTitle(result.detail);
  const description = stationDescription(result.detail);
  return {
    // The root layout's template appends "· Ghost Stops".
    title,
    description,
    alternates: { canonical: `/station/${result.detail.station.slug ?? slug}` },
    openGraph: { title: `${title} · ${SITE_NAME}`, description, type: "article" },
  };
}

/**
 * A station's dossier (R21): on desktop widths the shell layout shows it in the drawer beside the
 * map, on a phone as a page below the shared map. A retired slug redirects permanently (R8).
 */
export default async function StationPage({ params }: { params: Params }) {
  const { slug } = await params;
  const result = await getStationDetail(slug);
  if (result.kind === "redirect") permanentRedirect(`/station/${result.slug}`);
  if (result.kind === "not-found") notFound();
  // The dossier reads `series`; the v1 `ridershipSeries` (kept in the API until U23) would only
  // add a quarter to the payload the page sends to the browser.
  return <StationDossier key={slug} detail={{ ...result.detail, ridershipSeries: [] }} />;
}
