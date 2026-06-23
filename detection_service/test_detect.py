import os
import sys
import time

os.environ.setdefault("DETECTOR", "locateanything")

from detector import LocateAnythingDetector


def main():
    if len(sys.argv) < 2:
        print("usage: python test_detect.py <image_path>")
        sys.exit(1)

    image_path = sys.argv[1]
    if not os.path.exists(image_path):
        print(f"image not found: {image_path}")
        sys.exit(1)

    print("loading model...")
    t0 = time.time()
    d = LocateAnythingDetector()
    print(f"model loaded in {time.time() - t0:.1f}s")

    with open(image_path, "rb") as f:
        image_bytes = f.read()

    print(f"running detection on {image_path} ...")
    t1 = time.time()
    detections = d.detect(image_bytes)
    print(f"detection done in {time.time() - t1:.1f}s")

    print(f"\nfound {len(detections)} detections:")
    for i, det in enumerate(detections, 1):
        b = det["box"]
        ocr = f" ocr='{det['ocr_text']}'" if det.get("ocr_text") else ""
        print(
            f"  {i}. {det['label']} conf={det['confidence']:.2f} "
            f"box=({b['x1']:.0f},{b['y1']:.0f},{b['x2']:.0f},{b['y2']:.0f}){ocr}"
        )


if __name__ == "__main__":
    main()
