# detectors/detect_image.py
"""
AI vs Human image detector (free, no training).
Primary model:  falconsai/image-detection-fake-vs-real
Fallback:       uclanlp/clip-ai-generated-images

Install once (if needed):
    pip install transformers==4.41.1 torch pillow

Usage:
    from detectors.detect_image import detect_image_ai
    out = detect_image_ai("/path/to/image.jpg")
    # out example:
    # {
    #   "ai_percent": 87,
    #   "human_percent": 13,
    #   "label": "AI-generated",
    #   "confidence": 0.87,
    #   "model": "falconsai/image-detection-fake-vs-real",
    # }
"""

import threading
from typing import Dict, List

from PIL import Image
from transformers import pipeline

# ---------- Model setup (load once, thread-safe) ----------

_PRIMARY_MODEL = "falconsai/image-detection-fake-vs-real"
_FALLBACK_MODEL = "uclanlp/clip-ai-generated-images"

_PIPE = None
_PIPE_MODEL_NAME = None
_PIPE_LOCK = threading.Lock()


def _load_pipeline():
    """Load the image-classification pipeline on CPU."""
    global _PIPE, _PIPE_MODEL_NAME
    # Try preferred model first, then fallback
    for model_name in (_PRIMARY_MODEL, _FALLBACK_MODEL):
        try:
            _PIPE = pipeline(
                task="image-classification",
                model=model_name,
                device=-1,  # CPU
            )
            _PIPE_MODEL_NAME = model_name
            return
        except Exception as e:
            # Try next model
            _PIPE = None
            _PIPE_MODEL_NAME = None
            last_err = e
    # If we got here, both loads failed
    raise RuntimeError(
        f"Failed to load any detector. Last error: {last_err}"
    )


def _get_pipeline():
    global _PIPE
    if _PIPE is None:
        with _PIPE_LOCK:
            if _PIPE is None:
                _load_pipeline()
    return _PIPE


# ---------- Utilities ----------

def _normalize_results(results: List[dict]) -> Dict[str, float]:
    """
    Map model outputs to probabilities for AI vs Human.

    We handle common label variants:
        - "AI-generated", "fake", "ai", "synthetic"
        - "real", "human", "authentic"
    """
    ai_score = None
    human_score = None

    for item in results:
        label = (item.get("label") or "").strip().lower()
        score = float(item.get("score") or 0.0)

        if any(k in label for k in ["ai", "fake", "synthetic", "generated"]):
            ai_score = max(ai_score or 0.0, score)
        if any(k in label for k in ["real", "human", "authentic"]):
            human_score = max(human_score or 0.0, score)

    # If only one side is present, infer the other
    if ai_score is None and human_score is None:
        # No recognizable labels — use the top prediction as AI and set a conservative probability
        best = max(results, key=lambda x: x.get("score", 0.0))
        ai_score = float(best.get("score", 0.5))
        human_score = 1.0 - ai_score
    elif ai_score is None:
        ai_score = 1.0 - human_score
    elif human_score is None:
        human_score = 1.0 - ai_score

    # Clamp & renormalize (just in case)
    ai_score = max(0.0, min(1.0, ai_score))
    human_score = max(0.0, min(1.0, human_score))
    total = ai_score + human_score
    if total > 0:
        ai_score /= total
        human_score /= total

    return {"ai": ai_score, "human": human_score}


# ---------- Public API ----------

def detect_image_ai(image_path: str) -> Dict[str, object]:
    """
    Detect if an image is AI-generated or Human-created.

    Returns a dict:
        {
          "ai_percent": int,
          "human_percent": int,
          "label": "AI-generated" | "Human",
          "confidence": float (0..1),
          "model": str (model id),
        }
    Raises:
        RuntimeError if the model cannot be loaded.
        ValueError for invalid image input.
    """
    pipe = _get_pipeline()

    # Open with PIL to ensure RGB
    try:
        img = Image.open(image_path).convert("RGB")
    except Exception as e:
        raise ValueError(f"Failed to open image '{image_path}': {e}")

    # Run the model
    outputs = pipe(img)
    # Some pipelines return a dict; ensure list
    if isinstance(outputs, dict):
        outputs = [outputs]

    # Normalize
    probs = _normalize_results(outputs)
    ai_p = probs["ai"]
    human_p = probs["human"]

    # Final label and confidence = max probability
    if ai_p >= human_p:
        label = "AI-generated"
        confidence = ai_p
    else:
        label = "Human"
        confidence = human_p

    return {
        "ai_percent": int(round(ai_p * 100)),
        "human_percent": int(round(human_p * 100)),
        "label": label,
        "confidence": float(round(confidence, 4)),
        "model": _PIPE_MODEL_NAME,
    }


# ---------- Optional: quick CLI test ----------
if __name__ == "__main__":
    import sys, json
    if len(sys.argv) < 2:
        print("Usage: python -m detectors.detect_image /path/to/image.jpg")
        sys.exit(1)
    result = detect_image_ai(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False, indent=2))
