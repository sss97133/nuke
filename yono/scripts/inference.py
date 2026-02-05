#!/usr/bin/env python3
"""
YONO Inference Script

Run inference on vehicle images using trained models.

Usage:
    python inference.py --model outputs/make_*/best_model.pt --image photo.jpg
    python inference.py --model outputs/make_*/best_model.pt --url https://...
    python inference.py --model outputs/make_*/best_model.pt --batch images/
"""

import argparse
import json
from pathlib import Path
from typing import Optional, List, Tuple
import requests
from io import BytesIO

import torch
import torch.nn.functional as F
import timm
from PIL import Image
from torchvision import transforms


class YONOClassifier:
    """YONO inference wrapper"""

    def __init__(
        self,
        model_path: Path,
        device: str = "auto",
    ):
        self.device = self._get_device(device)

        # Load checkpoint
        checkpoint = torch.load(model_path, map_location=self.device)

        # Load label mapping
        self.idx_to_label = checkpoint.get('label_mapping', {})
        self.idx_to_label = {int(k): v for k, v in self.idx_to_label.items()}
        self.num_classes = len(self.idx_to_label)

        # Infer architecture from checkpoint
        # Try to determine model architecture from state dict
        state_dict = checkpoint['model_state_dict']
        first_key = list(state_dict.keys())[0]

        # Common architectures
        if 'conv_stem' in first_key or 'bn1' in first_key:
            architecture = "efficientnet_b0"
        elif 'patch_embed' in first_key:
            architecture = "vit_base_patch16_224"
        elif 'stem' in first_key:
            architecture = "convnext_tiny"
        else:
            architecture = "resnet50"

        # Create model
        self.model = timm.create_model(
            architecture,
            pretrained=False,
            num_classes=self.num_classes,
        )
        self.model.load_state_dict(state_dict)
        self.model = self.model.to(self.device)
        self.model.eval()

        # Transforms
        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225]
            ),
        ])

        print(f"Loaded YONO model: {architecture}")
        print(f"Classes: {self.num_classes}")
        print(f"Device: {self.device}")

    def _get_device(self, device: str) -> torch.device:
        if device == "auto":
            if torch.cuda.is_available():
                return torch.device("cuda")
            elif torch.backends.mps.is_available():
                return torch.device("mps")
            else:
                return torch.device("cpu")
        return torch.device(device)

    def load_image(self, source: str) -> Optional[Image.Image]:
        """Load image from path or URL"""
        try:
            if source.startswith(('http://', 'https://')):
                response = requests.get(source, timeout=30)
                response.raise_for_status()
                img = Image.open(BytesIO(response.content))
            else:
                img = Image.open(source)
            return img.convert('RGB')
        except Exception as e:
            print(f"Error loading image: {e}")
            return None

    @torch.no_grad()
    def predict(
        self,
        image: Image.Image,
        top_k: int = 5,
    ) -> List[Tuple[str, float]]:
        """
        Predict class for an image.

        Returns list of (label, probability) tuples.
        """
        # Transform
        img_tensor = self.transform(image).unsqueeze(0).to(self.device)

        # Forward pass
        outputs = self.model(img_tensor)
        probs = F.softmax(outputs, dim=1)[0]

        # Get top-k
        top_probs, top_indices = probs.topk(min(top_k, self.num_classes))

        results = []
        for prob, idx in zip(top_probs.cpu().numpy(), top_indices.cpu().numpy()):
            label = self.idx_to_label.get(idx, f"class_{idx}")
            results.append((label, float(prob)))

        return results

    def predict_batch(
        self,
        images: List[Image.Image],
        top_k: int = 5,
    ) -> List[List[Tuple[str, float]]]:
        """Predict classes for multiple images"""
        if not images:
            return []

        # Transform all images
        tensors = torch.stack([self.transform(img) for img in images]).to(self.device)

        # Forward pass
        with torch.no_grad():
            outputs = self.model(tensors)
            probs = F.softmax(outputs, dim=1)

        # Get top-k for each
        results = []
        for i in range(len(images)):
            top_probs, top_indices = probs[i].topk(min(top_k, self.num_classes))
            image_results = []
            for prob, idx in zip(top_probs.cpu().numpy(), top_indices.cpu().numpy()):
                label = self.idx_to_label.get(idx, f"class_{idx}")
                image_results.append((label, float(prob)))
            results.append(image_results)

        return results


def main():
    parser = argparse.ArgumentParser(description="YONO inference")
    parser.add_argument("--model", type=Path, required=True, help="Path to model checkpoint")
    parser.add_argument("--image", type=str, help="Path or URL to single image")
    parser.add_argument("--batch", type=Path, help="Directory of images to process")
    parser.add_argument("--top-k", type=int, default=5, help="Number of top predictions")
    parser.add_argument("--device", type=str, default="auto", help="Device (auto, cuda, mps, cpu)")
    parser.add_argument("--output", type=Path, help="Output JSON file for batch results")
    args = parser.parse_args()

    # Load model
    classifier = YONOClassifier(args.model, device=args.device)

    if args.image:
        # Single image inference
        img = classifier.load_image(args.image)
        if img is None:
            print("Failed to load image")
            return

        results = classifier.predict(img, top_k=args.top_k)

        print(f"\nPredictions for {args.image}:")
        for label, prob in results:
            bar = "█" * int(prob * 20)
            print(f"  {prob*100:5.1f}% {bar} {label}")

    elif args.batch:
        # Batch inference
        image_files = list(args.batch.glob("*.jpg")) + list(args.batch.glob("*.jpeg")) + list(args.batch.glob("*.png"))
        print(f"Processing {len(image_files)} images...")

        all_results = {}
        for img_path in image_files:
            img = classifier.load_image(str(img_path))
            if img:
                results = classifier.predict(img, top_k=args.top_k)
                all_results[str(img_path)] = [
                    {"label": label, "probability": prob}
                    for label, prob in results
                ]
                print(f"  {img_path.name}: {results[0][0]} ({results[0][1]*100:.1f}%)")

        if args.output:
            with open(args.output, "w") as f:
                json.dump(all_results, f, indent=2)
            print(f"Results saved to {args.output}")

    else:
        print("Please provide --image or --batch")


if __name__ == "__main__":
    main()
