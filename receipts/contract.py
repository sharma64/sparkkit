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
