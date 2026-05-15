from __future__ import annotations

from io import BytesIO
from time import perf_counter
from typing import Any, Dict, List, Tuple

from PIL import Image, ImageColor, ImageOps

from ... import service
from ..media_refs import graph_ref_path
from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


def _int_field(value: object, default: int) -> int:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        parsed = default
    return max(1, parsed)


def _format_field(value: object, default: str = "png") -> str:
    output_format = str(value or default).lower()
    if output_format not in {"png", "webp", "jpeg"}:
        raise ValueError("Unsupported image output format.")
    return output_format


def _save_reference_image(
    node: GraphWorkflowNode,
    image: Image.Image,
    output_format: str,
    prefix: str,
    *,
    metadata: Dict[str, Any] | None = None,
) -> Tuple[GraphOutputRef, int, int]:
    if output_format not in {"png", "webp", "jpeg"}:
        raise ValueError("Unsupported image output format.")
    save_format = "JPEG" if output_format == "jpeg" else output_format.upper()
    if save_format == "JPEG" and image.mode == "RGBA":
        image = image.convert("RGB")
    buffer = BytesIO()
    image.save(buffer, save_format, quality=90)
    record = service.import_reference_media_bytes(
        source_bytes=buffer.getvalue(),
        source_name=f"graph-{prefix}-{node.id}.{output_format}",
        source_mime_type=f"image/{'jpeg' if output_format == 'jpeg' else output_format}",
    )
    width, height = image.size
    return (
        GraphOutputRef(
            kind="reference_media",
            media_type="image",
            reference_id=record["reference_id"],
            metadata={"width": width, "height": height, "stored_path": record.get("stored_path"), **(metadata or {})},
        ),
        width,
        height,
    )


class ImageResizeExecutor(GraphExecutor):
    node_type = "image.resize"
    max_dimension = 4096

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "image")
        if not refs:
            raise ValueError("Resize Image requires an image input.")
        started = perf_counter()
        width = min(self.max_dimension, _int_field(node.fields.get("width"), 1024))
        height = min(self.max_dimension, _int_field(node.fields.get("height"), 1024))
        fit = str(node.fields.get("fit") or "contain")
        output_format = _format_field(node.fields.get("format"))

        source_path = graph_ref_path(refs[0], expected_media_type="image")
        with Image.open(source_path) as image:
            normalized = ImageOps.exif_transpose(image)
            if normalized.mode not in {"RGB", "RGBA"}:
                normalized = normalized.convert("RGB")
            resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.LANCZOS)
            if fit == "stretch":
                resized = normalized.resize((width, height), resampling)
            elif fit == "cover":
                resized = ImageOps.fit(normalized, (width, height), method=resampling)
            else:
                resized = normalized.copy()
                resized.thumbnail((width, height), resampling)

            output_ref, output_width, output_height = _save_reference_image(node, resized, output_format, "resize")

        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        context.record_node_metric(node, "output_width", output_width)
        context.record_node_metric(node, "output_height", output_height)
        return {"image": [output_ref]}


