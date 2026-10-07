/** Side gutter shared by the header, the cards and the composer. */
export const RECIPE_SCREEN_SIDE_PADDING = 14;

export const RECIPE_HEADER_HEIGHT = 45;
/** Keeps the header off the top edge on devices that report no top inset. */
export const RECIPE_HEADER_MIN_TOP = 16;
/**
 * The scroll viewport starts at the bottom edge of the header and fades in over this distance, so
 * content melts away before it reaches the header instead of being cut by a hard edge.
 */
export const RECIPE_HEADER_FADE_SIZE = 12;
/** Space between the end of the header fade and the first card at rest; room for its shadow. */
export const RECIPE_CONTENT_TOP_PADDING = 8;
export const RECIPE_SECTION_GAP = 14;

/** Gap between the bottom safe-area inset and the composer; this route has no tab bar. */
export const RECIPE_COMPOSER_BOTTOM_GAP = 14;
/** How far the bottom fade reaches above the composer. */
export const RECIPE_BOTTOM_FADE_REACH = 30;
