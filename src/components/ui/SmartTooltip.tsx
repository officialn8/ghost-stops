"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface SmartTooltipProps {
  trigger: React.ReactNode;
  content: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

const TOOLTIP_WIDTH = 256;
const VIEWPORT_PADDING = 12;
const CLOSE_DELAY = 100; // ms to wait before closing, allows mouse to move to tooltip

export default function SmartTooltip({
  trigger,
  content,
  className,
  contentClassName,
}: SmartTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    placement: "above" | "below";
  } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const estimatedContentHeight = 150;

    // Check space below vs above
    const spaceBelow = viewportHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;

    const placement = spaceBelow >= estimatedContentHeight || spaceBelow >= spaceAbove
      ? "below"
      : "above";

    const top = placement === "below"
      ? triggerRect.bottom + 8
      : triggerRect.top - 8;

    // Calculate horizontal position - find ideal centered position, then clamp to viewport
    const triggerCenterX = triggerRect.left + triggerRect.width / 2;
    const idealLeft = triggerCenterX - TOOLTIP_WIDTH / 2;

    // Clamp to keep tooltip within viewport with padding
    const minLeft = VIEWPORT_PADDING;
    const maxLeft = viewportWidth - TOOLTIP_WIDTH - VIEWPORT_PADDING;
    const left = Math.max(minLeft, Math.min(idealLeft, maxLeft));

    setPosition({ top, left, placement });
  }, []);

  // Adjust position after content renders (for "above" placement)
  useEffect(() => {
    if (isOpen && position?.placement === "above" && contentRef.current && triggerRef.current) {
      const contentHeight = contentRef.current.offsetHeight;
      const triggerRect = triggerRef.current.getBoundingClientRect();
      // Position above the trigger
      setPosition(prev => prev ? {
        ...prev,
        top: triggerRect.top - contentHeight - 8,
      } : null);
    }
  }, [isOpen, position?.placement]);

  const cancelClose = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const handleOpen = useCallback(() => {
    cancelClose();
    calculatePosition();
    setIsOpen(true);
  }, [cancelClose, calculatePosition]);

  const handleDelayedClose = useCallback(() => {
    cancelClose();
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, CLOSE_DELAY);
  }, [cancelClose]);

  const handleTooltipMouseEnter = useCallback(() => {
    cancelClose();
  }, [cancelClose]);

  const handleTooltipMouseLeave = useCallback(() => {
    handleDelayedClose();
  }, [handleDelayedClose]);

  // Close on scroll or resize
  useEffect(() => {
    if (!isOpen) return;

    const handleScrollOrResize = () => {
      cancelClose();
      setIsOpen(false);
    };

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [isOpen, cancelClose]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        contentRef.current &&
        !contentRef.current.contains(e.target as Node)
      ) {
        cancelClose();
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, cancelClose]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelClose();
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, cancelClose]);

  const tooltipContent = (
    <AnimatePresence>
      {isOpen && position && (
        <motion.div
          ref={contentRef}
          initial={{ opacity: 0, y: position.placement === "below" ? -4 : 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: position.placement === "below" ? -4 : 4 }}
          transition={{ duration: 0.15 }}
          className={cn(
            "fixed z-[100] w-64",
            contentClassName
          )}
          style={{
            top: position.top,
            left: position.left,
          }}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        >
          <div className="glass-panel rounded-ui p-3 text-ui-xs shadow-xl border border-white/10">
            {content}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <div
        ref={triggerRef}
        className={cn("inline-flex", className)}
        onClick={handleOpen}
        onMouseEnter={handleOpen}
        onMouseLeave={handleDelayedClose}
      >
        {trigger}
      </div>
      {mounted && createPortal(tooltipContent, document.body)}
    </>
  );
}
