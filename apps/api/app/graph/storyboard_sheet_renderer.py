from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Sequence

from PIL import Image, ImageDraw, ImageFont, ImageOps

from .storyboard_sheet_spec import (
    PRODUCTION_METADATA_KEYS,
    StoryboardSheetSpec,
    storyboard_final_grid_for_panel_count,
    storyboard_source_grid_for_panel_count,
    storyboard_source_grid_id_for_panel_count,
)


SHEET_WIDTH = 2048
SHEET_HEIGHT = 1152
SQUARE_SHEET_HEIGHT = 2048
SHEET_METADATA_LABELS = ("CAMERA", "ACTION", "MOTION", "DIALOG", "NOTES")
_BODY_FONT_CANDIDATES = (
    Path("/System/Library/Fonts/Supplemental/Arial Narrow.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf"),
    Path("/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Regular.ttf"),
    Path("C:/Windows/Fonts/arialn.ttf"),
    Path(__file__).with_name("assets") / "DejaVuSans.ttf",
    Path("/System/Library/Fonts/SFNS.ttf"),
    Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
    Path("C:/Windows/Fonts/arial.ttf"),
)
_DISPLAY_FONT_CANDIDATES = (
    Path("/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf"),
    Path("/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf"),
    Path("/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Bold.ttf"),
    Path("C:/Windows/Fonts/arialnb.ttf"),
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    Path("C:/Windows/Fonts/arialbd.ttf"),
)


@dataclass(frozen=True)
class StoryboardSheetRenderResult:
    image: Image.Image
    metadata: dict[str, Any]


@lru_cache(maxsize=2)
def _font_path(role: str = "body") -> Path:
    candidates = _DISPLAY_FONT_CANDIDATES if role == "display" else _BODY_FONT_CANDIDATES
    for path in candidates:
        if not path.is_file():
            continue
        try:
            font = ImageFont.truetype(str(path), 12)
        except OSError:
            continue
        if font.getmask("—“”’").getbbox():
            return path
    raise ValueError("Storyboard Sheet requires a Unicode TrueType font for exact metadata rendering.")


@lru_cache(maxsize=64)
def _font(size: int, role: str = "body") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(_font_path(role)), size)


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, width: int) -> list[str]:
    if not text:
        return []
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= width:
            current = candidate
            continue
        if not current:
            raise ValueError(f"Storyboard metadata contains an unbreakable token that exceeds its row: {word!r}.")
        lines.append(current)
        current = word
    if current:
        lines.append(current)
    return lines


