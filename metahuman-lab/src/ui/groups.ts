/**
 * How the prepared specimen's aliases are presented.
 *
 * The sidecar binds one alias per GUI channel, because MetaHuman's faceboard gives a semantic
 * expression several channels — "mouth close" is four, upper and lower lips on both sides. The
 * UI groups them back under the semantic name, which is the whole reason the sidecar does not.
 *
 * A declared alias with no row here is an error, not a hidden control: a control the UI cannot
 * drive must not read as one that works.
 */

export interface IControlRow {
  readonly label: string;
  /** The channel that drives the left side, or the only side this faceboard row has. */
  readonly left: string;
  /** The mirrored channel, when the faceboard has one. */
  readonly right?: string;
}

export interface IControlGroup {
  readonly id: string;
  readonly label: string;
  readonly rows: readonly IControlRow[];
}

export const CONTROL_GROUPS: readonly IControlGroup[] = [
  { id: "jaw", label: "Jaw", rows: [{ label: "open", left: "jawOpen" }] },
  {
    id: "mouth",
    label: "Mouth",
    rows: [
      { label: "close upper", left: "mouthCloseUpperL", right: "mouthCloseUpperR" },
      { label: "close lower", left: "mouthCloseLowerL", right: "mouthCloseLowerR" },
      { label: "smile", left: "smileL", right: "smileR" },
      { label: "frown", left: "frownL", right: "frownR" },
    ],
  },
  {
    id: "lips",
    label: "Lips",
    rows: [
      { label: "pucker upper", left: "lipPuckerUpperL", right: "lipPuckerUpperR" },
      { label: "pucker lower", left: "lipPuckerLowerL", right: "lipPuckerLowerR" },
      { label: "funnel upper", left: "lipFunnelUpperL", right: "lipFunnelUpperR" },
      { label: "funnel lower", left: "lipFunnelLowerL", right: "lipFunnelLowerR" },
    ],
  },
  {
    id: "brow",
    label: "Brows",
    rows: [
      { label: "inner raise", left: "browRaiseInnerL", right: "browRaiseInnerR" },
      { label: "outer raise", left: "browRaiseOuterL", right: "browRaiseOuterR" },
      { label: "lower", left: "browLowerL", right: "browLowerR" },
    ],
  },
  {
    id: "eyes",
    label: "Eyes",
    rows: [
      { label: "blink", left: "blinkL", right: "blinkR" },
      { label: "squint", left: "squintL", right: "squintR" },
      { label: "cheek raise", left: "cheekRaiseL", right: "cheekRaiseR" },
    ],
  },
  {
    id: "gaze",
    label: "Gaze",
    rows: [
      { label: "horizontal", left: "gazeHorizontalL", right: "gazeHorizontalR" },
      { label: "vertical", left: "gazeVerticalL", right: "gazeVerticalR" },
    ],
  },
];

/** Every alias the UI can drive, for the check that no declared control went unpresented. */
export const PRESENTED_ALIASES: ReadonlySet<string> = new Set(
  CONTROL_GROUPS.flatMap((group) =>
    group.rows.flatMap((row) => (row.right === undefined ? [row.left] : [row.left, row.right])),
  ),
);
