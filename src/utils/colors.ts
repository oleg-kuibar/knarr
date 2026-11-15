import { styleText } from "node:util";

type Style = (text: string | number) => string;

/**
 * Terminal colors via Node's built-in `util.styleText` (stable since 22.13).
 * It checks the output stream and honours NO_COLOR, NODE_DISABLE_COLORS and
 * FORCE_COLOR, so piped or CI output stays plain unless FORCE_COLOR is set.
 */
function style(format: Parameters<typeof styleText>[0]): Style {
  return (text) => styleText(format, String(text));
}

export const pc: {
  bold: Style;
  dim: Style;
  cyan: Style;
  green: Style;
  red: Style;
  yellow: Style;
} = {
  bold: style("bold"),
  dim: style("dim"),
  cyan: style("cyan"),
  green: style("green"),
  red: style("red"),
  yellow: style("yellow"),
};