class ImageTransformExecutor(GraphExecutor):
    node_type = "image.transform"
    max_dimension = 4096

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "image")
        if not refs:
            raise ValueError("Image Transform requires an image input.")
        started = perf_counter()
        operation = str(node.fields.get("operation") or "resize")
        output_format = _format_field(node.fields.get("format"))
        source_path = graph_ref_path(refs[0], expected_media_type="image")
        metadata: Dict[str, Any] = {"operation": operation}

        with Image.open(source_path) as image:
            normalized = ImageOps.exif_transpose(image)
            source_metadata = {
                "width": normalized.width,
                "height": normalized.height,
                "mode": normalized.mode,
                "format": image.format,
            }
            if operation == "extract_metadata":
                context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
                return {"metadata": [GraphOutputRef(kind="value", media_type="json", value={**source_metadata, "operation": operation})]}

            if normalized.width > self.max_dimension or normalized.height > self.max_dimension:
                raise ValueError("Image Transform source exceeds the maximum dimension.")
            if normalized.mode not in {"RGB", "RGBA"}:
                normalized = normalized.convert("RGB")

            if operation == "resize":
                width = min(self.max_dimension, _int_field(node.fields.get("width"), 1024))
                height = min(self.max_dimension, _int_field(node.fields.get("height"), 1024))
                fit = str(node.fields.get("fit") or "contain")
                resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.LANCZOS)
                if fit == "stretch":
                    transformed = normalized.resize((width, height), resampling)
                elif fit == "cover":
                    transformed = ImageOps.fit(normalized, (width, height), method=resampling)
                else:
                    transformed = normalized.copy()
                    transformed.thumbnail((width, height), resampling)
                metadata.update({"width": width, "height": height, "fit": fit})
            elif operation == "crop":
                x = max(0, int(node.fields.get("x") or 0))
                y = max(0, int(node.fields.get("y") or 0))
                width = _int_field(node.fields.get("width"), 512)
                height = _int_field(node.fields.get("height"), 512)
                right = min(normalized.width, x + width)
                lower = min(normalized.height, y + height)
                if right <= x or lower <= y:
                    raise ValueError("Image Transform crop rectangle is outside the image.")
                transformed = normalized.crop((x, y, right, lower))
                metadata.update({"crop_rect": {"x": x, "y": y, "width": right - x, "height": lower - y}})
            elif operation == "pad":
                width = _int_field(node.fields.get("width"), 1024)
                height = _int_field(node.fields.get("height"), 1024)
                try:
                    fill = ImageColor.getcolor(str(node.fields.get("color") or "#000000"), "RGBA")
                except ValueError as exc:
                    raise ValueError("Image Transform canvas color must be a valid CSS color or hex value.") from exc
                source_rgba = normalized.convert("RGBA")
                if width < source_rgba.width or height < source_rgba.height:
                    raise ValueError("Image Transform pad dimensions must be greater than or equal to source image dimensions.")
                transformed = Image.new("RGBA", (width, height), fill)
                transformed.alpha_composite(source_rgba, ((width - source_rgba.width) // 2, (height - source_rgba.height) // 2))
                metadata.update({"width": width, "height": height, "color": str(node.fields.get("color") or "#000000")})
            elif operation == "convert_format":
                transformed = normalized
            else:
                raise ValueError("Image Transform operation must be resize, crop, pad, convert_format, or extract_metadata.")

            output_ref, output_width, output_height = _save_reference_image(
                node,
                transformed,
                output_format,
                f"transform-{operation}",
                metadata={
                    "lineage": {
                        "transform_type": f"image.transform.{operation}",
                        "transform_params": metadata,
                    },
                },
            )

        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        context.record_node_metric(node, "output_width", output_width)
        context.record_node_metric(node, "output_height", output_height)
        return {
            "image": [output_ref],
            "metadata": [GraphOutputRef(kind="value", media_type="json", value={**metadata, "output_width": output_width, "output_height": output_height})],
        }


class ImageGridSliceExecutor(GraphExecutor):
    node_type = "image.grid_slice"
    max_cells = 25
    max_dimension = 4096

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "image")
        if not refs:
            raise ValueError("Grid Slice Image requires an image input.")
        started = perf_counter()
        rows = min(5, _int_field(node.fields.get("rows"), 2))
        columns = min(5, _int_field(node.fields.get("columns"), 2))
        if rows * columns > self.max_cells:
            raise ValueError("Grid Slice Image supports at most 25 cells.")
        gutter_mode = str(node.fields.get("gutter_mode") or "auto")
        if gutter_mode not in {"none", "auto", "fixed"}:
            raise ValueError("Grid Slice Image gutter mode must be none, auto, or fixed.")
        gutter_px = max(0, int(node.fields.get("gutter_px") or 0))
        if gutter_mode == "none":
            gutter_px = 0
        output_format = _format_field(node.fields.get("format"))
        trim_outer_gutter = bool(node.fields.get("trim_outer_gutter", True))

        source_path = graph_ref_path(refs[0], expected_media_type="image")
        output_refs: List[GraphOutputRef] = []
        slices: List[Dict[str, Any]] = []
        with Image.open(source_path) as image:
            normalized = ImageOps.exif_transpose(image)
            if normalized.width > self.max_dimension or normalized.height > self.max_dimension:
                raise ValueError("Grid Slice Image source exceeds the maximum dimension.")
            left_margin = gutter_px if trim_outer_gutter else 0
            top_margin = gutter_px if trim_outer_gutter else 0
            right_margin = gutter_px if trim_outer_gutter else 0
            bottom_margin = gutter_px if trim_outer_gutter else 0
            usable_width = normalized.width - left_margin - right_margin - gutter_px * max(0, columns - 1)
            usable_height = normalized.height - top_margin - bottom_margin - gutter_px * max(0, rows - 1)
            if usable_width <= 0 or usable_height <= 0:
                raise ValueError("Grid Slice Image gutter settings leave no usable image area.")
            cell_width = usable_width // columns
            cell_height = usable_height // rows
            if cell_width <= 0 or cell_height <= 0:
                raise ValueError("Grid Slice Image cell dimensions are too small.")
            for row in range(rows):
                for column in range(columns):
                    left = left_margin + column * (cell_width + gutter_px)
                    upper = top_margin + row * (cell_height + gutter_px)
                    right = normalized.width - right_margin if column == columns - 1 else left + cell_width
                    lower = normalized.height - bottom_margin if row == rows - 1 else upper + cell_height
                    crop_rect = {"x": left, "y": upper, "width": right - left, "height": lower - upper}
                    cropped = normalized.crop((left, upper, right, lower))
                    output_ref, output_width, output_height = _save_reference_image(
                        node,
                        cropped,
                        output_format,
                        f"grid-slice-r{row + 1}-c{column + 1}",
                        metadata={
                            "row": row + 1,
                            "column": column + 1,
                            "rows": rows,
                            "columns": columns,
                            "crop_rect": crop_rect,
                            "lineage": {
                                "transform_type": "image.grid_slice",
                                "transform_params": {
                                    "rows": rows,
                                    "columns": columns,
                                    "gutter_mode": gutter_mode,
                                    "gutter_px": gutter_px,
                                    "trim_outer_gutter": trim_outer_gutter,
                                    "crop_rect": crop_rect,
                                },
                            },
                        },
                    )
                    output_refs.append(output_ref)
                    slices.append(
                        {
                            "index": len(slices) + 1,
                            "row": row + 1,
                            "column": column + 1,
                            "crop_rect": crop_rect,
                            "width": output_width,
                            "height": output_height,
                            "reference_id": output_ref.reference_id,
                        }
                    )
        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        context.record_node_metric(node, "slice_count", len(output_refs))
        return {
            "images": output_refs,
            "metadata": [
                GraphOutputRef(
                    kind="value",
                    media_type="json",
                    value={
                        "rows": rows,
                        "columns": columns,
                        "slice_count": len(output_refs),
                        "gutter_mode": gutter_mode,
                        "gutter_px": gutter_px,
                        "slices": slices,
                    },
                )
            ],
        }


class ImageSplitExecutor(GraphExecutor):
    node_type = "image.split"
    max_outputs = 25

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "images")
        if not refs:
            raise ValueError("Split Images requires image inputs.")
        output_count = min(self.max_outputs, _int_field(node.fields.get("outputs"), min(len(refs), 4)))
        if output_count > len(refs):
            raise ValueError(f"Split Images requested {output_count} outputs but only received {len(refs)} images.")

        outputs: Dict[str, List[GraphOutputRef]] = {}
        for index in range(output_count):
            ref = refs[index]
            if ref.media_type and ref.media_type != "image":
                raise ValueError("Split Images expected image inputs.")
            outputs[f"image_{index + 1}"] = [
                ref.model_copy(
                    update={
                        "metadata": {
                            **ref.metadata,
                            "split_index": index + 1,
                            "split_output_count": output_count,
                            "lineage": {
                                "parent_artifact_id": ref.metadata.get("artifact_id"),
                                "parent_asset_id": ref.asset_id,
                                "parent_reference_id": ref.reference_id,
                                "transform_type": "image.split",
                                "transform_params": {
                                    "index": index + 1,
                                    "outputs": output_count,
                                },
                            },
                        }
                    }
                )
            ]
        context.record_node_metric(node, "split_output_count", output_count)
        context.record_node_metric(node, "input_image_count", len(refs))
        return outputs


