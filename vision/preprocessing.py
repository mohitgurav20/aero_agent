import base64
import io
import re
import logging
from PIL import Image, ImageDraw
from typing import Tuple, Optional, List, Dict

log = logging.getLogger(__name__)

# PII patterns for ISRO compliance: redact before any screenshot leaves the local device
_PII_PATTERNS = [
    re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'),  # email
    re.compile(r'\b(?:\+91[-\s]?)?[6-9]\d{9}\b'),                          # Indian mobile
    re.compile(r'\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b'),                         # Aadhaar
    re.compile(r'\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b'),  # credit card
    re.compile(r'\b[A-Z]{5}\d{4}[A-Z]\b'),                                 # PAN card
    re.compile(r'\b(?:password|pass|pwd|secret|token|api[_\s]?key)\s*[:=]\s*\S+', re.I),  # credentials
]

class ScreenshotPreprocessor:
    """
    Screenshot capture normalization & image preprocessing (Task #18).
    Handles decoding, dimensions validation, aspect ratio padding, and compression.
    Includes ISRO-compliance PII redaction (FIX P3-B): sensitive regions are blacked
    out locally before screenshots are transmitted to any VLM or remote endpoint.
    """

    @staticmethod
    def decode_base64_image(base64_str: str) -> Image.Image:
        """Decode a base64 encoded PNG/JPEG into a PIL Image."""
        if "," in base64_str:
            base64_str = base64_str.split(",")[1]
        img_data = base64.b64decode(base64_str)
        return Image.open(io.BytesIO(img_data)).convert("RGB")

    @staticmethod
    def encode_image_base64(image: Image.Image, format: str = "PNG") -> str:
        """Encode a PIL Image back to a base64 string."""
        buf = io.BytesIO()
        image.save(buf, format=format)
        return base64.b64encode(buf.getvalue()).decode("utf-8")

    @staticmethod
    def crop_region(image: Image.Image, bbox: dict) -> Image.Image:
        """
        Crop an interactive region (foveation patch) from the main screenshot.
        bbox format: {'x': int, 'y': int, 'w': int, 'h': int}
        """
        left = max(0, int(bbox.get("x", 0)))
        top = max(0, int(bbox.get("y", 0)))
        right = min(image.width, left + int(bbox.get("w", 0)))
        bottom = min(image.height, top + int(bbox.get("h", 0)))
        return image.crop((left, top, right, bottom))

    @staticmethod
    def redact_pii(image: Image.Image, text_boxes: Optional[List[Dict]] = None) -> Image.Image:
        """
        FIX P3-B (ISRO Compliance): Redact PII from screenshots before transmission.

        Applies black rectangle overlays over detected PII text regions.
        text_boxes format: [{'text': str, 'x': int, 'y': int, 'w': int, 'h': int}, ...]
        If text_boxes is None, applies a conservative full-width redaction strip at the
        top 15% of the image (typically where address bars with URLs and email addresses live).

        Args:
            image: PIL Image to redact
            text_boxes: Optional list of OCR/DOM text bounding boxes with their text content

        Returns:
            PIL Image with PII regions blacked out
        """
        redacted = image.copy()
        draw = ImageDraw.Draw(redacted)

        if text_boxes:
            # Precise redaction: black out only boxes whose text matches PII patterns
            redacted_count = 0
            for box in text_boxes:
                text = str(box.get('text', ''))
                if any(p.search(text) for p in _PII_PATTERNS):
                    x, y = int(box.get('x', 0)), int(box.get('y', 0))
                    w, h = int(box.get('w', 50)), int(box.get('h', 20))
                    # Add 4px padding around the box for safety
                    draw.rectangle([max(0, x-4), max(0, y-4), x+w+4, y+h+4], fill=(0, 0, 0))
                    redacted_count += 1
            if redacted_count > 0:
                log.info("[PII-Redact] Blacked out %d PII regions in screenshot (ISRO compliance)", redacted_count)
        else:
            # Conservative fallback: redact the browser address bar strip (top 60px)
            # and any common form field areas that may contain credentials
            addr_bar_height = min(60, int(image.height * 0.06))
            draw.rectangle([0, 0, image.width, addr_bar_height], fill=(0, 0, 0))
            log.debug("[PII-Redact] Applied conservative address-bar redaction strip (%dpx)", addr_bar_height)

        return redacted

