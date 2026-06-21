# Model weights

These `.pt` files are **gitignored** (too large for the repo) — download them
manually after cloning. `YoloDetector` auto-loads them from this folder if present.

| File | Purpose | Source |
|---|---|---|
| `helmet_best.pt` | Rider helmet classifier — classes `With Helmet` / `Without Helmet` | [Bike-Helmet-Detction-Model](https://github.com/Juliowiwiwiwi/Bike-Helmet-Detction-Model) (`Weights/best.pt`) |
| `plate_mkgoud.pt` | License-plate detector — localizes plates (incl. small Indian two-wheeler plates) better than the original | [MKgoud/License-Plate-Recognizer](https://huggingface.co/MKgoud/License-Plate-Recognizer) (`LP-detection.pt`) |

Re-download:

```bash
mkdir -p models
curl -sL -o models/helmet_best.pt \
  https://raw.githubusercontent.com/Juliowiwiwiwi/Bike-Helmet-Detction-Model/master/Weights/best.pt
curl -sL -o models/plate_mkgoud.pt \
  https://huggingface.co/MKgoud/License-Plate-Recognizer/resolve/main/LP-detection.pt
```

The base COCO detector (`yolo11n.pt`) is downloaded automatically by ultralytics
on first run and does not need to live here.

## Overriding

`YoloDetector` resolves add-on models in this order:

1. env var (`YOLO_HELMET_MODEL`, `YOLO_PLATE_MODEL`) if set
2. bundled file in this folder (`helmet_best.pt`)
3. otherwise the add-on is skipped (no helmet/plate detections emitted)
