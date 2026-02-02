"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ExternalLink, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DataSourceInfo } from "@/types/narrative";

interface SourcesCitationProps {
  sources: DataSourceInfo[];
  defaultExpanded?: boolean;
  className?: string;
}

export default function SourcesCitation({
  sources,
  defaultExpanded = false,
  className,
}: SourcesCitationProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const formatDate = (value?: string) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  if (!sources || sources.length === 0) {
    return null;
  }

  return (
    <div className={cn("", className)}>
      {/* Header button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full py-2 text-ui-xs text-text-tertiary hover:text-text-secondary transition-colors"
      >
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5" />
          <span>Sources ({sources.length})</span>
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="w-4 h-4" />
        </motion.div>
      </button>

      {/* Expanded content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <ul className="space-y-2 pt-2 pb-1">
              {sources.map((source) => (
                <li key={source.code}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 text-ui-xs text-text-secondary hover:text-brandIndigo transition-colors group"
                  >
                    <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-50 group-hover:opacity-100" />
                    <div>
                      <span className="block font-medium">{source.name}</span>
                      {source.status && (
                        <span className="block text-text-tertiary text-[10px] uppercase tracking-[0.08em]">
                          Status: {source.status}
                        </span>
                      )}
                      {source.license && (
                        <span className="block text-text-tertiary text-[10px]">
                          {source.license}
                        </span>
                      )}
                      {(source.refreshCadence || source.lastSuccessfulFetch) && (
                        <span className="block text-text-tertiary text-[10px]">
                          {source.refreshCadence
                            ? `Refresh: ${source.refreshCadence}`
                            : "Refresh: unknown"}
                          {formatDate(source.lastSuccessfulFetch)
                            ? ` · Updated ${formatDate(source.lastSuccessfulFetch)}`
                            : ""}
                        </span>
                      )}
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
