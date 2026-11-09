"""local_image_analysis_model.py: the free, local, CPU vision reader behind local_image_analysis.py.

One open model (OpenCLIP ViT-B-32, OpenAI weights) gives every library photo:
  * a 512-d L2-normalised embedding (same space as image_observations.embedding_clip_vitb32), and
  * zero-shot readings from fixed prompt ensembles: view/angle, vehicle category, body style, make cue.
Quality is deterministic pixel math (sharpness, exposure, resolution), not a model opinion.

Prompts and thresholds live here, versioned with the code (PROMPT_VERSION); a change to either must bump
ANALYZER_VERSION so rows from different readers never mix silently.
"""
import io
import numpy as np

ANALYZER_VERSION = "local-image-analysis-v1"
PROMPT_VERSION = "prompts-v2"
# EMBED model: fixed, so vectors stay comparable with image_observations.embedding_clip_vitb32.
MODEL_NAME = "open_clip/ViT-B-32-quickgelu"
MODEL_PRETRAINED = "openai"
# LABEL model: the zero-shot reader for view/category/body/make. Chosen by the calibration dev split.
LABEL_MODELS = {
    "b32": ("ViT-B-32-quickgelu", "openai"),
    "l14": ("ViT-L-14", "openai"),
    "siglip_b16": ("ViT-B-16-SigLIP", "webli"),
    "siglip_so400m": ("ViT-SO400M-14-SigLIP-384", "webli"),
}

# view classes: each has a prompt ensemble; the class score is the mean of its normalised text embeddings.
# prompts-v2: chosen on the even-index (dev) half of the hand checks; the odd half is the held-out test.
VIEWS = {
 "exterior_front": ["a photo of the front of a car, showing the grille and headlights", "a front three-quarter view of a whole truck parked outside", "a whole car seen from the front"],
 "exterior_rear": ["a photo of the back of a car, showing the taillights and bumper", "a rear three-quarter view of a whole car", "a whole truck seen from behind"],
 "exterior_side": ["a side profile photo of a whole car", "a whole pickup truck seen from the side", "a car parked, seen from the side"],
 "interior": ["a photo of a car interior with seats", "a car dashboard with gauges and steering wheel", "the inside of a truck cab with seats", "an interior door panel of a car"],
 "engine": ["a photo of a car engine bay with the hood open", "a V8 engine under the hood", "engine components, hoses and wiring in an engine compartment"],
 "undercarriage": ["looking up at the underside of a car", "close-up of exhaust pipes and suspension underneath a vehicle", "the undercarriage frame and axle of a truck"],
 "detail": ["a close-up of a car body panel", "a close-up of a car part", "a car trunk with a spare tire", "an empty pickup truck bed", "a VIN plate or trim tag on a door jamb", "a close-up of a wheel", "car parts on a workbench", "a hand holding a car part"],
 "document": ["a photo of a receipt", "a photo of a printed document", "a vehicle title or registration paper", "an invoice on paper"],
 "screenshot": ["a screenshot of a phone screen", "a screenshot of a website", "a screenshot of a text conversation"],
 "person": ["a selfie", "a photo of a person", "a group of people standing", "a portrait photo of a man"],
 "other": ["a photo of food", "a landscape photo", "a photo of a pet", "a photo of a living room", "a photo of a street", "a painting", "a random everyday photo"],
}
VEHICLE_VIEWS = {"exterior_front", "exterior_rear", "exterior_side", "interior", "engine", "undercarriage", "detail"}

CATEGORIES = {
    "car": ["a photo of a car", "a photo of a classic car", "a photo of a sports car"],
    "pickup_truck": ["a photo of a pickup truck", "a photo of a classic pickup truck"],
    "suv": ["a photo of an SUV", "a photo of a classic 4x4 sport utility vehicle"],
    "van": ["a photo of a van"],
    "motorcycle": ["a photo of a motorcycle"],
    "boat": ["a photo of a boat"],
    "heavy_equipment": ["a photo of a tractor", "a photo of construction equipment", "a photo of a semi truck"],
    "none": ["a photo with no vehicle in it", "a photo of a document", "a photo of a person", "a screenshot"],
}
BODY_STYLES = ["sedan", "coupe", "convertible", "station wagon", "pickup truck", "SUV", "van", "hatchback", "roadster", "hot rod"]
MAKES = ["Chevrolet", "Ford", "GMC", "Dodge", "Plymouth", "Pontiac", "Oldsmobile", "Buick", "Cadillac", "Lincoln",
         "Mercury", "Jeep", "Toyota", "Nissan", "Datsun", "Honda", "Porsche", "Ferrari", "Mercedes-Benz", "BMW",
         "Volkswagen", "Land Rover", "Jaguar", "Lamborghini", "AMC", "International Harvester", "Shelby", "Mazda"]


