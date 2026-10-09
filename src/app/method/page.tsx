import type { Metadata } from "next";
import { MethodPage } from "@/components/method/MethodPage";
import { readStationList } from "@/lib/stations/list";

export const metadata: Metadata = {
  // The root layout's template appends "· Ghost Stops".
  title: "How the Ghost score works",
  description:
    "What each figure in the Ghost Stops ledger means, how the Ghost score is built from four parts, which stations are ranked, where the ridership comes from, and how to fetch it.",
  alternates: { canonical: "/method" },
};

// The list is cached under the stations tag; the page renders from it per request, never at build time.
export const dynamic = "force-dynamic";

/** The method, taught from a live row of the ledger: a reading page outside the shell. */
export default async function Method() {
  const list = await readStationList();
  return <MethodPage list={list} />;
}
