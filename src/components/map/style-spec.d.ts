/**
 * The parts of the Mapbox style specification bundled with mapbox-gl that the map tests use to
 * validate the layers in layers.ts and evaluate their expressions. mapbox-gl ships this module
 * without a declaration file at its importable path.
 */
declare module "mapbox-gl/dist/style-spec/index.es.js" {
  interface EvaluationFeature {
    type: "Point" | "LineString" | "Polygon" | 1 | 2 | 3;
    properties: object;
    id?: string | number;
  }

  interface PropertyExpression {
    kind: "constant" | "source" | "camera" | "composite";
    evaluate(globals: { zoom: number }, feature?: EvaluationFeature, featureState?: Record<string, unknown>): unknown;
  }

  type ParseResult =
    | { result: "success"; value: PropertyExpression }
    | { result: "error"; value: { message: string }[] };

  export const expression: {
    createPropertyExpression(value: unknown, propertySpec: unknown): ParseResult;
  };

  export function featureFilter(filter: unknown): {
    filter(globals: { zoom: number }, feature: EvaluationFeature): boolean;
  };

  export function validate(style: unknown): { message: string }[];

  /** The style reference: `paint_circle`, `layout_symbol`, and so on, keyed by property. */
  export const latest: Record<string, Record<string, unknown>>;
}
