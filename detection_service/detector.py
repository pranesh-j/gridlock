import os
import re
import io
import uuid
from abc import ABC, abstractmethod
from PIL import Image


class Detector(ABC):
    @abstractmethod
    def detect(self, image_bytes: bytes, prompts: list[str]) -> list[dict]:
        ...


class MockDetector(Detector):
    def detect(self, image_bytes: bytes, prompts: list[str]) -> list[dict]:
        return [
            {
                "label": "car",
                "confidence": 0.93,
                "box": {"x1": 120, "y1": 200, "x2": 360, "y2": 380},
                "ocr_text": None,
            },
            {
                "label": "license_plate",
                "confidence": 0.88,
                "box": {"x1": 220, "y1": 350, "x2": 300, "y2": 375},
                "ocr_text": "KA01AB1234",
            },
            {
                "label": "motorcycle_rider",
                "confidence": 0.90,
                "box": {"x1": 480, "y1": 220, "x2": 600, "y2": 420},
                "ocr_text": None,
            },
        ]


class LocateAnythingDetector(Detector):
    # prompts we send for each detection category
    # longest image side fed to the model; keeps ViT attention within 6GB VRAM
    MAX_SIDE = 896

    PROMPTS = {
        "lane_block": "Locate all vehicles parked on the road or blocking a lane, including cars, trucks, buses, and motorcycles stopped in travel lanes.",
        "no_helmet": "Locate all motorcycle riders and bicycle riders. For each rider, also locate their helmet if visible.",
        "license_plate": "Locate all visible vehicle license plates and read the registration number text on each plate.",
    }

    def __init__(self, model_id: str = None, device: str = "cuda"):
        self.model_id = model_id or os.environ.get("LA_MODEL", "nvidia/LocateAnything-3B")
        self.device = device
        self.model = None
        self.processor = None
        self.tokenizer = None
        self._load()

    def _load(self):
        import torch
        from transformers import AutoModel, AutoTokenizer, AutoProcessor

        self.tokenizer = AutoTokenizer.from_pretrained(
            self.model_id, trust_remote_code=True
        )
        self.processor = AutoProcessor.from_pretrained(
            self.model_id, trust_remote_code=True
        )
        # device_map streams shards straight to the GPU and low_cpu_mem_usage
        # avoids staging the full model in RAM, which OOMs on low-memory hosts
        self.model = AutoModel.from_pretrained(
            self.model_id,
            torch_dtype=torch.bfloat16,
            trust_remote_code=True,
            low_cpu_mem_usage=True,
            device_map=self.device,
            attn_implementation="sdpa",
        ).eval()

        # the bundled qwen2 only implements sdpa/magi, but loads as eager and
        # never self-corrects; force sdpa on every submodule and config
        for module in self.model.modules():
            if hasattr(module, "_attn_implementation"):
                module._attn_implementation = "sdpa"
            cfg = getattr(module, "config", None)
            if cfg is not None and hasattr(cfg, "_attn_implementation"):
                cfg._attn_implementation = "sdpa"

        self._torch = torch

    def _run_prompt(self, image: Image.Image, prompt: str) -> str:
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": prompt},
                ],
            }
        ]
        text = self.processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        images, videos = self.processor.process_vision_info(messages)
        inputs = self.processor(
            text=[text], images=images, videos=videos, return_tensors="pt"
        ).to(self.device)

        with self._torch.no_grad():
            response = self.model.generate(
                pixel_values=inputs["pixel_values"].to(self._torch.bfloat16),
                input_ids=inputs["input_ids"],
                attention_mask=inputs["attention_mask"],
                image_grid_hws=inputs.get("image_grid_hws"),
                tokenizer=self.tokenizer,
                # 512 is plenty for a dense scene (~60 boxes) and caps the
                # degenerate runaway where the model loops the same zero-area
                # box until it hits the limit (cost us 70s+ on one prompt)
                max_new_tokens=512,
                generation_mode="hybrid",
                use_cache=True,
            )
        return response if isinstance(response, str) else str(response)

    # actual output format (confirmed on a T4 run):
    #   <ref>label</ref><box><x1><y1><x2><y2></box><box>...</box>...
    # i.e. ONE garbled ref followed by MANY boxes. coords are 0-1000 bin
    # tokens in x1,y1,x2,y2 order. the <ref> text is unreliable ("carsate",
    # "license license number number"), so we ignore it and tag every box
    # with the category of the prompt we sent.
    _BOX_RE = re.compile(
        r"<box>\s*<(\d{1,4})>\s*<(\d{1,4})>\s*<(\d{1,4})>\s*<(\d{1,4})>\s*</box>"
    )

    def _parse_boxes(self, raw: str, img_w: int, img_h: int, label: str) -> list[dict]:
        results = []
        seen = set()

        # scan every <box> in the response, regardless of ref grouping.
        # <box>None</box> simply won't match.
        for m in self._BOX_RE.finditer(raw):
            x1n, y1n, x2n, y2n = (int(m.group(i)) for i in range(1, 5))

            # model occasionally swaps the corners; normalize to x1<x2, y1<y2
            x1 = min(x1n, x2n) / 1000.0 * img_w
            x2 = max(x1n, x2n) / 1000.0 * img_w
            y1 = min(y1n, y2n) / 1000.0 * img_h
            y2 = max(y1n, y2n) / 1000.0 * img_h

            # drop the degenerate zero-area boxes from the runaway loop
            if x2 - x1 < 1 or y2 - y1 < 1:
                continue

            # collapse exact duplicates (the runaway repeats one box hundreds of times)
            key = (round(x1), round(y1), round(x2), round(y2))
            if key in seen:
                continue
            seen.add(key)

            results.append(
                {
                    "label": label,
                    "confidence": 0.85,  # model doesn't emit per-box scores
                    "box": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                    "ocr_text": None,  # localizer only; plate OCR is a separate step
                }
            )
        return results

    def detect(self, image_bytes: bytes, prompts: list[str] = None) -> list[dict]:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        w, h = image.size

        # cap the longest side so the ViT attention matrix fits in 6GB VRAM.
        # boxes come back normalized, so we still map them to original w,h
        if max(w, h) > self.MAX_SIDE:
            scale = self.MAX_SIDE / max(w, h)
            model_image = image.resize(
                (int(w * scale), int(h * scale)), Image.LANCZOS
            )
        else:
            model_image = image

        # pair each prompt with the category label we tag its boxes with.
        # the model's own <ref> label is garbled, so the category we ask for
        # is the source of truth. custom prompts fall back to a generic label.
        if prompts:
            prompt_items = [("object", p) for p in prompts]
        else:
            prompt_items = list(self.PROMPTS.items())

        all_detections = []
        seen_boxes = set()

        for label, prompt in prompt_items:
            raw = self._run_prompt(model_image, prompt)
            for det in self._parse_boxes(raw, w, h, label):
                b = det["box"]
                # deduplicate across prompts by rounded box coords
                key = (
                    det["label"],
                    round(b["x1"], -1),
                    round(b["y1"], -1),
                    round(b["x2"], -1),
                    round(b["y2"], -1),
                )
                if key not in seen_boxes:
                    seen_boxes.add(key)
                    all_detections.append(det)

        return all_detections


