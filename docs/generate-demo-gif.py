from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "assets" / "knarr-demo.gif"
LOGO = ROOT / "assets" / "knarr-icon.png"

W, H = 960, 540

BG = "#0d1117"
SURFACE = "#161b22"
SURFACE_SOFT = "#101720"
BORDER = "#30363d"
TEXT = "#e6edf3"
MUTED = "#8b949e"
GREEN = "#3fb950"
BLUE = "#58a6ff"
YELLOW = "#d29922"
RED = "#f85149"


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "C:/Windows/Fonts/CascadiaMono.ttf",
        "C:/Windows/Fonts/CascadiaCode.ttf",
        "C:/Windows/Fonts/consola.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


FONT_XS = font(15)
FONT_SM = font(18)
FONT_MD = font(24)
FONT_LG = font(34)
FONT_CODE = font(20)


def text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    value: str,
    fill: str = TEXT,
    fnt: ImageFont.ImageFont = FONT_SM,
) -> None:
    draw.text(xy, value, fill=fill, font=fnt)


def rounded(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    fill: str,
    outline: str = BORDER,
    radius: int = 14,
    width: int = 1,
) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def paste_logo(img: Image.Image, x: int, y: int, size: int) -> None:
    if not LOGO.exists():
        return
    logo = Image.open(LOGO).convert("RGBA")
    logo.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(logo, ((size - logo.width) // 2, (size - logo.height) // 2))
    img.alpha_composite(canvas, (x, y))


def base(headline: str, step: int) -> Image.Image:
    img = Image.new("RGBA", (W, H), BG)
    draw = ImageDraw.Draw(img)
    paste_logo(img, 48, 34, 48)
    text(draw, (112, 35), "Knarr", TEXT, FONT_LG)
    text(draw, (112, 74), "local npm packages without symlinks", MUTED, FONT_SM)
    text(draw, (48, 126), headline, BLUE, FONT_MD)

    for index in range(4):
        x = 760 + index * 34
        fill = BLUE if index <= step else BORDER
        draw.rounded_rectangle((x, 62, x + 22, 70), radius=4, fill=fill)

    return img


def terminal(
    draw: ImageDraw.ImageDraw,
    lines: list[tuple[str, str]],
    cursor_line: int | None,
    cursor_on: bool,
) -> None:
    box = (48, 180, 574, 456)
    x1, y1, x2, _ = box
    rounded(draw, box, SURFACE)
    draw.rounded_rectangle((x1, y1, x2, y1 + 42), radius=14, fill="#21262d")
    draw.rectangle((x1, y1 + 24, x2, y1 + 42), fill="#21262d")
    for i, color in enumerate((RED, YELLOW, GREEN)):
        draw.ellipse((x1 + 18 + i * 24, y1 + 15, x1 + 31 + i * 24, y1 + 28), fill=color)
    text(draw, (x1 + 104, y1 + 12), "terminal", MUTED, FONT_XS)

    y = y1 + 70
    for idx, (line, color) in enumerate(lines):
        text(draw, (x1 + 28, y), line, color, FONT_CODE)
        if idx == cursor_line and cursor_on:
            width = draw.textlength(line, font=FONT_CODE)
            draw.rectangle((x1 + 31 + int(width), y + 3, x1 + 42 + int(width), y + 25), fill=TEXT)
        y += 38


def result_panel(draw: ImageDraw.ImageDraw, title: str, lines: list[tuple[str, str]], active: bool) -> None:
    outline = GREEN if active else BORDER
    box = (626, 180, 912, 456)
    rounded(draw, box, SURFACE_SOFT, outline=outline, width=2 if active else 1)
    x1, y1, _, _ = box
    text(draw, (x1 + 28, y1 + 34), title, TEXT, FONT_MD)

    y = y1 + 94
    for line, color in lines:
        text(draw, (x1 + 28, y), line, color, FONT_SM)
        y += 42

    if active:
        draw.rounded_rectangle((x1 + 28, y1 + 210, x1 + 154, y1 + 242), radius=8, fill="#12331f")
        text(draw, (x1 + 46, y1 + 216), "updated", GREEN, FONT_XS)


SCENES = [
    {
        "headline": "Link the local package once.",
        "terminal": [
            ("$ cd my-app", MUTED),
            ("$ npx knarr use ../my-lib", TEXT),
            ("OK linked my-lib", GREEN),
        ],
        "title": "my-app",
        "result": [("node_modules/my-lib", TEXT), ("real files, no symlink", BLUE)],
        "active": False,
    },
    {
        "headline": "Start the package dev loop.",
        "terminal": [
            ("$ cd ../my-lib", MUTED),
            ("$ knarr dev", TEXT),
            ("watching src/**", BLUE),
        ],
        "title": "my-lib",
        "result": [("build -> publish", TEXT), ("pushes to my-app", GREEN)],
        "active": False,
    },
    {
        "headline": "Edit the package. The app refreshes.",
        "terminal": [
            ("src/Button.tsx saved", TEXT),
            ("changed files: 2", GREEN),
            ("elapsed: 184ms", BLUE),
        ],
        "title": "Vite app",
        "result": [("Fresh build", GREEN), ("single React instance", TEXT)],
        "active": True,
    },
    {
        "headline": "No package.json or lockfile churn.",
        "terminal": [
            ("$ git status --short", TEXT),
            ("", MUTED),
            ("clean working tree", GREEN),
        ],
        "title": "clean repo",
        "result": [("package.json unchanged", TEXT), ("lockfile unchanged", TEXT)],
        "active": True,
    },
]


def make_frames() -> list[Image.Image]:
    frames: list[Image.Image] = []
    for step, scene in enumerate(SCENES):
        for tick in range(12):
            img = base(scene["headline"], step)
            draw = ImageDraw.Draw(img)
            cursor_on = tick % 2 == 0 and step < 2
            terminal(draw, scene["terminal"], cursor_line=1, cursor_on=cursor_on)
            result_panel(draw, scene["title"], scene["result"], scene["active"])
            if scene["active"]:
                pulse = 5 + tick % 5
                draw.ellipse((612 - pulse, 314 - pulse, 612 + pulse, 314 + pulse), outline=GREEN, width=2)
                draw.line((574, 314, 626, 314), fill=GREEN, width=4)
            else:
                draw.line((574, 314, 626, 314), fill=BLUE, width=4)
            frames.append(img.convert("P", palette=Image.Palette.ADAPTIVE, colors=80))
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
        disposal=2,
    )
    print(OUT)


if __name__ == "__main__":
    main()
