from transformers import pipeline
import torch

def detect_text(content):
    """Detect if text is AI-generated using a transformer model."""
    # Load a text classification model (placeholder, use a fine-tuned model for production)
    classifier = pipeline("text-classification", model="distilbert-base-uncased", device=0 if torch.cuda.is_available() else -1)
    result = classifier(content[:512])  # Limit input to 512 tokens
    score = int(result[0]['score'] * 100) if result[0]['label'] == 'POSITIVE' else int((1 - result[0]['score']) * 100)
    confidence = random.randint(70, 100)  # Placeholder confidence
    analysis = "High probability AI-generated" if score > 70 else "Moderate probability AI-generated" if score > 30 else "Low probability AI-generated"
    return {"score": score, "confidence": confidence, "analysis": analysis}