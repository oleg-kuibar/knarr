from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
OUT = ROOT / "assets" / "knarr-demo.gif"
LOGO = REPO / "knarr_logo.png"

W, H = 960, 540

BG = "#0d1117"
SURFACE = "#161b22"
SURFACE_SOFT = "#101720"
SURFACE_ACTIVE = "#0f2238"
BORDER = "#30363d"
TEXT = "#e6edf3"
MUTED = "#8b949e"
GREEN = "#3fb950"
BLUE = "#58a6ff"
YELLOW = "#d29922"
RED = "#f85149"
PURPLE = "#a371f7"


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


FONT_TINY = font(13)
FONT_XS = font(15)
FONT_SM = font(18)
FONT_MD = font(22)
FONT_LG = font(32)
FONT_CODE = font(17)


def draw_text(
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


def progress(draw: ImageDraw.ImageDraw, active: int) -> None:
    labels = ["use", "dev", "edit", "push", "clean"]
    x = 596
    for index, label in enumerate(labels):
        fill = BLUE if index <= active else "#30363d"
        text_fill = TEXT if index <= active else MUTED
        draw.rounded_rectangle((x, 42, x + 44, 50), radius=4, fill=fill)
        draw_text(draw, (x - 1, 55), label, text_fill, FONT_TINY)
        x += 62


def terminal(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    title: str,
    lines: list[tuple[str, str]],
    cursor_line: int | None = None,
    cursor_on: bool = False,
) -> None:
    rounded(draw, box, SURFACE)
    x1, y1, x2, _ = box
    draw.rounded_rectangle((x1, y1, x2, y1 + 38), radius=14, fill="#21262d")
    draw.rectangle((x1, y1 + 22, x2, y1 + 38), fill="#21262d")
    for i, color in enumerate((RED, YELLOW, GREEN)):
        draw.ellipse((x1 + 16 + i * 22, y1 + 14, x1 + 28 + i * 22, y1 + 26), fill=color)
    draw_text(draw, (x1 + 90, y1 + 10), title, MUTED, FONT_XS)

    y = y1 + 58
    for idx, (line, color) in enumerate(lines):
        draw_text(draw, (x1 + 22, y), line, color, FONT_CODE)
        if cursor_line == idx and cursor_on:
            width = draw.textlength(line, font=FONT_CODE)
            draw.rectangle((x1 + 25 + int(width), y + 3, x1 + 35 + int(width), y + 22), fill=TEXT)
        y += 29


def app_preview(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], label: str, active: bool) -> None:
    outline = GREEN if active else BORDER
    rounded(draw, box, SURFACE_SOFT, outline=outline, radius=12, width=2 if active else 1)
    x1, y1, x2, _ = box
    draw.rectangle((x1 + 1, y1 + 1, x2 - 1, y1 + 36), fill="#0b1220")
    draw_text(draw, (x1 + 18, y1 + 10), "my-app preview", MUTED, FONT_XS)
    draw_text(draw, (x1 + 22, y1 + 58), label, GREEN if active else TEXT, FONT_MD)
    draw_text(draw, (x1 + 22, y1 + 94), "React: single instance", MUTED, FONT_XS)
    draw_text(draw, (x1 + 22, y1 + 118), "package.json: unchanged", MUTED, FONT_XS)


def file_stack(draw: ImageDraw.ImageDraw, x: int, y: int, active: bool) -> None:
    colors = [BLUE, GREEN, PURPLE]
    names = ["src/Button.tsx", "dist/index.js", "node_modules/my-lib"]
    for i, name in enumerate(names):
        dy = i * 34
        fill = SURFACE_ACTIVE if active and i == 2 else SURFACE_SOFT
        outline = GREEN if active and i == 2 else BORDER
        rounded(draw, (x, y + dy, x + 275, y + dy + 28), fill, outline=outline, radius=7)
        draw.rectangle((x + 12, y + dy + 8, x + 18, y + dy + 20), fill=colors[i])
        draw_text(draw, (x + 30, y + dy + 5), name, TEXT if i == 2 else MUTED, FONT_TINY)


