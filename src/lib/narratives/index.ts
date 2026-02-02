/**
 * Narrative System
 *
 * Journalism-grade storytelling backed by cited facts.
 */

// Archetypes
export {
  ARCHETYPES,
  ARCHETYPE_TITLES,
  ARCHETYPE_EMOJIS,
  findBestArchetype,
  getArchetypeInfo,
} from "./archetypes";

// Formatters
export {
  formatNumber,
  formatPercent,
  formatPercentChange,
  formatCurrency,
  formatValue,
  formatValueWithUnit,
  formatTimeframe,
  getFactLabel,
  getTrendDirection,
} from "./formatters";

// Renderer
export { renderTemplate, renderNarrative } from "./renderer";
