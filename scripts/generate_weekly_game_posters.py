#!/usr/bin/env python3
"""Generate the OScanner-Eng weekly game poster set."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.graphics.barcode import qr
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
VERTICAL_SOURCE = ROOT / "public/assets/posters/source/weekly-game-keyvisual-vertical.png"
LANDSCAPE_SOURCE = ROOT / "public/assets/posters/source/weekly-game-keyvisual-landscape.png"
POSTER_OUTPUT = ROOT / "output/posters"
PDF_OUTPUT = ROOT / "output/pdf"

VERTICAL_MASTER = POSTER_OUTPUT / "weekly-game-lobby-2160x3840.png"
ELEVATOR_OUTPUT = POSTER_OUTPUT / "weekly-game-elevator-1080x1920.png"
PRINT_PNG = POSTER_OUTPUT / "weekly-game-print-790x590mm-300dpi.png"
PRINT_PDF = PDF_OUTPUT / "weekly-game-print-790x590mm.pdf"

GAME_URL = "http://10.1.130.9:3199/game"

PURPLE = "#6558E8"
PURPLE_DARK = "#473BB7"
PURPLE_INK = "#24243F"
GOLD = "#FFC857"
MINT = "#6BD5AA"
PEACH = "#FF8D73"
IVORY = "#FFFAF0"
WHITE = "#FFFFFF"
MUTED = "#686984"
LINE = "#DEDcf0"

CN_FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
LATIN_FONT = "/System/Library/Fonts/Avenir Next.ttc"


def font_cn(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(CN_FONT, size, index=2 if bold else 0)


def font_latin(size: int, weight: str = "bold") -> ImageFont.FreeTypeFont:
    indices = {"heavy": 8, "bold": 0, "demi": 2, "regular": 7}
    return ImageFont.truetype(LATIN_FONT, size, index=indices[weight])


def cover(image: Image.Image, size: tuple[int, int], focus: tuple[float, float] = (0.5, 0.5)) -> Image.Image:
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    resized = image.resize(
        (math.ceil(image.width * scale), math.ceil(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    extra_x = resized.width - target_w
    extra_y = resized.height - target_h
    left = int(extra_x * focus[0])
    top = int(extra_y * focus[1])
    return resized.crop((left, top, left + target_w, top + target_h))


def rounded_panel(
    image: Image.Image,
    box: tuple[int, int, int, int],
    radius: int,
    fill: str | tuple[int, int, int, int],
    shadow: tuple[int, int, int, int] | None = None,
    shadow_blur: int = 32,
    shadow_offset: int = 18,
    outline: str | None = None,
    outline_width: int = 0,
) -> None:
    if shadow:
        shadow_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow_layer)
        shifted = (
            box[0],
            box[1] + shadow_offset,
            box[2],
            box[3] + shadow_offset,
        )
        shadow_draw.rounded_rectangle(shifted, radius=radius, fill=shadow)
        image.alpha_composite(shadow_layer.filter(ImageFilter.GaussianBlur(shadow_blur)))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        box,
        radius=radius,
        fill=fill,
        outline=outline,
        width=outline_width,
    )


def draw_tracking_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: str,
    tracking: int,
) -> None:
    x, y = xy
    for character in text:
        draw.text((x, y), character, font=font, fill=fill)
        x += int(draw.textlength(character, font=font)) + tracking


def draw_logo(image: Image.Image, x: int, y: int, scale: float) -> None:
    mark_size = round(110 * scale)
    rotation_padding = round(24 * scale)
    tile = Image.new(
        "RGBA",
        (mark_size + rotation_padding * 2, mark_size + rotation_padding * 2),
        (0, 0, 0, 0),
    )
    td = ImageDraw.Draw(tile)
    offset = rotation_padding
    gold_offset = round(10 * scale)
    radius = round(30 * scale)
    td.rounded_rectangle(
        (
            offset + gold_offset,
            offset + gold_offset,
            offset + mark_size + gold_offset,
            offset + mark_size + gold_offset,
        ),
        radius=radius,
        fill=GOLD,
    )
    td.rounded_rectangle(
        (offset, offset, offset + mark_size, offset + mark_size),
        radius=radius,
        fill=PURPLE,
        outline=PURPLE_DARK,
        width=max(2, round(5 * scale)),
    )
    e_font = font_latin(round(52 * scale), "heavy")
    e_box = td.textbbox((0, 0), "E", font=e_font)
    e_x = offset + (mark_size - (e_box[2] - e_box[0])) // 2
    e_y = offset + (mark_size - (e_box[3] - e_box[1])) // 2 - e_box[1]
    td.text((e_x, e_y), "E", font=e_font, fill=WHITE)
    tile = tile.rotate(4, resample=Image.Resampling.BICUBIC, expand=False)
    image.alpha_composite(tile, (x - rotation_padding, y - rotation_padding))

    draw = ImageDraw.Draw(image)
    text_x = x + mark_size + round(28 * scale)
    draw.text(
        (text_x, y + round(2 * scale)),
        "OScanner-Eng",
        font=font_latin(round(42 * scale), "bold"),
        fill=PURPLE_INK,
    )
    draw.text(
        (text_x, y + round(56 * scale)),
        "SPEAK • SCORE • GROW",
        font=font_latin(round(19 * scale), "demi"),
        fill=PURPLE_DARK,
    )


def draw_alias_icon(image: Image.Image, box: tuple[int, int, int, int], scale: float) -> None:
    draw = ImageDraw.Draw(image)
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(box, radius=round(36 * scale), fill=PURPLE)
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    width = x1 - x0
    height = y1 - y0
    mask_box = (
        int(cx - width * 0.32),
        int(cy - height * 0.18),
        int(cx + width * 0.32),
        int(cy + height * 0.18),
    )
    draw.rounded_rectangle(mask_box, radius=round(25 * scale), fill=WHITE)
    eye_r = round(8 * scale)
    eye_gap = round(22 * scale)
    for eye_x in (cx - eye_gap, cx + eye_gap):
        draw.ellipse(
            (eye_x - eye_r, cy - eye_r, eye_x + eye_r, cy + eye_r),
            fill=PURPLE_DARK,
        )
    draw.polygon(
        [
            (mask_box[0] + round(8 * scale), int(cy)),
            (mask_box[0] - round(13 * scale), int(cy + 11 * scale)),
            (mask_box[0] + round(10 * scale), int(cy + 17 * scale)),
        ],
        fill=WHITE,
    )
    draw.polygon(
        [
            (mask_box[2] - round(8 * scale), int(cy)),
            (mask_box[2] + round(13 * scale), int(cy + 11 * scale)),
            (mask_box[2] - round(10 * scale), int(cy + 17 * scale)),
        ],
        fill=WHITE,
    )


def make_qr_image(data: str, pixels: int, color: str = PURPLE_INK) -> Image.Image:
    widget = qr.QrCodeWidget(data)
    widget.qr.make()
    modules = widget.qr.modules
    count = len(modules)
    quiet = 4
    total = count + quiet * 2
    module = max(1, pixels // total)
    rendered = module * total
    qr_image = Image.new("RGB", (rendered, rendered), WHITE)
    qd = ImageDraw.Draw(qr_image)
    for row, values in enumerate(modules):
        for column, active in enumerate(values):
            if active:
                x0 = (column + quiet) * module
                y0 = (row + quiet) * module
                qd.rectangle((x0, y0, x0 + module - 1, y0 + module - 1), fill=color)
    if rendered != pixels:
        canvas_image = Image.new("RGB", (pixels, pixels), WHITE)
        offset = ((pixels - rendered) // 2, (pixels - rendered) // 2)
        canvas_image.paste(qr_image, offset)
        return canvas_image
    return qr_image


def draw_vertical_master() -> Image.Image:
    width, height = 2160, 3840
    source = Image.open(VERTICAL_SOURCE).convert("RGB")
    image = cover(source, (width, height), focus=(0.5, 0.47)).convert("RGBA")
    draw = ImageDraw.Draw(image)

    draw_logo(image, 150, 142, 1.0)

    badge_box = (150, 410, 880, 510)
    draw.rounded_rectangle(badge_box, radius=50, fill=PURPLE_DARK)
    draw_tracking_text(
        draw,
        (202, 431),
        "WEEKLY SPEAKING GAME",
        font_latin(33, "bold"),
        WHITE,
        2,
    )

    draw.text((142, 596), "匿名参赛，", font=font_cn(244, True), fill=PURPLE_INK)
    draw.text((142, 868), "照样上榜。", font=font_cn(244, True), fill=PURPLE)
    draw.text(
        (154, 1172),
        "每周同题开讲  ·  最高分登上排行榜",
        font=font_cn(60, True),
        fill=PURPLE_INK,
    )
    draw.text(
        (154, 1264),
        "One topic. One week. Your best score counts.",
        font=font_latin(38, "demi"),
        fill=MUTED,
    )

    anonymous_box = (138, 1415, 2022, 1718)
    rounded_panel(
        image,
        anonymous_box,
        56,
        (255, 255, 255, 242),
        shadow=(72, 62, 137, 42),
        shadow_blur=36,
        shadow_offset=18,
        outline="#E1DDF7",
        outline_width=3,
    )
    draw_alias_icon(image, (192, 1480, 390, 1654), 1.0)
    draw = ImageDraw.Draw(image)
    draw.text((440, 1481), "开启“匿名显示”", font=font_cn(66, True), fill=PURPLE_DARK)
    draw.text(
        (440, 1576),
        "榜单只显示昵称  ·  分数照常计入  ·  随时可以切换",
        font=font_cn(42, False),
        fill=PURPLE_INK,
    )

    cta_box = (138, 3320, 2022, 3710)
    rounded_panel(
        image,
        cta_box,
        62,
        PURPLE_INK,
        shadow=(36, 36, 63, 58),
        shadow_blur=28,
        shadow_offset=18,
    )
    qr_size = 300
    qr_image = make_qr_image(GAME_URL, qr_size)
    image.paste(qr_image, (200, 3365))
    draw = ImageDraw.Draw(image)
    draw.text((570, 3385), "扫码登录钉钉", font=font_cn(74, True), fill=WHITE)
    draw.text((570, 3485), "进入 Game，开始本周挑战", font=font_cn(52, True), fill=GOLD)
    draw.text(
        (570, 3573),
        "两分钟内完成回答 · 本周可重试 · 只取最佳成绩",
        font=font_cn(36, False),
        fill="#E6E5F2",
    )
    draw.text((154, 3758), "OScanner-Eng · Internal weekly speaking challenge", font=font_latin(24, "demi"), fill=PURPLE_INK)

    return image


def draw_print_master() -> Image.Image:
    # Exact 790 x 590 mm at 300 dpi.
    width = round(790 / 25.4 * 300)
    height = round(590 / 25.4 * 300)
    source = Image.open(LANDSCAPE_SOURCE).convert("RGB")
    image = cover(source, (width, height), focus=(0.5, 0.5)).convert("RGBA")

    # A translucent warm veil keeps the left copy field exceptionally clean.
    veil = Image.new("RGBA", image.size, (0, 0, 0, 0))
    vd = ImageDraw.Draw(veil)
    vd.rectangle((0, 0, int(width * 0.55), height), fill=(255, 250, 240, 215))
    vd.rectangle((int(width * 0.55), 0, int(width * 0.68), height), fill=(255, 250, 240, 85))
    image.alpha_composite(veil)

    scale = width / 9331
    draw_logo(image, round(430 * scale), round(410 * scale), 1.6 * scale)
    draw = ImageDraw.Draw(image)

    badge = (
        round(430 * scale),
        round(1010 * scale),
        round(3050 * scale),
        round(1270 * scale),
    )
    draw.rounded_rectangle(badge, radius=round(130 * scale), fill=PURPLE_DARK)
    draw_tracking_text(
        draw,
        (round(570 * scale), round(1070 * scale)),
        "WEEKLY SPEAKING GAME",
        font_latin(round(95 * scale), "bold"),
        WHITE,
        round(7 * scale),
    )

    draw.text(
        (round(410 * scale), round(1450 * scale)),
        "匿名参赛，",
        font=font_cn(round(480 * scale), True),
        fill=PURPLE_INK,
    )
    draw.text(
        (round(410 * scale), round(2005 * scale)),
        "照样上榜。",
        font=font_cn(round(480 * scale), True),
        fill=PURPLE,
    )
    draw.text(
        (round(445 * scale), round(2650 * scale)),
        "每周同题开讲  ·  最高分登上排行榜",
        font=font_cn(round(145 * scale), True),
        fill=PURPLE_INK,
    )
    draw.text(
        (round(445 * scale), round(2865 * scale)),
        "ONE TOPIC. ONE WEEK. YOUR BEST SCORE COUNTS.",
        font=font_latin(round(85 * scale), "demi"),
        fill=MUTED,
    )

    card = (
        round(400 * scale),
        round(3260 * scale),
        round(4870 * scale),
        round(4110 * scale),
    )
    rounded_panel(
        image,
        card,
        round(120 * scale),
        (255, 255, 255, 244),
        shadow=(72, 62, 137, 45),
        shadow_blur=round(60 * scale),
        shadow_offset=round(30 * scale),
        outline="#DED9F8",
        outline_width=max(2, round(6 * scale)),
    )
    draw_alias_icon(
        image,
        (
            round(610 * scale),
            round(3425 * scale),
            round(1190 * scale),
            round(3935 * scale),
        ),
        3.0 * scale,
    )
    draw = ImageDraw.Draw(image)
    draw.text(
        (round(1370 * scale), round(3400 * scale)),
        "开启“匿名显示”",
        font=font_cn(round(190 * scale), True),
        fill=PURPLE_DARK,
    )
    draw.text(
        (round(1370 * scale), round(3675 * scale)),
        "排行榜只显示你的昵称，不显示真实姓名",
        font=font_cn(round(115 * scale), True),
        fill=PURPLE_INK,
    )
    draw.text(
        (round(1370 * scale), round(3870 * scale)),
        "分数照常计入 · 昵称可以修改 · 显示方式随时切换",
        font=font_cn(round(90 * scale), False),
        fill=MUTED,
    )

    qr_box = (
        round(400 * scale),
        round(4470 * scale),
        round(4870 * scale),
        round(6250 * scale),
    )
    rounded_panel(
        image,
        qr_box,
        round(120 * scale),
        PURPLE_INK,
        shadow=(36, 36, 63, 55),
        shadow_blur=round(56 * scale),
        shadow_offset=round(35 * scale),
    )
    qr_size = round(1180 * scale)
    qr_image = make_qr_image(GAME_URL, qr_size)
    image.paste(qr_image, (round(620 * scale), round(4770 * scale)))
    draw = ImageDraw.Draw(image)
    draw.text(
        (round(2050 * scale), round(4770 * scale)),
        "扫码参加本周挑战",
        font=font_cn(round(205 * scale), True),
        fill=WHITE,
    )
    draw.text(
        (round(2050 * scale), round(5075 * scale)),
        "登录钉钉 → 进入 Game → 开口回答",
        font=font_cn(round(115 * scale), True),
        fill=GOLD,
    )
    draw.text(
        (round(2050 * scale), round(5310 * scale)),
        "两分钟内完成 · 本周可重试 · 只取最佳成绩",
        font=font_cn(round(90 * scale), False),
        fill="#E6E5F2",
    )
    draw.text(
        (round(2050 * scale), round(5500 * scale)),
        "http://10.1.130.9:3199/game",
        font=font_latin(round(76 * scale), "demi"),
        fill=WHITE,
    )
    draw.text(
        (round(430 * scale), round(6570 * scale)),
        "OScanner-Eng · Internal weekly speaking challenge",
        font=font_latin(round(62 * scale), "demi"),
        fill=PURPLE_INK,
    )

    return image


def write_print_pdf(png_path: Path, pdf_path: Path) -> None:
    page_size = (790 * mm, 590 * mm)
    pdf = canvas.Canvas(str(pdf_path), pagesize=page_size, pageCompression=1)
    pdf.setTitle("OScanner-Eng Weekly Game - Anonymous Leaderboard Poster")
    pdf.setAuthor("OScanner-Eng")
    pdf.drawImage(
        str(png_path),
        0,
        0,
        width=page_size[0],
        height=page_size[1],
        preserveAspectRatio=False,
        mask="auto",
    )
    pdf.showPage()
    pdf.save()


def main() -> None:
    POSTER_OUTPUT.mkdir(parents=True, exist_ok=True)
    PDF_OUTPUT.mkdir(parents=True, exist_ok=True)

    vertical = draw_vertical_master().convert("RGB")
    vertical.save(VERTICAL_MASTER, format="PNG", optimize=True)
    vertical.resize((1080, 1920), Image.Resampling.LANCZOS).save(
        ELEVATOR_OUTPUT,
        format="PNG",
        optimize=True,
    )

    print_master = draw_print_master().convert("RGB")
    print_master.save(PRINT_PNG, format="PNG", optimize=True, dpi=(300, 300))
    write_print_pdf(PRINT_PNG, PRINT_PDF)

    print(VERTICAL_MASTER)
    print(ELEVATOR_OUTPUT)
    print(PRINT_PNG)
    print(PRINT_PDF)


if __name__ == "__main__":
    main()
