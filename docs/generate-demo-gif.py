from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "assets" / "knarr-demo.gif"
W, H = 960, 540

BG = "#0d1117"
PANEL = "#161b22"
PANEL_2 = "#0f1720"
BORDER = "#30363d"
TEXT = "#e6edf3"
MUTED = "#8b949e"
GREEN = "#3fb950"
BLUE = "#58a6ff"
YELLOW = "#d29922"
RED = "#f85149"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/CascadiaMono.ttf",
        "C:/Windows/Fonts/CascadiaCode.ttf",
        "C:/Windows/Fonts/consola.ttf",
        "C:/Windows/Fonts/seguiemj.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


FONT_XS = font(15)
FONT_SM = font(18)
FONT_MD = font(22)
FONT_LG = font(34)
FONT_CODE = font(18)


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: str, outline: str = BORDER, radius: int = 14) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=1)


def text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], value: str, fill: str = TEXT, fnt=FONT_SM) -> None:
    draw.text(xy, value, fill=fill, font=fnt)


def terminal(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], title: str, lines: list[tuple[str, str]]) -> None:
    rounded(draw, box, PANEL)
    x1, y1, x2, _ = box
    draw.rounded_rectangle((x1, y1, x2, y1 + 38), radius=14, fill="#21262d")
    draw.rectangle((x1, y1 + 22, x2, y1 + 38), fill="#21262d")
    for i, color in enumerate([RED, YELLOW, GREEN]):
        draw.ellipse((x1 + 16 + i * 22, y1 + 14, x1 + 28 + i * 22, y1 + 26), fill=color)
    text(draw, (x1 + 90, y1 + 10), title, MUTED, FONT_XS)
    y = y1 + 58
    for line, color in lines:
        text(draw, (x1 + 22, y), line, color, FONT_CODE)
        y += 30


def file_card(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], title: str, subtitle: str, color: str, active: bool = False) -> None:
    rounded(draw, box, PANEL_2 if not active else "#102033", BLUE if active else BORDER)
    x1, y1, _, _ = box
    draw.rectangle((x1 + 18, y1 + 21, x1 + 25, y1 + 80), fill=color)
    text(draw, (x1 + 42, y1 + 18), title, TEXT, FONT_SM)
    text(draw, (x1 + 42, y1 + 48), subtitle, MUTED, FONT_XS)


def arrow(draw: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int], color: str = BLUE) -> None:
    draw.line((start, end), fill=color, width=4)
    ex, ey = end
    draw.polygon([(ex, ey), (ex - 12, ey - 7), (ex - 12, ey + 7)], fill=color)


def base_frame(step: int, caption: str) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    text(draw, (48, 30), "Knarr", TEXT, FONT_LG)
    text(draw, (160, 43), "local packages without symlinks or dirty package.json diffs", MUTED, FONT_SM)
    text(draw, (48, 496), caption, BLUE, FONT_MD)
    for i in range(4):
        fill = BLUE if i <= step else "#30363d"
        draw.rounded_rectangle((790 + i * 34, 502, 814 + i * 34, 510), radius=4, fill=fill)
    return img


def make_frames() -> list[Image.Image]:
    frames: list[Image.Image] = []
    scenes = [
        (
            0,
            "One command links a local package into your app.",
            [("$ cd my-app", MUTED), ("$ npx knarr use ../my-lib", TEXT), ("✓ Published my-lib@0.0.1", GREEN), ("✓ Linked into node_modules/my-lib", GREEN)],
            [("$ cd ../my-lib", MUTED), ("$ knarr dev", TEXT), ("waiting for changes...", MUTED)],
            False,
            False,
        ),
        (
            1,
            "Run dev once from the library. Knarr watches, builds, and pushes.",
            [("$ cd my-app", MUTED), ("$ npx knarr use ../my-lib", TEXT), ("✓ Linked into node_modules/my-lib", GREEN)],
            [("$ cd ../my-lib", MUTED), ("$ knarr dev", TEXT), ("watching src/**", BLUE), ("pushes to 1 consumer", GREEN)],
            False,
            False,
        ),
        (
            2,
            "Edit the local package. No symlinks, no duplicate React.",
            [("my-app", MUTED), ("node_modules/my-lib", TEXT), ("real files copied here", GREEN)],
            [("my-lib/src/Button.tsx", TEXT), ("export const label =", MUTED), ("  \"Fresh build\"", BLUE)],
            True,
            False,
        ),
        (
            3,
            "Consumer updates, git stays clean.",
            [("Vite reload", BLUE), ("my-app renders: Fresh build", GREEN), ("React instance: single", GREEN)],
            [("$ git status --short", TEXT), ("", MUTED), ("# clean working tree", GREEN)],
            True,
            True,
        ),
    ]

    for step, caption, left_lines, right_lines, active_edit, clean in scenes:
        for pulse in range(8):
            img = base_frame(step, caption)
            draw = ImageDraw.Draw(img)
            terminal(draw, (48, 108, 458, 390), "consumer app", left_lines)
            terminal(draw, (502, 108, 912, 390), "local package", right_lines)
            arrow(draw, (458, 250), (502, 250), GREEN if step >= 2 else BLUE)
            file_card(draw, (112, 410, 378, 470), "my-app", "package.json unchanged", GREEN if clean else BLUE, clean)
            file_card(draw, (582, 410, 848, 470), "my-lib", "edit, build, push", BLUE if active_edit else MUTED, active_edit)
            if active_edit:
                r = 10 + pulse % 4
                draw.ellipse((810 - r, 130 - r, 810 + r, 130 + r), outline=BLUE, width=3)
            frames.append(img)
    return frames


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames = make_frames()
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=115,
        loop=0,
        optimize=True,
    )
    print(OUT)


if __name__ == "__main__":
    main()
