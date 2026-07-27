import Svg, { Path } from "react-native-svg";

interface FennocMarkProps {
  /** Edge length of the square viewport the mark is drawn in. */
  size?: number;
  /** Fill colour for all three paths — pass a resolved palette hex, not a className. */
  color: string;
}

/**
 * The Fennoc mark — "Sentinel": a solid keystone body with two ears standing
 * off the top. A crest, not a creature; no eyes, no snout, no expression.
 *
 * Idle presence (the only state this shell implements) is always
 * `ink-muted` and completely static — no animation of any kind. Listening /
 * thinking / done presence states are INT-025 and are deliberately not
 * built here.
 */
export function FennocMark({ size = 24, color }: FennocMarkProps) {
  return (
    <Svg fill="none" height={size} viewBox="0 0 64 64" width={size}>
      <Path d="M17 6 L26 26 L8 26 Z" fill={color} />
      <Path d="M47 6 L56 26 L38 26 Z" fill={color} />
      <Path
        d="M14 22 H50 A8 8 0 0 1 58 30 V48 A8 8 0 0 1 50 56 H14 A8 8 0 0 1 6 48 V30 A8 8 0 0 1 14 22 Z"
        fill={color}
      />
    </Svg>
  );
}
