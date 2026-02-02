"""
Document Verification Server - Local ML processing

Runs locally, no API costs, builds training data.

Stack:
- FastAPI for HTTP interface
- YOLOv8 for document classification + field detection
- EasyOCR for text extraction (better than Tesseract for some docs)
- OpenCV for image preprocessing

Training pipeline:
1. Every verified document becomes training data
2. Periodically retrain model on accumulated data
3. Model improves with usage (our moat)

Start: uvicorn server:app --port 8765
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import io
import os
import re
import json
from datetime import datetime
from pathlib import Path

# Optional imports - graceful fallback if not installed
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False
    print("YOLOv8 not installed. Run: pip install ultralytics")

try:
    import easyocr
    EASYOCR_AVAILABLE = True
except ImportError:
    EASYOCR_AVAILABLE = False
    print("EasyOCR not installed. Run: pip install easyocr")

try:
    import cv2
    import numpy as np
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    print("OpenCV not installed. Run: pip install opencv-python")


app = FastAPI(title="Nuke Document Verification", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
MODEL_PATH = Path(__file__).parent / "models"
TRAINING_DATA_PATH = Path(__file__).parent / "training_data"
MODEL_PATH.mkdir(exist_ok=True)
TRAINING_DATA_PATH.mkdir(exist_ok=True)

# Initialize models (lazy load)
yolo_model = None
ocr_reader = None


def get_yolo_model():
    """Load YOLOv8 model for document classification"""
    global yolo_model
    if yolo_model is None and YOLO_AVAILABLE:
        custom_model = MODEL_PATH / "doc_classifier.pt"
        if custom_model.exists():
            print(f"Loading custom model: {custom_model}")
            yolo_model = YOLO(str(custom_model))
        else:
            # Start with pretrained, will finetune later
            print("Loading base YOLOv8 model (will finetune for documents)")
            yolo_model = YOLO("yolov8n-cls.pt")  # Classification model
    return yolo_model


def get_ocr_reader():
    """Load EasyOCR reader"""
    global ocr_reader
    if ocr_reader is None and EASYOCR_AVAILABLE:
        print("Loading EasyOCR...")
        ocr_reader = easyocr.Reader(['en'], gpu=False)
    return ocr_reader


# Response models
class VerificationResult(BaseModel):
    document_type: str  # title, drivers_license, passport, registration, unknown
    confidence: float
    method: str  # yolo, ocr, hybrid
    extracted: dict
    issues: List[str]
    processing_time_ms: int


class VINResult(BaseModel):
    vin: Optional[str]
    valid: bool
    confidence: float
    errors: List[str]


# VIN validation
def validate_vin(vin: str) -> dict:
    """Validate VIN with check digit"""
    normalized = re.sub(r'[^A-HJ-NPR-Z0-9]', '', vin.upper())
    errors = []

    if len(normalized) != 17:
        if len(normalized) < 4 or len(normalized) > 17:
            errors.append(f"Invalid length: {len(normalized)}")

    if re.search(r'[IOQ]', vin, re.I):
        errors.append("VIN cannot contain I, O, or Q")

    if not re.search(r'\d', normalized):
        errors.append("VIN must contain at least one digit")

    # Check digit validation for 17-char VINs
    if len(normalized) == 17 and not errors:
        weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
        trans = {
            'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'H': 8,
            'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'P': 7, 'R': 9,
            'S': 2, 'T': 3, 'U': 4, 'V': 5, 'W': 6, 'X': 7, 'Y': 8, 'Z': 9
        }

        total = sum(
            (int(c) if c.isdigit() else trans.get(c, 0)) * weights[i]
            for i, c in enumerate(normalized)
        )
        check = total % 11
        expected = 'X' if check == 10 else str(check)

        if normalized[8] != expected:
            errors.append(f"Check digit mismatch (expected {expected})")

    return {
        "valid": len(errors) == 0,
        "normalized": normalized,
        "errors": errors
    }


def extract_vin(text: str) -> Optional[str]:
    """Extract VIN from OCR text"""
    upper = text.upper()

    # Labeled patterns
    labeled = re.findall(
        r'(?:VIN|VEHICLE\s*ID|CHASSIS|SERIAL)\s*[:#.\s]*([A-HJ-NPR-Z0-9]{17})',
        upper
    )
    for match in labeled:
        result = validate_vin(match)
        if result["valid"]:
            return result["normalized"]

    # Standalone 17-char
    standalone = re.findall(r'\b([A-HJ-NPR-Z0-9]{17})\b', upper)
    for match in standalone:
        result = validate_vin(match)
        if result["valid"]:
            return result["normalized"]

    return None


def preprocess_image(image_bytes: bytes) -> np.ndarray:
    """Preprocess image for better OCR"""
    if not CV2_AVAILABLE:
        return None

    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    # Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Denoise
    denoised = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)

    # Adaptive threshold for better text contrast
    thresh = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
    )

    return thresh


def detect_document_type(text: str) -> tuple:
    """Detect document type from text patterns"""
    upper = text.upper()

    scores = {
        'title': 0,
        'drivers_license': 0,
        'passport': 0,
        'registration': 0
    }

    # Title keywords
    for kw in ['CERTIFICATE OF TITLE', 'VEHICLE TITLE', 'MOTOR VEHICLE',
               'DMV', 'LIENHOLDER', 'VIN', 'TITLE']:
        if kw in upper:
            scores['title'] += 1

    # Driver's license keywords
    for kw in ['DRIVER', 'LICENSE', 'CLASS', 'DOB', 'DL', 'RESTRICTIONS']:
        if kw in upper:
            scores['drivers_license'] += 1

    # Passport keywords
    for kw in ['PASSPORT', 'NATIONALITY', 'GIVEN NAMES', 'SURNAME']:
        if kw in upper:
            scores['passport'] += 1

    # Registration keywords
    for kw in ['REGISTRATION', 'PLATE', 'LICENSE PLATE']:
        if kw in upper:
            scores['registration'] += 1

    best_type = max(scores, key=scores.get)
    best_score = scores[best_type]

    if best_score >= 2:
        confidence = min(0.95, 0.5 + best_score * 0.1)
        return best_type, confidence

    return 'unknown', 0.3


def save_training_sample(image_bytes: bytes, result: dict, doc_type: str):
    """Save verified document as training data"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    type_dir = TRAINING_DATA_PATH / doc_type
    type_dir.mkdir(exist_ok=True)

    # Save image
    img_path = type_dir / f"{timestamp}.jpg"
    with open(img_path, "wb") as f:
        f.write(image_bytes)

    # Save annotation
    anno_path = type_dir / f"{timestamp}.json"
    with open(anno_path, "w") as f:
        json.dump({
            "document_type": doc_type,
            "confidence": result.get("confidence"),
            "extracted": result.get("extracted"),
            "timestamp": timestamp
        }, f, indent=2)

    print(f"Saved training sample: {img_path}")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "yolo_available": YOLO_AVAILABLE,
        "easyocr_available": EASYOCR_AVAILABLE,
        "opencv_available": CV2_AVAILABLE,
        "models_path": str(MODEL_PATH),
        "training_samples": sum(1 for _ in TRAINING_DATA_PATH.rglob("*.jpg"))
    }


