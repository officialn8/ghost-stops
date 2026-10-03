/**
 * Narrative System
 *
 * Journalism-grade storytelling backed by cited facts.
 */

// Archetypes. The narrative job (./generate) is server-only and deliberately not re-exported
// here (KTD21): components import this index.
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
  formatChange,
  formatCurrency,
  formatValue,
  formatValueWithUnit,
  formatTimeframe,
  getFactLabel,
  getTrendDirection,
} from "./formatters";

// Renderer
export { renderTemplate, renderNarrative } from "./renderer";