class ImageCropExecutor(GraphExecutor):
    node_type = "image.crop"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "image")
        if not refs:
            raise ValueError("Crop Image requires an image input.")
        started = perf_counter()
        x = max(0, int(node.fields.get("x") or 0))
        y = max(0, int(node.fields.get("y") or 0))
        width = _int_field(node.fields.get("width"), 512)
        height = _int_field(node.fields.get("height"), 512)
        output_format = _format_field(node.fields.get("format"))
        source_path = graph_ref_path(refs[0], expected_media_type="image")
        with Image.open(source_path) as image:
            normalized = ImageOps.exif_transpose(image)
            right = min(normalized.width, x + width)
            lower = min(normalized.height, y + height)
            if right <= x or lower <= y:
                raise ValueError("Crop rectangle is outside the image.")
            cropped = normalized.crop((x, y, right, lower))
            output_ref, output_width, output_height = _save_reference_image(node, cropped, output_format, "crop")
        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        context.record_node_metric(node, "output_width", output_width)
        context.record_node_metric(node, "output_height", output_height)
        return {"image": [output_ref]}


class ImagePadExecutor(GraphExecutor):
    node_type = "image.pad"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "image")
        if not refs:
            raise ValueError("Pad Image requires an image input.")
        started = perf_counter()
        width = _int_field(node.fields.get("width"), 1024)
        height = _int_field(node.fields.get("height"), 1024)
        output_format = _format_field(node.fields.get("format"))
        try:
            fill = ImageColor.getcolor(str(node.fields.get("color") or "#000000"), "RGBA")
        except ValueError as exc:
            raise ValueError("Pad Image color must be a valid CSS color or hex value.") from exc
        source_path = graph_ref_path(refs[0], expected_media_type="image")
        with Image.open(source_path) as image:
            normalized = ImageOps.exif_transpose(image).convert("RGBA")
            if width < normalized.width or height < normalized.height:
                raise ValueError("Pad dimensions must be greater than or equal to source image dimensions.")
            canvas = Image.new("RGBA", (width, height), fill)
            canvas.alpha_composite(normalized, ((width - normalized.width) // 2, (height - normalized.height) // 2))
            output_ref, output_width, output_height = _save_reference_image(node, canvas, output_format, "pad")
        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        context.record_node_metric(node, "output_width", output_width)
        context.record_node_metric(node, "output_height", output_height)
        return {"image": [output_ref]}


class ImageConvertFormatExecutor(GraphExecutor):
    node_type = "image.convert_format"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "image")
        if not refs:
            raise ValueError("Convert Image Format requires an image input.")
        started = perf_counter()
        output_format = _format_field(node.fields.get("format"))
        source_path = graph_ref_path(refs[0], expected_media_type="image")
        with Image.open(source_path) as image:
            normalized = ImageOps.exif_transpose(image)
            output_ref, output_width, output_height = _save_reference_image(node, normalized, output_format, "convert")
        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        context.record_node_metric(node, "output_width", output_width)
        context.record_node_metric(node, "output_height", output_height)
        return {"image": [output_ref]}


class ImageExtractMetadataExecutor(GraphExecutor):
    node_type = "image.extract_metadata"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "image")
        if not refs:
            raise ValueError("Extract Image Metadata requires an image input.")
        started = perf_counter()
        source_path = graph_ref_path(refs[0], expected_media_type="image")
        with Image.open(source_path) as image:
            metadata = {
                "width": image.width,
                "height": image.height,
                "mode": image.mode,
                "format": image.format,
            }
        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        return {"json": [GraphOutputRef(kind="value", media_type="json", value=metadata)]}
