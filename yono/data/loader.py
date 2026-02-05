"""
YONO Data Loader

Loads training data from JSONL exports and fetches images for training.
"""

import json
import asyncio
import aiohttp
import aiofiles
from pathlib import Path
from typing import Optional, Iterator, Dict, Any, List
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
import hashlib

import torch
from torch.utils.data import Dataset, DataLoader, IterableDataset
from torchvision import transforms
from PIL import Image
import io


@dataclass
class VehicleImageRecord:
    """Single training record"""
    id: str
    image_url: str
    category: Optional[str]
    labels: Optional[List[str]]
    angle: Optional[str]
    year: Optional[int]
    make: Optional[str]
    model: Optional[str]
    vin: Optional[str]
    vehicle: Optional[str]  # Combined "year make model"


def load_jsonl_records(jsonl_path: Path) -> Iterator[VehicleImageRecord]:
    """Stream records from a JSONL file"""
    with open(jsonl_path, 'r') as f:
        for line in f:
            if line.strip():
                data = json.loads(line)
                yield VehicleImageRecord(
                    id=data.get('id'),
                    image_url=data.get('image_url'),
                    category=data.get('category'),
                    labels=data.get('labels'),
                    angle=data.get('angle'),
                    year=data.get('year'),
                    make=data.get('make'),
                    model=data.get('model'),
                    vin=data.get('vin'),
                    vehicle=data.get('vehicle'),
                )


def load_all_records(data_dir: Path) -> List[VehicleImageRecord]:
    """Load all records from all JSONL files in directory"""
    records = []
    for jsonl_file in sorted(data_dir.glob("*.jsonl")):
        for record in load_jsonl_records(jsonl_file):
            records.append(record)
    return records


class ImageCache:
    """Local cache for downloaded images"""

    def __init__(self, cache_dir: Path):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _url_to_path(self, url: str) -> Path:
        """Convert URL to cache path"""
        url_hash = hashlib.md5(url.encode()).hexdigest()
        ext = Path(url.split('?')[0]).suffix or '.jpg'
        return self.cache_dir / f"{url_hash}{ext}"

    def get(self, url: str) -> Optional[Path]:
        """Get cached image path if exists"""
        path = self._url_to_path(url)
        return path if path.exists() else None

    def put(self, url: str, data: bytes) -> Path:
        """Cache image data"""
        path = self._url_to_path(url)
        path.write_bytes(data)
        return path


async def download_image(
    session: aiohttp.ClientSession,
    url: str,
    cache: Optional[ImageCache] = None,
    timeout: int = 30
) -> Optional[bytes]:
    """Download image from URL"""
    # Check cache first
    if cache:
        cached_path = cache.get(url)
        if cached_path:
            return cached_path.read_bytes()

    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
            if resp.status == 200:
                data = await resp.read()
                if cache:
                    cache.put(url, data)
                return data
    except Exception as e:
        print(f"Failed to download {url[:50]}...: {e}")
    return None


