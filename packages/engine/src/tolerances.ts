/** Every layout tolerance the engine uses, in one place. Heights are token heights in points. */
export const TOLERANCES = {
  /** A token joins a line when its centre is within this × the smaller height of the line centre. */
  lineCentre: 0.45,
  /** Tokens on a line join one phrase when the gap is at most this × height (about one space). */
  phraseGap: 0.35,
  /** `until-gap` stops at a gap wider than this × height (about two spaces). */
  untilGap: 0.9,
  /** `right` candidates may start this many points left of the anchor's right edge. */
  rightSlack: 1,
  /** `below`/`above` widen the anchor's horizontal span by this many points each side. */
  verticalWiden: 20,
  /** Default search distance for `right`/`left`, in points. */
  maxDistance: 250,
  /** Default number of lines searched for `below`/`above`. */
  maxLines: 3,
  /** Confidence multiplier when a field falls back to its fixed region. */
  regionConfidence: 0.7,
  /** On continuation pages without a repeated header, skip this fraction of the page top. */
  pageTopSkip: 0.08,
  /** Page headers and footers: lines in this top or bottom share of the page… */
  furnitureMargin: 0.1,
  /** …repeated at the same height on at least this share of pages (and 3 pages). */
  furniturePages: 0.6,
  /** How far a heading may sit from its example's indent, in points. */
  indent: 4,
  /** A page with fewer text tokens than this needs OCR. */
  ocrMinTokens: 10,
  /** Diagnostics look for alternate labels within this fraction of page height of the hint. */
  hintWindow: 0.2,
  /** `take: token` may join up to this many adjacent tokens (for "$ 1,234.56" or "12.40 CR"). */
  maxJoinedTokens: 4,
  /** Check tolerance for `~=` when the check sets none. */
  approxTolerance: 0.01,
} as const;
