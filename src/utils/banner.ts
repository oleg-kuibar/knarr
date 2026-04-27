import pc from "picocolors";

const KNARR_ASCII = `
  _  __
 | |/ /_ __   __ _ _ __ _ __
 | ' /| '_ \\ / _\` | '__| '__|
 | . \\| | | | (_| | |  | |
 |_|\\_\\_| |_|\\__,_|_|  |_|
`;

export function showBanner(): void {
  console.log(pc.yellow(KNARR_ASCII));
  console.log(pc.cyan("  Local npm package development without symlinks"));
  console.log(pc.dim("  Copies built files into consumer node_modules with incremental sync\n"));
}