def arrow(draw: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int], color: str) -> None:
    draw.line((start, end), fill=color, width=4)
    ex, ey = end
    draw.polygon([(ex, ey), (ex - 13, ey - 8), (ex - 13, ey + 8)], fill=color)


def base(active_step: int, headline: str) -> Image.Image:
    img = Image.new("RGBA", (W, H), BG)
    draw = ImageDraw.Draw(img)
    paste_logo(img, 42, 24, 54)
    draw_text(draw, (108, 30), "Knarr", TEXT, FONT_LG)
    draw_text(draw, (108, 68), "local package development without symlinks", MUTED, FONT_SM)
    progress(draw, active_step)
    draw_text(draw, (48, 492), headline, BLUE, FONT_MD)
    return img


SCENES = [
    {
        "step": 0,
        "headline": "Link a local package with one command.",
        "left": [("$ cd my-app", MUTED), ("$ npx knarr use ../my-lib", TEXT), ("OK published my-lib@0.0.1", GREEN), ("OK linked node_modules/my-lib", GREEN)],
        "right": [("my-lib", MUTED), ("package.json -> name: my-lib", TEXT), ("files copied into ~/.knarr/store", BLUE)],
        "preview": "Awaiting my-lib",
        "active": False,
    },
    {
        "step": 1,
        "headline": "Run dev once from the package. Knarr handles the loop.",
        "left": [("consumer registered", GREEN), ("Vite watches real files", BLUE), ("no package.json edits", GREEN)],
        "right": [("$ cd ../my-lib", MUTED), ("$ knarr dev", TEXT), ("watching src/**", BLUE), ("pushes to 1 consumer", GREEN)],
        "preview": "my-lib linked",
        "active": False,
    },
    {
        "step": 2,
        "headline": "Edit source. No symlink maze, no duplicate React.",
        "left": [("node_modules/my-lib", TEXT), ("is a real package tree", GREEN), ("bundler sees file writes", BLUE)],
        "right": [("src/Button.tsx", TEXT), ('label = "Fresh build"', BLUE), ("build -> publish -> push", GREEN)],
        "preview": "Fresh build",
        "active": True,
    },
    {
        "step": 3,
        "headline": "The consumer updates like an installed package.",
        "left": [("Vite reload", BLUE), ("my-app renders Fresh build", GREEN), ("React instance: single", GREEN)],
        "right": [("changed files copied: 2", GREEN), ("unchanged files skipped: 41", MUTED), ("elapsed: 184ms", BLUE)],
        "preview": "Fresh build",
        "active": True,
    },
    {
        "step": 4,
        "headline": "Your dependency files stay clean.",
        "left": [("$ git status --short", TEXT), ("", MUTED), ("clean working tree", GREEN)],
        "right": [("package.json", TEXT), ("lockfile", TEXT), (".gitignore", TEXT), ("no local override diffs", GREEN)],
        "preview": "Fresh build",
        "active": True,
    },
]


def make_frames() -> list[Image.Image]:
    frames: list[Image.Image] = []
    for scene in SCENES:
        for tick in range(10):
            img = base(scene["step"], scene["headline"])
            draw = ImageDraw.Draw(img)
            cursor_on = tick % 2 == 0 and scene["step"] in (0, 1)
            terminal(draw, (48, 118, 420, 390), "consumer", scene["left"], cursor_line=1, cursor_on=cursor_on)
            terminal(draw, (540, 118, 912, 390), "package", scene["right"], cursor_line=1, cursor_on=cursor_on)
            arrow(draw, (420, 244), (540, 244), GREEN if scene["active"] else BLUE)
            file_stack(draw, 70, 410, scene["active"])
            app_preview(draw, (618, 398, 890, 474), scene["preview"], scene["active"])
            if scene["active"]:
                pulse = 7 + tick % 4
                draw.ellipse((526 - pulse, 244 - pulse, 526 + pulse, 244 + pulse), outline=GREEN, width=2)
            frames.append(img.convert("P", palette=Image.Palette.ADAPTIVE, colors=96))
    return frames


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames = make_frames()
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=95,
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(OUT)


if __name__ == "__main__":
    main()