class YoloDetector(Detector):
    """Closed-vocabulary YOLO baseline to A/B against the VLM.

    Out of the box (just a COCO model) it covers vehicles + riders, which is
    enough to compare boxes against LocateAnything on the same images. The two
    tasks COCO doesn't cover are pluggable add-ons, wired but optional:

      YOLO_MODEL         base detector weights      (default: yolo11n.pt, auto-downloads)
      YOLO_HELMET_MODEL  path to a helmet model     (emits "helmet" boxes for rules.py)
      YOLO_PLATE_MODEL   path to a plate model      (emits "license_plate" boxes)
      YOLO_CONF          confidence threshold       (default 0.35)

    Plate text uses EasyOCR if installed; otherwise ocr_text stays None.
    Labels are emitted in rules.py's scheme so the rest of the pipeline is
    backend-agnostic.
    """

    # COCO class id -> rules.py label scheme.
    # NOTE: COCO "motorcycle" is the bike, not the person. We treat its presence
    # as a rider proxy so the no_helmet rule fires; swap for a proper
    # person<->motorcycle association once a helmet model is in place.
    COCO_LABEL_MAP = {
        2: "car",
        5: "bus",
        7: "truck",
        3: "motorcycle_rider",
        1: "bicycle",
        0: "person",
    }

    # weights live in ../models and are gitignored; see models/README.md
    _MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "models")

    def __init__(self, model_id: str = None, device: str = "cuda"):
        # yolo11m: better recall on small/dense vehicles than 11n, still GPU-fast.
        # drop to yolo11s for more speed, or yolo11x for max accuracy, via YOLO_MODEL.
        self.model_id = model_id or os.environ.get("YOLO_MODEL", "yolo11m.pt")
        self.device = device
        self.conf = float(os.environ.get("YOLO_CONF", "0.35"))
        # plates are small/cleaner after cropping, so allow a lower threshold
        self.plate_conf = float(os.environ.get("YOLO_PLATE_CONF", "0.25"))
        # add-on models: env var wins, else fall back to the bundled weights if present
        self.helmet_model_id = os.environ.get("YOLO_HELMET_MODEL") or self._bundled("helmet_best.pt")
        self.plate_model_id = os.environ.get("YOLO_PLATE_MODEL") or self._bundled("plate_mkgoud.pt")
        self.model = None
        self.helmet_model = None
        self.plate_model = None
        self._ocr = None
        self._load()

    @classmethod
    def _bundled(cls, name: str) -> str | None:
        path = os.path.join(cls._MODELS_DIR, name)
        return path if os.path.exists(path) else None

    def _load(self):
        from ultralytics import YOLO

        self.model = YOLO(self.model_id)
        if self.helmet_model_id and os.path.exists(self.helmet_model_id):
            self.helmet_model = YOLO(self.helmet_model_id)
        if self.plate_model_id and os.path.exists(self.plate_model_id):
            self.plate_model = YOLO(self.plate_model_id)
        # EasyOCR is loaded lazily on the first plate crop

    def _infer(self, model, image, label_map=None, conf=None) -> list[dict]:
        results = model.predict(
            image,
            conf=self.conf if conf is None else conf,
            device=self.device,
            verbose=False,
        )
        dets = []
        for r in results:
            names = r.names
            for box in r.boxes:
                cls = int(box.cls[0])
                if label_map is not None:
                    if cls not in label_map:
                        continue
                    label = label_map[cls]
                else:
                    label = str(names[cls]).lower()
                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
                dets.append(
                    {
                        "label": label,
                        "confidence": float(box.conf[0]),
                        "box": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                        "ocr_text": None,
                    }
                )
        return dets

    @staticmethod
    def _normalize_helmet_label(label: str) -> str:
        # helmet models name their classes every which way. collapse them to the
        # two labels rules.py understands: "helmet" (head IS helmeted) and
        # "no_helmet" (head is NOT). anything else (e.g. "rider") passes through
        # and is ignored downstream.
        #   "With Helmet"/"helmet"/"wearing helmet" -> helmet
        #   "Without Helmet"/"no-helmet"/"nohelmet"/"head"/"bare head" -> no_helmet
        raw = label.lower()
        l = " ".join(raw.replace("_", " ").replace("-", " ").split())
        negated = (
            "no helmet" in l
            or "without helmet" in l
            or "non helmet" in l
            or "nohelmet" in raw
        )
        if "helmet" in l:
            return "no_helmet" if negated else "helmet"
        if l in ("head", "bare head", "bare", "nohelmet"):
            return "no_helmet"
        return l

    # Indian plate shape: 2 state letters, 1-2 RTO digits, 1-3 series letters,
    # 4 running digits (e.g. KA01AB1234). used to pull the plate out of noisy OCR.
    _PLATE_RE = re.compile(r"[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{3,4}")

    @classmethod
    def _clean_plate_text(cls, text: str) -> str | None:
        if not text:
            return None
        compact = re.sub(r"[^A-Z0-9]", "", text.upper())
        if not compact:
            return None
        m = cls._PLATE_RE.search(compact)
        # return the well-formed plate if found, else the raw compact reading
        return m.group(0) if m else compact

    def _read_plate(self, image, box) -> str | None:
        if self._ocr is None:
            try:
                import easyocr

                self._ocr = easyocr.Reader(["en"], gpu=(self.device != "cpu"))
            except Exception:
                self._ocr = False  # OCR not available; remember and skip
        if not self._ocr:
            return None
        import numpy as np

        crop = image.crop(
            (int(box["x1"]), int(box["y1"]), int(box["x2"]), int(box["y2"]))
        )
        # plate crops off a wide frame are tiny; EasyOCR reads them far better
        # when upscaled so the text is ~100px tall (capped to avoid huge inputs)
        w, h = crop.size
        if 0 < h < 100:
            s = min(100.0 / h, 6.0)
            crop = crop.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
        # constrain OCR to plate characters to cut spurious symbols
        texts = self._ocr.readtext(
            np.array(crop),
            detail=0,
            allowlist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        )
        return self._clean_plate_text(" ".join(texts))

    # vehicles/riders that carry a plate; we zoom into each to find small plates
    _PLATE_REGION_LABELS = {"car", "bus", "truck", "motorcycle_rider", "bicycle"}

    @staticmethod
    def _iou(a, b) -> float:
        x1 = max(a["x1"], b["x1"])
        y1 = max(a["y1"], b["y1"])
        x2 = min(a["x2"], b["x2"])
        y2 = min(a["y2"], b["y2"])
        if x2 <= x1 or y2 <= y1:
            return 0.0
        inter = (x2 - x1) * (y2 - y1)
        aa = (a["x2"] - a["x1"]) * (a["y2"] - a["y1"])
        bb = (b["x2"] - b["x1"]) * (b["y2"] - b["y1"])
        return inter / (aa + bb - inter + 1e-6)

    def _detect_plates(self, image, base_dets) -> list[dict]:
        """Find plates by zooming into each vehicle/rider region.

        The plate model is fed the whole image (catches large foreground plates)
        AND each vehicle/rider crop. Cropping matters: the model resizes its
        input to ~640px internally, so a plate that is a few pixels in the full
        frame becomes detectable once isolated in a crop. Boxes from crops are
        mapped back to full-image coordinates, then deduplicated.
        """
        W, H = image.size

        # collect (box, conf) candidates from the full frame + every region crop
        candidates = [
            (p["box"], p["confidence"])
            for p in self._infer(self.plate_model, image, conf=self.plate_conf)
        ]
        for d in base_dets:
            if d["label"] not in self._PLATE_REGION_LABELS:
                continue
            box = d["box"]
            pad_x = (box["x2"] - box["x1"]) * 0.10
            pad_y = (box["y2"] - box["y1"]) * 0.15
            cx1, cy1 = max(0, int(box["x1"] - pad_x)), max(0, int(box["y1"] - pad_y))
            cx2, cy2 = min(W, int(box["x2"] + pad_x)), min(H, int(box["y2"] + pad_y))
            if cx2 - cx1 < 16 or cy2 - cy1 < 16:
                continue
            crop = image.crop((cx1, cy1, cx2, cy2))
            for p in self._infer(self.plate_model, crop, conf=self.plate_conf):
                b = p["box"]
                candidates.append(
                    (
                        {
                            "x1": b["x1"] + cx1,
                            "y1": b["y1"] + cy1,
                            "x2": b["x2"] + cx1,
                            "y2": b["y2"] + cy1,
                        },
                        p["confidence"],
                    )
                )

        # dedup overlapping plate boxes (regions overlap), keeping highest conf,
        # then OCR each surviving plate once
        candidates.sort(key=lambda t: t[1], reverse=True)
        plates = []
        for box, conf in candidates:
            if any(self._iou(box, kept["box"]) > 0.4 for kept in plates):
                continue
            plates.append(
                {
                    "label": "license_plate",
                    "confidence": conf,
                    "box": box,
                    "ocr_text": self._read_plate(image, box),
                }
            )
        return plates

    def plate_in_vehicle(self, image, vehicle_box):
        """Detect + read a plate within a single vehicle box, on demand.

        Used to enrich track-based events (parking/wrong-way) with a plate
        without re-running the whole frame. Returns a license_plate detection
        dict (mapped to full-image coords) or None.
        """
        if self.plate_model is None:
            return None
        W, H = image.size
        b = vehicle_box
        pad_x = (b["x2"] - b["x1"]) * 0.10
        pad_y = (b["y2"] - b["y1"]) * 0.15
        cx1, cy1 = max(0, int(b["x1"] - pad_x)), max(0, int(b["y1"] - pad_y))
        cx2, cy2 = min(W, int(b["x2"] + pad_x)), min(H, int(b["y2"] + pad_y))
        if cx2 - cx1 < 16 or cy2 - cy1 < 16:
            return None
        crop = image.crop((cx1, cy1, cx2, cy2))
        best = None
        for p in self._infer(self.plate_model, crop, conf=self.plate_conf):
            if best is None or p["confidence"] > best["confidence"]:
                best = p
        if best is None:
            return None
        pb = best["box"]
        box = {"x1": pb["x1"] + cx1, "y1": pb["y1"] + cy1,
               "x2": pb["x2"] + cx1, "y2": pb["y2"] + cy1}
        return {
            "label": "license_plate",
            "confidence": best["confidence"],
            "box": box,
            "ocr_text": self._read_plate(image, box),
        }

    def detect(self, image_bytes: bytes, prompts: list[str] = None) -> list[dict]:
        # prompts are ignored (YOLO is closed-vocabulary); kept for interface parity
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        dets = self._infer(self.model, image, self.COCO_LABEL_MAP)

        if self.helmet_model is not None:
            for h in self._infer(self.helmet_model, image):
                h["label"] = self._normalize_helmet_label(h["label"])
                dets.append(h)

        if self.plate_model is not None:
            dets.extend(self._detect_plates(image, dets))

        return dets


def get_detector() -> Detector:
    # YOLO is the default working backend; set DETECTOR=mock for a no-GPU /
    # no-dependency stub, or DETECTOR=locateanything for the VLM.
    backend = os.environ.get("DETECTOR", "yolo").lower()
    if backend == "locateanything":
        return LocateAnythingDetector()
    if backend == "mock":
        return MockDetector()
    return YoloDetector()