class Reader:
    def __init__(self, threads=None, label_model="b32"):
        import torch, open_clip
        if threads:
            torch.set_num_threads(threads)
        self.torch = torch
        self.embed_model, _, self.embed_pre = open_clip.create_model_and_transforms(MODEL_NAME.split("/", 1)[1], pretrained=MODEL_PRETRAINED)
        self.embed_model.eval()
        self.label_key = label_model
        arch, pre = LABEL_MODELS[label_model]
        self.label_name = f"open_clip/{arch}:{pre}"
        if label_model == "b32":
            self.model, self.preprocess = self.embed_model, self.embed_pre
        else:
            self.model, _, self.preprocess = open_clip.create_model_and_transforms(arch, pretrained=pre)
            self.model.eval()
        self.tok = open_clip.get_tokenizer(arch)
        self.siglip = "SigLIP" in arch
        if self.siglip:
            self.logit_scale = float(self.model.logit_scale.exp()); self.logit_bias = float(self.model.logit_bias)
        self.view_names, self.view_T = self._class_bank(VIEWS)
        self.cat_names, self.cat_T = self._class_bank(CATEGORIES)
        self.body_names, self.body_T = self._class_bank({b: [f"a photo of a {b}"] for b in BODY_STYLES})
        self.make_names, self.make_T = self._class_bank({m: [f"a photo of a {m} vehicle", f"a {m} car"] for m in MAKES})
        self.blur_T = self._text(["a sharp, in-focus photo", "a blurry, out-of-focus photo"])

    def _text(self, prompts):
        with self.torch.no_grad():
            t = self.model.encode_text(self.tok(prompts)).float()
        return t / t.norm(dim=-1, keepdim=True)

    def _class_bank(self, d):
        names, rows = [], []
        for k, ps in d.items():
            t = self._text(ps).mean(0)
            rows.append(t / t.norm())
            names.append(k)
        return names, self.torch.stack(rows)

    def read(self, pil_images):
        """pil_images: list of RGB PIL images -> list of dict readings (embedding as float list)."""
        torch = self.torch
        with torch.no_grad():
            x0 = torch.stack([self.embed_pre(im) for im in pil_images])
            emb = self.embed_model.encode_image(x0).float()
            emb = emb / emb.norm(dim=-1, keepdim=True)
            if self.model is self.embed_model:
                e = emb
            else:
                e = self.model.encode_image(torch.stack([self.preprocess(im) for im in pil_images])).float()
                e = e / e.norm(dim=-1, keepdim=True)
        ls = self.logit_scale if self.siglip else 100.0
        def probs(T):
            return (ls * e @ T.T).softmax(-1).numpy()
        pv, pc, pb, pm, pq = probs(self.view_T), probs(self.cat_T), probs(self.body_T), probs(self.make_T), probs(self.blur_T)
        out = []
        for i, im in enumerate(pil_images):
            vi = int(pv[i].argmax())
            view = self.view_names[vi]
            p_vehicle = float(sum(pv[i][j] for j, n in enumerate(self.view_names) if n in VEHICLE_VIEWS))
            ci = int(pc[i].argmax())
            top_m = np.argsort(-pm[i])[:3]
            top_b = np.argsort(-pb[i])[:2]
            out.append({
                "is_vehicle": p_vehicle >= 0.5,
                "p_vehicle": round(p_vehicle, 4),
                "view": view,
                "view_confidence": round(float(pv[i][vi]), 4),
                "view_probs": {n: round(float(pv[i][j]), 4) for j, n in enumerate(self.view_names)},
                "category": self.cat_names[ci],
                "category_confidence": round(float(pc[i][ci]), 4),
                "body_cues": [{"body": self.body_names[j], "p": round(float(pb[i][j]), 4)} for j in top_b],
                "make_cues": [{"make": self.make_names[j], "p": round(float(pm[i][j]), 4)} for j in top_m],
                "p_blurry_clip": round(float(pq[i][1]), 4),
                "embedding": [round(float(v), 6) for v in emb[i].numpy()],
            })
        return out


def pixel_quality(pil):
    """Deterministic quality: Laplacian-variance sharpness, mean luma, clipped fraction, megapixels."""
    g = np.asarray(pil.convert("L").resize((512, int(512 * pil.height / max(1, pil.width))) if pil.width > 512 else pil.size), dtype=np.float32)
    lap = g[1:-1, 1:-1] * -4 + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    sharp = float(lap.var())
    luma = float(g.mean())
    clipped = float(((g < 5) | (g > 250)).mean())
    return {"sharpness": round(sharp, 1), "mean_luma": round(luma, 1), "clipped_frac": round(clipped, 4)}


def quality_grade(q, p_blurry, w, h):
    mp = (w * h) / 1e6
    score = 1.0
    if q["sharpness"] < 40: score -= 0.4
    elif q["sharpness"] < 120: score -= 0.15
    if q["mean_luma"] < 35 or q["mean_luma"] > 230: score -= 0.25
    if q["clipped_frac"] > 0.3: score -= 0.15
    if p_blurry > 0.8: score -= 0.15
    if mp < 0.3: score -= 0.2
    score = max(0.0, round(score, 3))
    return {"score": score, "grade": "good" if score >= 0.75 else ("fair" if score >= 0.45 else "poor"),
            "megapixels": round(mp, 2), **q}


def load_image(raw: bytes):
    from PIL import Image, ImageOps
    import pillow_heif
    pillow_heif.register_heif_opener()
    im = Image.open(io.BytesIO(raw))
    im = ImageOps.exif_transpose(im)
    w, h = im.size
    im.draft("RGB", (1024, 1024))
    im = im.convert("RGB")
    if max(im.size) > 1024:
        im.thumbnail((1024, 1024))
    return im, w, h
