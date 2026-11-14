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

/** Zooming this far past the national framing opens the state in focus. */
export const FOCUS_ZOOM_DELTA = 1;
/** Zooming this far out from an open state's framing returns to the national view. */
export const UNFOCUS_ZOOM_DELTA = 1;

export type ZoomIntent = { kind: "focus" } | { kind: "unfocus" } | { kind: "none" };

/**
 * What a user zoom means. `stateZoom` is the zoom that frames the open state,
 * or null in the national view; `nationalZoom` frames the whole of CONUS.
 */
export function resolveZoom(
  zoom: number,
  nationalZoom: number,
  stateZoom: number | null,
): ZoomIntent {
  if (stateZoom === null) {
    return zoom >= nationalZoom + FOCUS_ZOOM_DELTA ? { kind: "focus" } : { kind: "none" };
  }
  return zoom <= stateZoom - UNFOCUS_ZOOM_DELTA ? { kind: "unfocus" } : { kind: "none" };
}