class VehicleImageDataset(Dataset):
    """
    PyTorch Dataset for vehicle images.

    Supports multiple training tasks:
    - make_model: Classify vehicle make/model
    - year: Predict vehicle year
    - angle: Classify camera angle
    - category: Classify image category
    """

    def __init__(
        self,
        records: List[VehicleImageRecord],
        task: str = "make_model",
        transform: Optional[transforms.Compose] = None,
        cache_dir: Optional[Path] = None,
        preload: bool = False,
    ):
        self.records = records
        self.task = task
        self.transform = transform or self._default_transform()
        self.cache = ImageCache(cache_dir) if cache_dir else None

        # Build label mappings based on task
        self.label_to_idx, self.idx_to_label = self._build_labels()

        # Preload images if requested
        self.preloaded_images = {}
        if preload:
            self._preload_images()

    def _default_transform(self) -> transforms.Compose:
        """Default image transforms"""
        return transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225]
            ),
        ])

    def _build_labels(self) -> tuple[Dict[str, int], Dict[int, str]]:
        """Build label mappings for the task"""
        if self.task == "make_model":
            # Combine make + model
            labels = set()
            for r in self.records:
                if r.make and r.model:
                    labels.add(f"{r.make} {r.model}")
            labels = sorted(labels)

        elif self.task == "make":
            labels = sorted(set(r.make for r in self.records if r.make))

        elif self.task == "year":
            # Bucket years into decades for classification
            labels = sorted(set(
                f"{(r.year // 10) * 10}s"
                for r in self.records if r.year
            ))

        elif self.task == "angle":
            labels = sorted(set(r.angle for r in self.records if r.angle))

        elif self.task == "category":
            labels = sorted(set(r.category for r in self.records if r.category))

        else:
            raise ValueError(f"Unknown task: {self.task}")

        label_to_idx = {label: idx for idx, label in enumerate(labels)}
        idx_to_label = {idx: label for label, idx in label_to_idx.items()}

        return label_to_idx, idx_to_label

    def _get_label(self, record: VehicleImageRecord) -> Optional[int]:
        """Get label index for a record"""
        if self.task == "make_model":
            if record.make and record.model:
                key = f"{record.make} {record.model}"
                return self.label_to_idx.get(key)

        elif self.task == "make":
            return self.label_to_idx.get(record.make)

        elif self.task == "year":
            if record.year:
                decade = f"{(record.year // 10) * 10}s"
                return self.label_to_idx.get(decade)

        elif self.task == "angle":
            return self.label_to_idx.get(record.angle)

        elif self.task == "category":
            return self.label_to_idx.get(record.category)

        return None

    def _load_image(self, url: str) -> Optional[Image.Image]:
        """Load image from URL or cache"""
        if url in self.preloaded_images:
            return self.preloaded_images[url]

        # Try cache
        if self.cache:
            cached_path = self.cache.get(url)
            if cached_path:
                return Image.open(cached_path).convert('RGB')

        # Download synchronously (for single items)
        import requests
        try:
            resp = requests.get(url, timeout=30)
            if resp.status_code == 200:
                img = Image.open(io.BytesIO(resp.content)).convert('RGB')
                if self.cache:
                    self.cache.put(url, resp.content)
                return img
        except Exception as e:
            print(f"Error loading {url[:50]}...: {e}")

        return None

    def _preload_images(self):
        """Preload all images asynchronously"""
        print(f"Preloading {len(self.records)} images...")

        async def _download_all():
            async with aiohttp.ClientSession() as session:
                tasks = []
                for record in self.records:
                    tasks.append(download_image(session, record.image_url, self.cache))
                return await asyncio.gather(*tasks)

        results = asyncio.run(_download_all())

        for record, data in zip(self.records, results):
            if data:
                try:
                    img = Image.open(io.BytesIO(data)).convert('RGB')
                    self.preloaded_images[record.image_url] = img
                except:
                    pass

        print(f"Preloaded {len(self.preloaded_images)} images")

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, int]:
        record = self.records[idx]

        # Load image
        img = self._load_image(record.image_url)
        if img is None:
            # Return a black image placeholder
            img = Image.new('RGB', (224, 224), color='black')

        # Apply transforms
        img_tensor = self.transform(img)

        # Get label
        label = self._get_label(record)
        if label is None:
            label = -1  # Unknown class

        return img_tensor, label

    @property
    def num_classes(self) -> int:
        return len(self.label_to_idx)


class StreamingVehicleDataset(IterableDataset):
    """
    Streaming dataset for large-scale training.
    Loads and processes images on-the-fly.
    """

    def __init__(
        self,
        data_dir: Path,
        task: str = "make_model",
        transform: Optional[transforms.Compose] = None,
        cache_dir: Optional[Path] = None,
        shuffle: bool = True,
    ):
        self.data_dir = data_dir
        self.task = task
        self.transform = transform
        self.cache_dir = cache_dir
        self.shuffle = shuffle

        # Get all JSONL files
        self.jsonl_files = sorted(data_dir.glob("*.jsonl"))

    def __iter__(self):
        files = list(self.jsonl_files)
        if self.shuffle:
            import random
            random.shuffle(files)

        for jsonl_file in files:
            records = list(load_jsonl_records(jsonl_file))
            if self.shuffle:
                import random
                random.shuffle(records)

            # Create a mini dataset for this batch
            dataset = VehicleImageDataset(
                records=records,
                task=self.task,
                transform=self.transform,
                cache_dir=self.cache_dir,
            )

            for i in range(len(dataset)):
                yield dataset[i]


def create_dataloaders(
    data_dir: Path,
    task: str = "make_model",
    batch_size: int = 32,
    num_workers: int = 4,
    train_split: float = 0.9,
    cache_dir: Optional[Path] = None,
) -> tuple[DataLoader, DataLoader]:
    """
    Create train and validation dataloaders.
    """
    # Load all records
    records = load_all_records(data_dir)
    print(f"Loaded {len(records)} records")

    # Split
    split_idx = int(len(records) * train_split)
    train_records = records[:split_idx]
    val_records = records[split_idx:]

    # Create datasets
    train_dataset = VehicleImageDataset(
        records=train_records,
        task=task,
        cache_dir=cache_dir,
    )

    val_dataset = VehicleImageDataset(
        records=val_records,
        task=task,
        cache_dir=cache_dir,
        transform=train_dataset.transform,  # Use same transform
    )

    # Share label mappings
    val_dataset.label_to_idx = train_dataset.label_to_idx
    val_dataset.idx_to_label = train_dataset.idx_to_label

    print(f"Train: {len(train_dataset)}, Val: {len(val_dataset)}")
    print(f"Classes: {train_dataset.num_classes}")

    # Create loaders
    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=num_workers,
        pin_memory=True,
    )

    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=True,
    )

    return train_loader, val_loader


if __name__ == "__main__":
    # Test loading
    data_dir = Path("/Users/skylar/nuke/training-data/images")
    records = load_all_records(data_dir)
    print(f"Total records: {len(records)}")

    # Sample
    for r in records[:3]:
        print(f"  {r.vehicle}: {r.image_url[:50]}...")
