"""Compatibility contract shared by SparkKit Receipts server/chat tooling.

Keep these aligned with receipts/app.js. They are the contract between the
phone PWA, chat intake, and server-side store.
"""

CATEGORIES = [
    "Tools",
    "Materials",
    "Fuel",
    "Vehicle",
    "PPE & Workwear",
    "Food & Drink",
    "Training",
    "Office & Admin",
    "Home Building",
    "Other",
]

RECEIPT_SCHEMA = {
    "type": "object",
    "properties": {
        "is_receipt": {"type": "boolean", "description": "False if the image is not a receipt, invoice or till docket."},
        "merchant": {"type": "string", "description": "Store or business name. Empty string if unreadable."},
        "date": {"anyOf": [{"type": "string", "description": "Purchase date, YYYY-MM-DD."}, {"type": "null"}]},
        "total": {"anyOf": [{"type": "number", "description": "Grand total paid."}, {"type": "null"}]},
        "gst": {"anyOf": [{"type": "number", "description": "GST / tax component if printed."}, {"type": "null"}]},
        "currency": {"type": "string", "description": "ISO 4217 code, e.g. AUD. Assume AUD if not shown."},
        "category": {"type": "string", "enum": CATEGORIES},
        "payment_method": {"anyOf": [{"type": "string", "description": "e.g. EFTPOS, Visa …1234, cash."}, {"type": "null"}]},
        "items": {
            "type": "array",
            "description": "Line items. Omit loyalty and subtotal lines.",
            "items": {
                "type": "object",
                "properties": {
                    "description": {"type": "string"},
                    "amount": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                },
                "required": ["description", "amount"],
                "additionalProperties": False,
            },
        },
        "notes": {"anyOf": [{"type": "string", "description": "Anything unclear or worth flagging."}, {"type": "null"}]},
    },
    "required": ["is_receipt", "merchant", "date", "total", "gst", "currency", "category", "payment_method", "items", "notes"],
    "additionalProperties": False,
}

PROMPT = (
    "Extract the data from this receipt photo. The user is an Australian electrical "
    "apprentice organising work expenses and home building expenses. Pick the category "
    "that best matches the purchase. If a value is not printed or not readable, use null "
    "rather than guessing."
)

# Inline-schema variant for backends without structured-output support
# (e.g. the OpenClaw CLI). Same contract, spelled out in the prompt.
PROMPT_INLINE_SCHEMA = (
    PROMPT
    + " Reply with ONLY a JSON object, no prose and no markdown fences, with keys: "
    "is_receipt (bool; false if not a receipt, invoice or till docket), "
    "merchant (string; empty if unreadable), date (YYYY-MM-DD or null), "
    "total (number or null), gst (number or null), "
    "currency (ISO 4217 code, assume AUD if not shown), "
    "category (one of: " + ", ".join(CATEGORIES) + "), "
    "payment_method (string like 'EFTPOS' or 'Visa …1234', or null), "
    "items (array of {description, amount} line items; omit loyalty and subtotal lines), "
    "notes (string or null; anything unclear or worth flagging, maximum 15 words)."
)
