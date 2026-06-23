"""
A/B harness: run any detector backend on an image, print detections, and
save an annotated copy so you can eyeball the boxes.

    # YOLO baseline (fast, local)
    python ab_detect.py ../no-helmet.jpg --backend yolo

    # the VLM (slow on a 6GB card; fine on a T4)
    python ab_detect.py ../no-helmet.jpg --backend locateanything

Writes <image>.<backend>.boxes.jpg next to the input so YOLO vs VLM boxes
can be compared side by side on the same picture.
"""

import argparse
import os
import time

from PIL import Image, ImageDraw

# color per label family so the two backends are visually comparable
COLORS = {
    "car": (0, 180, 255),
    "truck": (0, 180, 255),
    "bus": (0, 180, 255),
    "bicycle": (0, 220, 120),
    "motorcycle_rider": (255, 140, 0),
    "person": (180, 180, 180),
    "helmet": (0, 255, 0),
    "no_helmet": (255, 0, 255),
    "license_plate": (255, 0, 0),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument(
        "--backend",
        default="yolo",
        choices=["yolo", "locateanything", "mock"],
    )
    args = ap.parse_args()

    os.environ["DETECTOR"] = args.backend
    from detector import get_detector  # import after env is set

    print(f"backend: {args.backend}")
    t0 = time.time()
    det = get_detector()
    print(f"loaded in {time.time() - t0:.1f}s")

    with open(args.image, "rb") as f:
        image_bytes = f.read()

    t1 = time.time()
    detections = det.detect(image_bytes)
    print(f"detect in {time.time() - t1:.1f}s -> {len(detections)} detections\n")

    for i, d in enumerate(detections, 1):
        b = d["box"]
        ocr = f" ocr='{d['ocr_text']}'" if d.get("ocr_text") else ""
        print(
            f"  {i:2d}. {d['label']:16s} conf={d['confidence']:.2f} "
            f"({b['x1']:.0f},{b['y1']:.0f},{b['x2']:.0f},{b['y2']:.0f}){ocr}"
        )

    # draw and save
    img = Image.open(args.image).convert("RGB")
    draw = ImageDraw.Draw(img)
    for d in detections:
        b = d["box"]
        color = COLORS.get(d["label"], (255, 255, 0))
        draw.rectangle([b["x1"], b["y1"], b["x2"], b["y2"]], outline=color, width=3)
        tag = d["label"] + (f" {d['ocr_text']}" if d.get("ocr_text") else "")
        draw.text((b["x1"] + 2, max(0, b["y1"] - 12)), tag, fill=color)

    base, _ = os.path.splitext(args.image)
    out = f"{base}.{args.backend}.boxes.jpg"
    img.save(out)
    print(f"\nannotated image -> {out}")


if __name__ == "__main__":
    main()