def _fit_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    *,
    width: int,
    height: int,
    max_size: int,
    min_size: int,
    role: str = "body",
    minimum_bottom_clearance: int = 1,
) -> tuple[ImageFont.ImageFont, list[str], int]:
    for size in range(max_size, min_size - 1, -1):
        font = _font(size, role)
        lines = _wrap(draw, text, font, width)
        bbox = draw.textbbox((0, 0), "Ag", font=font)
        line_height = max(1, bbox[3] - bbox[1] + 1)
        line_boxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
        block_top = min(box[1] + line_index * line_height for line_index, box in enumerate(line_boxes))
        block_bottom = max(box[3] + line_index * line_height for line_index, box in enumerate(line_boxes))
        block_height = block_bottom - block_top
        upper_inset = max(1, (height - block_height) // 2)
        bottom_clearance = height - (upper_inset + block_height - 1)
        if len(lines) * line_height <= height and bottom_clearance >= minimum_bottom_clearance:
            return font, lines, line_height
    raise ValueError("Storyboard metadata cannot fit its deterministic row without clipping.")


def _source_grid_panels(image: Image.Image, *, panel_count: int) -> list[Image.Image]:
    columns, rows = storyboard_source_grid_for_panel_count(panel_count)
    panels: list[Image.Image] = []
    for row in range(rows):
        upper = round(row * image.height / rows)
        lower = round((row + 1) * image.height / rows)
        for column in range(columns):
            left = round(column * image.width / columns)
            right = round((column + 1) * image.width / columns)
            panels.append(image.crop((left, upper, right, lower)))
    return panels


def _normalize_panels(images: Sequence[Image.Image], *, panel_count: int) -> tuple[list[Image.Image], str]:
    if len(images) == 1:
        source = ImageOps.exif_transpose(images[0]).convert("RGB")
        source_grid = storyboard_source_grid_id_for_panel_count(panel_count)
        input_mode = "wide_2x3_source_grid" if panel_count == 6 else f"source_grid_{source_grid}"
        return _source_grid_panels(source, panel_count=panel_count), input_mode
    if len(images) == panel_count:
        ordered_label = {4: "four", 6: "six", 9: "nine"}[panel_count]
        return [ImageOps.exif_transpose(image).convert("RGB") for image in images], f"{ordered_label}_ordered_images"
    source_grid = storyboard_source_grid_id_for_panel_count(panel_count)
    raise ValueError(
        f"Storyboard sheet composition requires one {source_grid} source grid or exactly "
        f"{panel_count} ordered images."
    )


def _sheet_dimensions(panel_count: int) -> tuple[int, int]:
    if panel_count == 6:
        return (SHEET_WIDTH, SHEET_HEIGHT)
    if panel_count in {4, 9}:
        return (SHEET_WIDTH, SQUARE_SHEET_HEIGHT)
    raise ValueError("Storyboard sheet renderer supports only 4, 6, or 9 panels.")


def render_storyboard_sheet(images: Sequence[Image.Image], spec: StoryboardSheetSpec) -> StoryboardSheetRenderResult:
    panel_count = len(spec.panels)
    columns, rows = storyboard_final_grid_for_panel_count(panel_count)
    sheet_width, sheet_height = _sheet_dimensions(panel_count)
    panels, input_mode = _normalize_panels(images, panel_count=panel_count)
    canvas = Image.new("RGB", (sheet_width, sheet_height), "#080a0d")
    draw = ImageDraw.Draw(canvas)
    amber = "#f2a21a"
    muted = "#c2c6ca"
    text_color = "#f3f4f5"
    row_rule = "#665126"
    row_fill = "#0c0f13"

    outer_frame = (8, 4, sheet_width - 8, sheet_height - 4)
    draw.rectangle(outer_frame, outline=amber, width=2)

    margin_x = 14
    header_y = 7
    header_height = 44
    title_width = 660
    header_gap = 12
    strip_x = margin_x + title_width + header_gap
    strip_width = sheet_width - margin_x - strip_x
    grid_top = 58
    grid_bottom = sheet_height - 10
    column_gap = 8
    row_gap = 8
    base_panel_width = (sheet_width - margin_x * 2 - column_gap * (columns - 1)) // columns
    panel_widths = [base_panel_width] * columns
    panel_widths[-1] = sheet_width - margin_x * 2 - column_gap * (columns - 1) - sum(panel_widths[:-1])
    panel_height = (grid_bottom - grid_top - row_gap * (rows - 1)) // rows
    heading_height = 36
    image_height = round(min(panel_widths) / 1.9)
    metadata_height = panel_height - heading_height - image_height

    title_font, title_lines, title_line_height = _fit_text(
        draw,
        spec.board_title,
        width=title_width - 8,
        height=header_height - 4,
        max_size=30,
        min_size=26,
        role="display",
    )
    for line_index, line in enumerate(title_lines):
        draw.text(
            (margin_x + 4, header_y + 5 + line_index * title_line_height),
            line,
            font=title_font,
            fill=amber,
        )

    strip_weights = (0.18, 0.16, 0.36, 0.14, 0.16)
    strip_widths = [round(strip_width * weight) for weight in strip_weights[:-1]]
    strip_widths.append(strip_width - sum(strip_widths))
    production_label_font = _font(12, "display")
    strip_left = strip_x
    production_value_sizes: list[int] = []
    for index, key in enumerate(PRODUCTION_METADATA_KEYS):
        left = strip_left
        right = left + strip_widths[index]
        strip_left = right
        label = f"{key}:"
        draw.text((left + 3, header_y + 16), label, font=production_label_font, fill=amber)
        label_width = round(draw.textlength(label, font=production_label_font)) + 7
        value = spec.production_metadata[key]
        value_font, value_lines, value_line_height = _fit_text(
            draw,
            value,
            width=right - left - label_width - 5,
            height=header_height - 10,
            max_size=14,
            min_size=11,
        )
        production_value_sizes.append(int(getattr(value_font, "size", 11)))
        for line_index, line in enumerate(value_lines):
            draw.text(
                (left + label_width, header_y + 15 + line_index * value_line_height),
                line,
                font=value_font,
                fill=text_color,
            )
    draw.line((margin_x, header_y + header_height, sheet_width - margin_x, header_y + header_height), fill=amber, width=1)

    panel_geometry: list[dict[str, int]] = []
    metadata_label_font = _font(14, "display")
    for index, (panel_image, panel_spec) in enumerate(zip(panels, spec.panels)):
        row = index // columns
        column = index % columns
        x = margin_x + sum(panel_widths[:column]) + column * column_gap
        y = grid_top + row * (panel_height + row_gap)
        panel_width = panel_widths[column]
        heading_rect = (x, y, x + panel_width, y + heading_height)
        draw.rectangle(heading_rect, fill=row_fill, outline=amber, width=1)
        heading_font, heading_lines, heading_line_height = _fit_text(
            draw,
            panel_spec.shot,
            width=panel_width - 16,
            height=heading_height - 6,
            max_size=20,
            min_size=18,
            role="display",
        )
        for line_index, line in enumerate(heading_lines):
            draw.text(
                (
                    x + 9,
                    y + max(2, (heading_height - len(heading_lines) * heading_line_height) // 2)
                    + line_index * heading_line_height,
                ),
                line,
                font=heading_font,
                fill=text_color,
            )

        image_y = y + heading_height
        image_rect = (x, image_y, x + panel_width, image_y + image_height)
        fitted = ImageOps.fit(panel_image, (panel_width, image_height), method=Image.Resampling.LANCZOS)
        canvas.paste(fitted, (x, image_y))
        draw.rectangle(image_rect, outline=amber, width=2)

        values = {
            "CAMERA": panel_spec.camera,
            "ACTION": panel_spec.action,
            "MOTION": panel_spec.motion,
            "DIALOG": panel_spec.dialog,
            "NOTES": panel_spec.notes,
        }
        row_heights = [metadata_height // len(SHEET_METADATA_LABELS)] * len(SHEET_METADATA_LABELS)
        row_heights[-1] += metadata_height - sum(row_heights)
        metadata_y = image_y + image_height
        metadata_label_width = 88
        minimum_metadata_font_size = 99
        for row_index, label in enumerate(SHEET_METADATA_LABELS):
            row_y = metadata_y + sum(row_heights[:row_index])
            row_height = row_heights[row_index]
            draw.rectangle(
                (x, row_y, x + panel_width, row_y + row_height),
                fill=row_fill,
                outline=row_rule,
                width=1,
            )
            draw.line(
                (x + metadata_label_width - 7, row_y + 1, x + metadata_label_width - 7, row_y + row_height - 1),
                fill=amber,
                width=1,
            )
            label_bbox = draw.textbbox((0, 0), label, font=metadata_label_font)
            label_height = label_bbox[3] - label_bbox[1]
            draw.text(
                (x + 7, row_y + max(2, (row_height - label_height) // 2 - label_bbox[1])),
                label,
                font=metadata_label_font,
                fill=amber,
            )
            value = values[label]
            if not value:
                continue
            value_font, lines, line_height = _fit_text(
                draw,
                value,
                width=panel_width - metadata_label_width - 10,
                height=row_height,
                max_size=15,
                min_size=14,
                minimum_bottom_clearance=3,
            )
            minimum_metadata_font_size = min(minimum_metadata_font_size, int(getattr(value_font, "size", 14)))
            line_boxes = [draw.textbbox((0, 0), line, font=value_font) for line in lines]
            block_top = min(box[1] + line_index * line_height for line_index, box in enumerate(line_boxes))
            block_bottom = max(box[3] + line_index * line_height for line_index, box in enumerate(line_boxes))
            block_height = block_bottom - block_top
            value_y = row_y + max(1, (row_height - block_height) // 2) - block_top
            for line_index, line in enumerate(lines):
                draw.text(
                    (x + metadata_label_width, value_y + line_index * line_height),
                    line,
                    font=value_font,
                    fill=text_color if label != "DIALOG" else muted,
                )
        panel_geometry.append(
            {
                "panel": panel_spec.number,
                "x": x,
                "y": y,
                "width": panel_width,
                "height": panel_height,
                "heading_height": heading_height,
                "heading_text": panel_spec.shot,
                "heading_font_size": int(getattr(heading_font, "size", 18)),
                "image_height": image_height,
                "metadata_height": metadata_height,
                "metadata_row_count": len(SHEET_METADATA_LABELS),
                "metadata_label_width": metadata_label_width,
                "minimum_metadata_font_size": minimum_metadata_font_size if minimum_metadata_font_size != 99 else 15,
            }
        )

    return StoryboardSheetRenderResult(
        image=canvas,
        metadata={
            "contract_id": spec.contract_id,
            "contract_version": spec.contract_version,
            "layout_id": spec.layout_id,
            "layout_version": spec.layout_version,
            "width": SHEET_WIDTH,
            "height": sheet_height,
            "panel_count": panel_count,
            "grid": {"columns": columns, "rows": rows},
            "font_family": _font_path("body").stem,
            "display_font_family": _font_path("display").stem,
            "body_font_family": _font_path("body").stem,
            "input_mode": input_mode,
            "visible_metadata_labels": list(SHEET_METADATA_LABELS),
            "presentation": {
                "outer_frame": "thin_amber",
                "production_strip": "unified_inline",
                "metadata_surface": "near_black",
                "shot_placement": "heading_only",
            },
            "header_geometry": {
                "x": margin_x,
                "y": header_y,
                "height": header_height,
                "title_width": title_width,
                "title_font_size": int(getattr(title_font, "size", 26)),
                "production_label_font_size": int(getattr(production_label_font, "size", 12)),
                "production_value_font_size": min(production_value_sizes),
                "production_strip_x": strip_x,
                "production_strip_width": strip_width,
                "grid_top": grid_top,
            },
            "art_safe_frame": {
                "target_aspect_ratio": "1.9:1",
                "vertical_safe_band_percent": 58,
            },
            "panel_geometry": panel_geometry,
        },
    )
