ASSISTANT_IMAGE_ATTACHMENT_LIMIT = 8


def is_image_attachment(attachment: dict) -> bool:
    return str(attachment.get("kind") or "").lower() in {"image", "reference_image"}