@app.post("/verify", response_model=VerificationResult)
async def verify_document(file: UploadFile = File(...), save_for_training: bool = True):
    """
    Verify a document image

    Returns document type, extracted fields, and confidence
    """
    import time
    start = time.time()

    content = await file.read()
    issues = []
    extracted = {}
    method = "ocr"

    # Try YOLOv8 first (if available and trained)
    doc_type = "unknown"
    confidence = 0.3

    model = get_yolo_model()
    if model and YOLO_AVAILABLE:
        try:
            # TODO: Use YOLO for classification once trained
            # results = model.predict(content)
            pass
        except Exception as e:
            issues.append(f"YOLO error: {str(e)}")

    # OCR fallback
    reader = get_ocr_reader()
    if reader:
        try:
            # Preprocess
            if CV2_AVAILABLE:
                processed = preprocess_image(content)
                if processed is not None:
                    _, encoded = cv2.imencode('.jpg', processed)
                    ocr_input = encoded.tobytes()
                else:
                    ocr_input = content
            else:
                ocr_input = content

            # OCR
            results = reader.readtext(ocr_input)
            text = " ".join([r[1] for r in results])

            # Detect type
            doc_type, confidence = detect_document_type(text)

            # Extract VIN
            vin = extract_vin(text)
            if vin:
                extracted["vin"] = vin
                confidence += 0.1

            # Extract name (simple pattern)
            name_match = re.search(
                r'(?:OWNER|NAME)[:\s]*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)',
                text, re.I
            )
            if name_match:
                extracted["name"] = name_match.group(1).strip()
                confidence += 0.1

            confidence = min(0.95, confidence)
            method = "ocr"

        except Exception as e:
            issues.append(f"OCR error: {str(e)}")
    else:
        issues.append("No OCR engine available")

    result = {
        "document_type": doc_type,
        "confidence": confidence,
        "method": method,
        "extracted": extracted,
        "issues": issues,
        "processing_time_ms": int((time.time() - start) * 1000)
    }

    # Save for training if confident enough
    if save_for_training and confidence >= 0.7:
        save_training_sample(content, result, doc_type)

    return result


@app.post("/verify-vin", response_model=VINResult)
async def verify_vin_plate(file: UploadFile = File(...)):
    """Quick VIN plate verification"""
    content = await file.read()

    reader = get_ocr_reader()
    if not reader:
        raise HTTPException(500, "OCR not available")

    try:
        results = reader.readtext(content)
        text = " ".join([r[1] for r in results])

        vin = extract_vin(text)
        if not vin:
            return VINResult(vin=None, valid=False, confidence=0, errors=["No VIN found"])

        validation = validate_vin(vin)
        return VINResult(
            vin=validation["normalized"],
            valid=validation["valid"],
            confidence=0.9 if validation["valid"] else 0.5,
            errors=validation["errors"]
        )
    except Exception as e:
        raise HTTPException(500, f"Processing error: {str(e)}")


@app.get("/training-stats")
async def training_stats():
    """Get training data statistics"""
    stats = {}
    for type_dir in TRAINING_DATA_PATH.iterdir():
        if type_dir.is_dir():
            count = sum(1 for f in type_dir.glob("*.jpg"))
            stats[type_dir.name] = count

    return {
        "total_samples": sum(stats.values()),
        "by_type": stats,
        "ready_for_training": sum(stats.values()) >= 100  # Need ~100 samples minimum
    }


if __name__ == "__main__":
    import uvicorn
    print("Starting Document Verification Server...")
    print(f"YOLOv8: {'Available' if YOLO_AVAILABLE else 'Not installed'}")
    print(f"EasyOCR: {'Available' if EASYOCR_AVAILABLE else 'Not installed'}")
    print(f"OpenCV: {'Available' if CV2_AVAILABLE else 'Not installed'}")
    uvicorn.run(app, host="0.0.0.0", port=8765)
