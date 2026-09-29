#!/usr/bin/env python3
"""Generate the OScanner-Eng weekly task figures.

Each figure is a two-step build so that the illustrative artwork looks
plausible while every label stays exact:

  1. ``qwen-image`` on the internal hub paints a soft, text-free backdrop motif
     for the lesson.
  2. PIL draws the lesson's real content - bar chart, results table, slide
     outline, paper front page, road map, abstract block - on top, with the
     chart values, axis labels, table headers and callouts rendered
     deterministically. The "Illustrative figure - synthetic data" caption is
     added as HTML by the client so it can follow the language toggle.

The hub bearer token is read from the macOS keychain at run time and is never
written to the repository, logs, or this file. This is an authoring-time tool:
production only ever serves the committed PNGs.

The raw model backdrops under ``public/assets/figures/source`` stay out of Git;
``--compose-only`` regenerates the final PNGs from the committed tooling and
falls back to a procedural backdrop when a saved base is missing.

Usage:
  python3 scripts/generate_weekly_figures.py                 # bases + compose
  python3 scripts/generate_weekly_figures.py --compose-only  # reuse saved bases
  python3 scripts/generate_weekly_figures.py --base-only     # refresh bases
  python3 scripts/generate_weekly_figures.py --only l07     # one lesson
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FIGURES_DIR = ROOT / "public" / "assets" / "figures"
SOURCE_DIR = FIGURES_DIR / "source"

IMAGE_ENDPOINT = "https://llm.inner.bza.edu.cn/hub/v1/images/generations"
IMAGE_MODEL = "qwen-image"
IMAGE_SIZE = "1024x1024"
KEYCHAIN_SERVICE = "com.openai.codex.internal-models"
KEYCHAIN_ACCOUNT = "carter"
TOKEN_HELPER = Path.home() / ".codex" / "bin" / "internal-model-token"

CANVAS = (1600, 1000)

INK = "#24243F"
MUTED = "#686984"
LINE = "#DEDCF0"
PURPLE = "#6558E8"
PURPLE_DARK = "#473BB7"
GOLD = "#E0A320"
MINT = "#2F9C74"
PEACH = "#E06A4E"
SKY = "#E9F2FD"
MINT_SOFT = "#E6F7EF"
GOLD_SOFT = "#FFF6DE"
PEACH_SOFT = "#FDECE7"
PAPER = "#FFFFFF"
GRID = "#EDEBF7"

LATIN_FONT = "/System/Library/Fonts/Avenir Next.ttc"
LATIN_INDEX = {"heavy": 8, "bold": 0, "demi": 2, "medium": 5, "regular": 7}


def font(size: int, weight: str = "bold") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(LATIN_FONT, size, index=LATIN_INDEX[weight])


# --------------------------------------------------------------------------- #
# Base artwork                                                                #
# --------------------------------------------------------------------------- #


def internal_token() -> str:
    """Read the hub bearer token from the keychain without ever printing it."""
    if TOKEN_HELPER.exists():
        token = subprocess.run(
            [str(TOKEN_HELPER)], capture_output=True, text=True, check=True
        ).stdout.strip()
        if token:
            return token
    result = subprocess.run(
        [
            "security",
            "find-generic-password",
            "-a",
            KEYCHAIN_ACCOUNT,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def request_base(prompt: str) -> Image.Image | None:
    """Ask qwen-image for a text-free backdrop; return None when unavailable."""
    payload = json.dumps(
        {
            "model": IMAGE_MODEL,
            "prompt": prompt,
            "size": IMAGE_SIZE,
            "n": 1,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        IMAGE_ENDPOINT,
        data=payload,
        headers={
            "Authorization": f"Bearer {internal_token()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, OSError) as error:
        print(f"    ! image model unavailable ({error}); using procedural base")
        return None

    data = (body.get("data") or [{}])[0]
    if data.get("b64_json"):
        import io

        return Image.open(io.BytesIO(base64.b64decode(data["b64_json"]))).convert("RGB")
    if data.get("url"):
        with urllib.request.urlopen(data["url"], timeout=300) as response:
            import io

            return Image.open(io.BytesIO(response.read())).convert("RGB")
    print("    ! image model returned no image; using procedural base")
    return None


def procedural_base(seed: str) -> Image.Image:
    """A soft diagonal wash, used when the image model is unreachable."""
    width, height = CANVAS
    top = (232, 236, 252)
    bottom = (250, 248, 240)
    shift = (sum(seed.encode("utf-8")) % 40) - 20
    base = Image.new("RGB", (width, height))
    pixels = base.load()
    for y in range(height):
        ratio = y / max(1, height - 1)
        row = tuple(
            int(top[channel] + (bottom[channel] - top[channel]) * ratio)
            for channel in range(3)
        )
        for x in range(width):
            drift = int(math.sin((x + y + shift) / 260.0) * 6)
            pixels[x, y] = tuple(
                max(0, min(255, channel + drift)) for channel in row
            )
    return base


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    resized = image.resize(
        (math.ceil(image.width * scale), math.ceil(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - target_w) // 2
    top = (resized.height - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))


def backdrop(base: Image.Image) -> Image.Image:
    """Faint, blurred backdrop so the drawn content stays the focal point."""
    canvas = cover(base, CANVAS).filter(ImageFilter.GaussianBlur(18))
    white = Image.new("RGB", CANVAS, PAPER)
    return Image.blend(canvas, white, 0.88)


# --------------------------------------------------------------------------- #
# Drawing helpers                                                             #
# --------------------------------------------------------------------------- #


def text(draw: ImageDraw.ImageDraw, xy, value, font_obj, fill=INK, anchor="la"):
    draw.text(xy, value, font=font_obj, fill=fill, anchor=anchor)


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def arrow(draw, start, end, fill=PURPLE, width=5):
    draw.line([start, end], fill=fill, width=width)
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    length = 20
    for offset in (2.6, -2.6):
        draw.line(
            [
                end,
                (
                    end[0] + length * math.cos(angle + offset),
                    end[1] + length * math.sin(angle + offset),
                ),
            ],
            fill=fill,
            width=width,
        )


def card(draw, box, radius=26, fill=PAPER, outline=LINE, width=3):
    rounded(draw, box, radius, fill=fill, outline=outline, width=width)


def wrap_text(draw: ImageDraw.ImageDraw, value: str, size: int, weight: str, max_width: float):
    """Break a caption to the available width instead of overflowing its card."""
    font_obj = font(size, weight)
    lines, line = [], ""
    for word in value.split():
        candidate = f"{line} {word}".strip()
        if line and draw.textlength(candidate, font=font_obj) > max_width:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines


def value_to_y(value: float, low: float, high: float, top: float, bottom: float) -> float:
    ratio = (value - low) / (high - low)
    return bottom - ratio * (bottom - top)


def draw_axes(draw, box, low: float, high: float, ticks, y_label, y_suffix=""):
    x0, top, x1, bottom = box
    for tick in ticks:
        y = value_to_y(tick, low, high, top, bottom)
        draw.line([(x0, y), (x1, y)], fill=GRID, width=2)
        text(draw, (x0 - 18, y), f"{tick:g}{y_suffix}", font(22, "medium"), MUTED, "rm")
    draw.line([(x0, top), (x0, bottom)], fill=LINE, width=3)
    text(
        draw,
        (x0 - 78, (top + bottom) / 2),
        y_label,
        font(24, "demi"),
        MUTED,
        "mm",
    )


def grouped_bar_chart(draw, box, categories, series, y_label, y_min, y_max, ticks):
    x0, top, x1, bottom = box
    draw_axes(draw, box, y_min, y_max, ticks, y_label)
    slot = (x1 - x0) / len(categories)
    bar_w = min(70.0, slot / (len(series) + 1.4))
    for index, category in enumerate(categories):
        centre = x0 + slot * (index + 0.5)
        group_w = bar_w * len(series)
        for order, (name, values, errors, color) in enumerate(series):
            value = values[index]
            error = errors[index]
            left = centre - group_w / 2 + order * bar_w
            top_y = value_to_y(value, y_min, y_max, top, bottom)
            rounded(
                draw,
                (left + 4, top_y, left + bar_w - 4, bottom),
                10,
                fill=color,
            )
            centre_x = left + bar_w / 2
            if error:
                err_top = value_to_y(value + error, y_min, y_max, top, bottom)
                err_bottom = value_to_y(value - error, y_min, y_max, top, bottom)
                draw.line([(centre_x, err_top), (centre_x, err_bottom)], fill=INK, width=3)
                draw.line(
                    [(centre_x - 11, err_top), (centre_x + 11, err_top)], fill=INK, width=3
                )
                draw.line(
                    [(centre_x - 11, err_bottom), (centre_x + 11, err_bottom)],
                    fill=INK,
                    width=3,
                )
            label_y = value_to_y(value + error, y_min, y_max, top, bottom) if error else top_y
            text(draw, (centre_x, label_y - 14), f"{value:g}", font(22, "demi"), INK, "mb")
        text(draw, (centre, bottom + 24), category, font(24, "medium"), MUTED, "ma")
    legend_x = x1 - max(
        38 + draw.textlength(name, font=font(24, "medium")) for name, *_rest in series
    )
    for order, (name, _values, _errors, color) in enumerate(series):
        y = top - 46 + order * 34
        draw.rectangle((legend_x, y, legend_x + 26, y + 20), fill=color)
        text(draw, (legend_x + 38, y + 10), name, font(24, "medium"), MUTED, "lm")


def line_chart(draw, box, steps, series, y_label, y_min, y_max, ticks):
    x0, top, x1, bottom = box
    draw_axes(draw, box, y_min, y_max, ticks, y_label)
    step = (x1 - x0) / (len(steps) - 1)
    points_by_series = []
    for name, values, color in series:
        points = [
            (x0 + step * index, value_to_y(value, y_min, y_max, top, bottom))
            for index, value in enumerate(values)
        ]
        points_by_series.append((name, points, color))
    for name, points, color in points_by_series:
        draw.line(points, fill=color, width=6, joint="curve")
        for point in points:
            draw.ellipse(
                (point[0] - 8, point[1] - 8, point[0] + 8, point[1] + 8),
                fill=PAPER,
                outline=color,
                width=5,
            )
    for index, label in enumerate(steps):
        text(draw, (x0 + step * index, bottom + 24), label, font(22, "medium"), MUTED, "ma")
    legend_x = x1 - max(
        46 + draw.textlength(name, font=font(24, "medium")) for name, *_rest in series
    )
    for order, (name, _points, color) in enumerate(points_by_series):
        y = top - 46 + order * 34
        draw.line([(legend_x, y + 10), (legend_x + 34, y + 10)], fill=color, width=6)
        text(draw, (legend_x + 46, y + 10), name, font(24, "medium"), MUTED, "lm")
    return points_by_series


# --------------------------------------------------------------------------- #
# Lesson content                                                              #
# --------------------------------------------------------------------------- #


def content_l02(draw, box):
    """Structuring an academic presentation: annotated sample talk outline."""
    x0, y0, x1, y1 = box
    card(draw, (x0, y0, x0 + 300, y0 + 104), 18, fill=PURPLE, outline=None)
    text(draw, (x0 + 26, y0 + 34), "Title slide", font(30, "bold"), PAPER)
    text(draw, (x0 + 26, y0 + 70), "Topic + your name", font(22, "medium"), "#E4E1FB")
    sections = [
        ("1", "Motivation", "Why long-document retrieval fails", GOLD_SOFT, GOLD),
        ("2", "Method", "Our sparse retrieval recipe", SKY, PURPLE),
        ("3", "Results", "Exact match on four benchmarks", MINT_SOFT, MINT),
        ("4", "Conclusion", "What it still does not fix", PEACH_SOFT, PEACH),
    ]
    top = y0 + 150
    height = (y1 - top - 60) / 4
    for order, (number, heading, detail, tint, accent) in enumerate(sections):
        y = top + order * height
        card(draw, (x0, y, x0 + 760, y + height - 22), 18, fill=tint, outline=None)
        draw.ellipse((x0 + 24, y + 20, x0 + 86, y + 82), fill=accent)
        text(draw, (x0 + 55, y + 51), number, font(30, "bold"), PAPER, "mm")
        text(draw, (x0 + 110, y + 24), heading, font(30, "demi"), INK)
        text(draw, (x0 + 110, y + 64), detail, font(24, "medium"), MUTED)
    cues = [
        ("Design", "One idea per slide", GOLD),
        ("Delivery", "Eye contact, no reading", PURPLE),
        ("Timing", "About one minute per section", MINT),
    ]
    base_x = x0 + 820
    for order, (heading, detail, accent) in enumerate(cues):
        y = y0 + 150 + order * 156
        card(draw, (base_x, y, x1, y + 132), 18, fill=PAPER, outline=LINE)
        draw.rectangle((base_x, y + 18, base_x + 8, y + 114), fill=accent)
        text(draw, (base_x + 30, y + 24), heading, font(26, "demi"), INK)
        text(draw, (base_x + 30, y + 62), detail, font(23, "medium"), MUTED)


def content_l03(draw, box):
    """Finding the main line of a talk: road map with structure signposts."""
    x0, y0, x1, y1 = box
    stages = [
        ("Problem", "First, the gap", "Slow on long documents", SKY, PURPLE),
        ("Method", "So we built", "Sparse retrieval with a reranker", MINT_SOFT, MINT),
        ("Result", "As a result", "+12 exact match", GOLD_SOFT, GOLD),
        ("Limitation", "However, still open", "Multilingual data is thin", PEACH_SOFT, PEACH),
    ]
    gap = 46
    width = (x1 - x0 - gap * 3) / 4
    top = y0 + 90
    for order, (heading, signpost, detail, tint, accent) in enumerate(stages):
        left = x0 + order * (width + gap)
        card(draw, (left, top, left + width, top + 300), 22, fill=tint, outline=None)
        draw.rectangle((left + 24, top + 26, left + width - 24, top + 34), fill=accent)
        text(draw, (left + 24, top + 62), heading, font(34, "bold"), INK)
        text(draw, (left + 24, top + 118), signpost, font(25, "medium"), MUTED)
        for index, line in enumerate(wrap_text(draw, detail, 23, "medium", width - 56)):
            text(draw, (left + 24, top + 180 + index * 32), line, font(23, "medium"), INK)
        if order < 3:
            arrow(
                draw,
                (left + width + 8, top + 150),
                (left + width + gap - 8, top + 150),
                fill=PURPLE_DARK,
                width=6,
            )
    arrow(draw, (x0 + 10, top + 360), (x1 - 30, top + 360), fill=PURPLE, width=7)
    text(
        draw,
        ((x0 + x1) / 2, top + 400),
        "Main line: the one sentence every signpost supports",
        font(28, "demi"),
        PURPLE_DARK,
        "ma",
    )


def content_l05(draw, box):
    """Three-pass reading of an AI paper: paper front page + pass badges."""
    x0, y0, x1, y1 = box
    page_w = 720
    card(draw, (x0, y0, x0 + page_w, y1), 18, fill=PAPER, outline=LINE)
    text(draw, (x0 + 40, y0 + 26), "Retrieval-Augmented Generation", font(32, "bold"), INK)
    text(draw, (x0 + 40, y0 + 64), "for Scientific Question Answering", font(32, "bold"), INK)
    text(draw, (x0 + 40, y0 + 110), "A. Author, B. Author, C. Author  \u00b7 Institute Lab", font(22, "medium"), MUTED)
    draw.line([(x0 + 40, y0 + 146), (x0 + page_w - 40, y0 + 146)], fill=LINE, width=3)
    text(draw, (x0 + 40, y0 + 162), "Abstract", font(25, "demi"), INK)
    for line_index in range(3):
        draw.rectangle(
            (
                x0 + 40,
                y0 + 200 + line_index * 26,
                x0 + page_w - 40 - (line_index % 2) * 120,
                y0 + 212 + line_index * 26,
            ),
            fill=GRID,
        )
    thumb = (x0 + 40, y0 + 284, x0 + page_w - 40, y0 + 448)
    card(draw, thumb, 14, fill=SKY, outline=LINE, width=2)
    text(draw, (thumb[0] + 18, thumb[1] + 10), "Figure 1", font(23, "demi"), PURPLE_DARK)
    for order, height in enumerate((56, 84, 108, 74, 96)):
        left = thumb[0] + 40 + order * 112
        draw.rectangle((left, thumb[3] - 24 - height, left + 66, thumb[3] - 24), fill=PURPLE)
    text(draw, (x0 + 40, y0 + 470), "Conclusion", font(25, "demi"), INK)
    for line_index in range(2):
        draw.rectangle(
            (x0 + 40, y0 + 504 + line_index * 26, x0 + page_w - 160, y0 + 516 + line_index * 26),
            fill=GRID,
        )
    passes = [
        ("1", "Title, abstract, conclusion", "What is claimed?", PURPLE),
        ("2", "Figures, tables, method", "How is it shown?", MINT),
        ("3", "Full read, details", "What is still weak?", GOLD),
    ]
    base_x = x0 + page_w + 40
    for order, (number, heading, detail, accent) in enumerate(passes):
        y = y0 + 20 + order * 168
        card(draw, (base_x, y, x1, y + 132), 18, fill=PAPER, outline=LINE)
        draw.ellipse((base_x + 24, y + 24, base_x + 84, y + 84), fill=accent)
        text(draw, (base_x + 54, y + 54), number, font(30, "bold"), PAPER, "mm")
        text(draw, (base_x + 108, y + 26), heading, font(26, "demi"), INK)
        text(draw, (base_x + 108, y + 66), detail, font(23, "medium"), MUTED)


def content_l07(draw, box):
    """Explaining an experimental figure: bar chart with a baseline and a glitch."""
    categories = ["ShortQA", "LongDocQA", "MultiHopQA", "X-Lingual"]
    series = [
        ("Ours (RAG-8B)", [72.0, 78.0, 61.0, 84.0], [3.0, 2.0, 4.0, 3.0], PURPLE),
        ("Baseline (Dense-8B)", [64.0, 70.0, 66.0, 71.0], [3.0, 3.0, 2.0, 3.0], "#C9C6E8"),
    ]
    # Leave room on the left for the y-axis title and below for the note line.
    plot = (box[0] + 150, box[1] + 16, box[2], box[3] - 46)
    grouped_bar_chart(draw, plot, categories, series, "Exact match (%)", 40, 100, [40, 60, 80, 100])
    x0, top, x1, bottom = plot
    slot = (x1 - x0) / len(categories)
    bar_w = min(70.0, slot / (len(series) + 1.4))
    proposed_x = x0 + slot * 2.5 - bar_w / 2
    bar_top = value_to_y(61.0, 40, 100, top, bottom)
    text(draw, (proposed_x + 16, bar_top - 150), "One outlier run", font(24, "demi"), PEACH)
    arrow(draw, (proposed_x + 84, bar_top - 128), (proposed_x + 4, bar_top - 22), fill=PEACH, width=5)
    text(
        draw,
        (x0, bottom + 46),
        "Compare against the baseline, then name the anomaly.",
        font(25, "medium"),
        MUTED,
    )


def content_l10(draw, box):
    """Managing the boundaries of your results: table with CIs and n.s. cells."""
    x0, y0, x1, y1 = box
    headers = ["Setting", "n", "Mean", "95% CI", "Significance"]
    rows = [
        ["In-domain", "120", "81.4", "[78.9, 83.9]", "p < 0.05"],
        ["Cross-domain", "120", "68.2", "[65.1, 71.3]", "n.s."],
        ["Low-resource", "40", "59.7", "[54.2, 65.2]", "n.s."],
        ["Ablated", "120", "74.8", "[71.6, 78.0]", "p < 0.05"],
    ]
    widths = [0.30, 0.12, 0.18, 0.24, 0.16]
    total = x1 - x0
    header_h = 74
    row_h = 84
    card(draw, (x0, y0, x1, y0 + header_h + row_h * len(rows)), 16, fill=PAPER, outline=LINE)
    draw.rectangle((x0, y0, x1, y0 + header_h), fill=SKY)
    x = x0
    for index, heading in enumerate(headers):
        width = total * widths[index]
        text(draw, (x + 24, y0 + header_h / 2), heading, font(26, "demi"), PURPLE_DARK, "lm")
        x += width
    for row_index, row in enumerate(rows):
        y = y0 + header_h + row_index * row_h
        if row_index % 2 == 1:
            draw.rectangle((x0, y, x1, y + row_h), fill="#FAFAFE")
        draw.line([(x0, y), (x1, y)], fill=LINE, width=2)
        x = x0
        for column_index, value in enumerate(row):
            width = total * widths[column_index]
            fill = INK
            weight = "medium"
            if headers[column_index] == "Significance":
                if value == "n.s.":
                    fill, weight = PEACH, "demi"
                else:
                    fill, weight = MINT, "demi"
            text(draw, (x + 24, y + row_h / 2), value, font(24, weight), fill, "lm")
            x += width
    table_bottom = y0 + header_h + row_h * len(rows)
    text(
        draw,
        (x0, table_bottom + 46),
        "Two settings are not significant \u2014 hedge those claims.",
        font(25, "medium"),
        MUTED,
    )
    text(
        draw,
        (x0, table_bottom + 92),
        "Report the interval, not only the mean.",
        font(25, "medium"),
        MUTED,
    )


def content_l12(draw, box):
    """Title and abstract information structure: numbered abstract sentences."""
    x0, y0, x1, y1 = box
    panel_w = 860
    card(draw, (x0, y0, x0 + panel_w, y1), 18, fill=PAPER, outline=LINE)
    text(draw, (x0 + 40, y0 + 36), "Contrastive Pretraining Improves", font(38, "bold"), INK)
    text(draw, (x0 + 40, y0 + 82), "Low-Resource Scientific Retrieval", font(38, "bold"), INK)
    text(draw, (x0 + 40, y0 + 142), "Abstract", font(28, "demi"), PURPLE_DARK)
    draw.line([(x0 + 40, y0 + 182), (x0 + panel_w - 40, y0 + 182)], fill=LINE, width=3)
    sentences = [
        ("1", "Scientific question answering needs reliable retrieval."),
        ("2", "However, labelled data is scarce outside English."),
        ("3", "We introduce a contrastive pretraining recipe for retrievers."),
        ("4", "It raises exact match by 4.1 points on three benchmarks."),
        ("5", "We release code and discuss remaining limits."),
    ]
    for order, (number, sentence) in enumerate(sentences):
        y = y0 + 214 + order * 76
        draw.ellipse((x0 + 40, y, x0 + 78, y + 38), fill=SKY)
        text(draw, (x0 + 59, y + 19), number, font(24, "bold"), PURPLE_DARK, "mm")
        text(draw, (x0 + 100, y + 19), sentence, font(25, "medium"), INK, "lm")
    notes = [
        ("Order", "Context -> gap -> method -> result -> impact", PURPLE),
        ("Title", "Says what changed, not just the topic", GOLD),
        ("Audience", "A specialist skims lines 2 and 4 first", MINT),
    ]
    base_x = x0 + panel_w + 46
    for order, (heading, detail, accent) in enumerate(notes):
        y = y0 + 60 + order * 190
        card(draw, (base_x, y, x1, y + 158), 18, fill=PAPER, outline=LINE)
        draw.rectangle((base_x, y + 20, base_x + 8, y + 138), fill=accent)
        text(draw, (base_x + 30, y + 28), heading, font(27, "demi"), INK)
        lines = wrap_text(draw, detail, 23, "medium", 300)
        for index, value in enumerate(lines):
            text(draw, (base_x + 30, y + 72 + index * 30), value, font(23, "medium"), MUTED)


def content_l13(draw, box):
    """A research statement around one figure: highlighted improvement line."""
    steps = ["0", "1", "2", "3", "4", "5"]
    series = [
        ("Ours (RAG-8B)", [63.0, 67.0, 72.0, 77.0, 81.0, 84.0], PURPLE),
        ("Baseline (Dense-8B)", [61.0, 63.0, 66.0, 68.0, 70.0, 72.0], "#C9C6E8"),
    ]
    plot = (box[0] + 150, box[1] + 16, box[2], box[3] - 46)
    points = line_chart(draw, plot, steps, series, "Exact match (%)", 55, 90, [60, 70, 80, 90])
    text(
        draw,
        ((plot[0] + plot[2]) / 2, plot[3] + 58),
        "Training steps",
        font(24, "demi"),
        MUTED,
        "ma",
    )
    proposed = points[0][1][-1]
    baseline = points[1][1][-1]
    draw.line([(proposed[0], proposed[1]), (proposed[0], baseline[1])], fill=MINT, width=5)
    text(
        draw,
        (proposed[0] - 18, (proposed[1] + baseline[1]) / 2),
        "+12 points at step 5",
        font(26, "demi"),
        MINT,
        "rm",
    )


# --------------------------------------------------------------------------- #
# Lessons                                                                     #
# --------------------------------------------------------------------------- #

FIGURES = [
    {
        "slug": "l02-presentation-structure",
        "label": "Lesson 2  \u00b7  Structuring an academic presentation",
        "title": "Sample talk outline",
        "base_prompt": (
            "Soft out-of-focus photograph of a modern university lecture room, "
            "empty seats and a blank screen, muted pastel colors, bright, airy, "
            "no people, no text, no letters, no words, no charts, no numbers"
        ),
        "painter": content_l02,
    },
    {
        "slug": "l03-talk-mainline",
        "label": "Lesson 3  \u00b7  Finding the main line of a talk",
        "title": "Structure signposts in a talk",
        "base_prompt": (
            "Soft blurred close-up of an auditorium stage with a faint projection "
            "glow, muted pastel tones, calm and clean, no people, no text, no "
            "letters, no words, no charts, no numbers"
        ),
        "painter": content_l03,
    },
    {
        "slug": "l05-paper-three-pass",
        "label": "Lesson 5  \u00b7  Three-pass reading of an AI paper",
        "title": "Paper front page and the three passes",
        "base_prompt": (
            "Soft blurred photograph of a tidy research desk with stacked blank "
            "papers, a closed notebook and a lamp, muted pastel colors, no text, "
            "no letters, no words, no charts, no numbers"
        ),
        "painter": content_l05,
    },
    {
        "slug": "l07-experimental-figure",
        "label": "Lesson 7  \u00b7  Explaining an experimental figure",
        "title": "Exact match versus baseline",
        "base_prompt": (
            "Soft blurred abstract photograph of a bright laboratory bench with "
            "glassware, shallow depth of field, muted pastel colors, no text, no "
            "letters, no words, no charts, no numbers"
        ),
        "painter": content_l07,
    },
    {
        "slug": "l10-results-boundaries",
        "label": "Lesson 10  \u00b7  Managing the boundaries of your results",
        "title": "Results with confidence intervals",
        "base_prompt": (
            "Soft blurred photograph of a dim seminar room with rows of empty "
            "seats and warm light, subdued pastel tones, no text, no letters, no "
            "words, no charts, no numbers"
        ),
        "painter": content_l10,
    },
    {
        "slug": "l12-title-abstract",
        "label": "Lesson 12  \u00b7  Title and abstract information structure",
        "title": "Title and abstract block",
        "base_prompt": (
            "Soft blurred photograph of an open book and a blank page on a wooden "
            "table, morning light, muted pastel colors, no text, no letters, no "
            "words, no charts, no numbers"
        ),
        "painter": content_l12,
    },
    {
        "slug": "l13-research-statement-figure",
        "label": "Lesson 13  \u00b7  A research statement around one figure",
        "title": "Improvement over the baseline",
        "base_prompt": (
            "Soft blurred photograph of a conference poster session hall, blank "
            "panels and soft daylight, muted pastel colors, no people, no text, "
            "no letters, no words, no charts, no numbers"
        ),
        "painter": content_l13,
    },
]


def compose(lesson: dict, base: Image.Image) -> Image.Image:
    canvas = backdrop(base)
    draw = ImageDraw.Draw(canvas)
    margin = 56
    card(draw, (margin, margin, CANVAS[0] - margin, CANVAS[1] - margin), 34)
    inner_x0 = margin + 44
    inner_x1 = CANVAS[0] - margin - 44
    text(draw, (inner_x0, margin + 40), lesson["label"], font(24, "demi"), PURPLE_DARK)
    text(draw, (inner_x0, margin + 76), lesson["title"], font(40, "bold"), INK)
    box = (inner_x0, margin + 172, inner_x1, CANVAS[1] - margin - 132)
    lesson["painter"](draw, box)
    # The "Illustrative figure - synthetic data" caption is rendered as HTML by
    # the client (see public/index.html) so it can follow the language toggle.
    return canvas


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose-only", action="store_true", help="reuse saved bases")
    parser.add_argument("--base-only", action="store_true", help="refresh bases only")
    parser.add_argument("--force", action="store_true", help="regenerate existing bases")
    parser.add_argument("--only", action="append", default=[], help="limit to a slug")
    options = parser.parse_args()

    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    targets = [lesson for lesson in FIGURES if not options.only or lesson["slug"] in options.only]
    if not targets:
        print("No matching lessons.")
        return 1

    for lesson in targets:
        slug = lesson["slug"]
        source_path = SOURCE_DIR / f"{slug}-base.png"
        output_path = FIGURES_DIR / f"{slug}.png"
        print(f"[{slug}]")

        if options.compose_only or (source_path.exists() and not options.force):
            base = Image.open(source_path).convert("RGB") if source_path.exists() else procedural_base(slug)
        else:
            print("  - painting backdrop with qwen-image")
            base = request_base(lesson["base_prompt"]) or procedural_base(slug)
            base.save(source_path)

        if options.base_only:
            continue

        compose(lesson, base).save(output_path, optimize=True)
        print(f"  - wrote {output_path.relative_to(ROOT)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
