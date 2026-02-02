"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import FactCard from "./FactCard";
import SourcesCitation from "./SourcesCitation";
import type {
  StationNarrativeData,
  FactMap,
  DataSourceInfo,
  FactKey,
} from "@/types/narrative";

interface StationStoryProps {
  narrative: StationNarrativeData;
  facts: FactMap | null;
  sources: DataSourceInfo[] | null;
  className?: string;
}

export default function StationStory({
  narrative,
  facts,
  sources,
  className,
}: StationStoryProps) {
  const [showEvidence, setShowEvidence] = useState(false);
  const qualityLabel =
    narrative.quality === "HIGH"
      ? "High"
      : narrative.quality === "MEDIUM"
      ? "Medium"
      : narrative.quality === "LOW"
      ? "Low"
      : "Unknown";
  const qualityClass =
    narrative.quality === "HIGH"
      ? "text-emerald-400/90 bg-emerald-500/10 border-emerald-500/20"
      : narrative.quality === "MEDIUM"
      ? "text-amber-300/90 bg-amber-500/10 border-amber-500/20"
      : narrative.quality === "LOW"
      ? "text-rose-300/90 bg-rose-500/10 border-rose-500/20"
      : "text-text-tertiary bg-white/5 border-white/10";

  // Get the facts that are used as evidence
  const evidenceFacts = narrative.evidenceFactKeys
    .filter((key) => facts && facts[key as FactKey])
    .map((key) => ({
      key,
      fact: facts![key as FactKey]!,
    }));

  return (
    <div className={cn("glass-solid rounded-ui p-5", className)}>
      {/* Archetype badge */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
          <span className="text-lg">{narrative.archetype.emoji}</span>
        </div>
        <div>
          <h3 className="font-display font-semibold text-ui-md">
            {narrative.archetype.title}
          </h3>
          <div className="flex items-center gap-2 text-ui-xs text-text-tertiary">
            <span>{Math.round(narrative.confidence * 100)}% confidence</span>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]",
                qualityClass
              )}
            >
              {qualityLabel} quality
            </span>
          </div>
          {narrative.qualityNote && (
            <div className="text-ui-xs text-text-tertiary/80 mt-1">
              {narrative.qualityNote}
            </div>
          )}
        </div>
      </div>

      {/* Rendered story */}
      <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none mb-4">
        {narrative.story.split("\n\n").map((paragraph, i) => (
          <p
            key={i}
            className="text-ui-sm text-text-secondary leading-relaxed mb-3 last:mb-0"
            dangerouslySetInnerHTML={{
              __html: paragraph
                .replace(/\*\*(.*?)\*\*/g, '<strong class="text-text-primary">$1</strong>')
                .replace(/\*(.*?)\*/g, "<em>$1</em>"),
            }}
          />
        ))}
      </div>

      {/* Evidence section */}
      {evidenceFacts.length > 0 && (
        <div className="border-t border-white/10 pt-4 mt-4">
          <button
            onClick={() => setShowEvidence(!showEvidence)}
            className="flex items-center justify-between w-full text-ui-xs text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Evidence ({evidenceFacts.length} facts)</span>
            </div>
            <motion.div
              animate={{ rotate: showEvidence ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="w-4 h-4" />
            </motion.div>
          </button>

          <AnimatePresence initial={false}>
            {showEvidence && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                  {evidenceFacts.map(({ key, fact }) => (
                    <FactCard key={key} factKey={key} fact={fact} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Sources */}
      {sources && sources.length > 0 && (
        <div className="border-t border-white/10 pt-2 mt-4">
          <SourcesCitation sources={sources} />
        </div>
      )}
    </div>
  );
}
