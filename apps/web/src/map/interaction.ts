/** What a map click means, given which state is open and which was clicked. */
export type ClickIntent =
  | { kind: "open-state"; fips: string }
  | { kind: "load-tile" }
  | { kind: "none" };

export function resolveClick(
  selectedFips: string | null,
  clickedFips: string | null,
): ClickIntent {
  if (clickedFips === null) return { kind: "none" };
  if (clickedFips === selectedFips) return { kind: "load-tile" };
  return { kind: "open-state", fips: clickedFips };
}
