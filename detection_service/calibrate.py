"""Calibration helper for onboarding a camera.

Grabs a reference frame from a feed and overlays a labelled coordinate grid, so
you can read off the pixel coordinates for a camera config's zones / lanes /
congestion ROI. Use --interactive to drag rectangles instead (needs a display).

    python calibrate.py --video ../demo-clips/test-video-2.mp4 --frame 300
    # -> writes <video>.reference.jpg; read [x1,y1,x2,y2] off the grid

    python calibrate.py --video ../demo-clips/test-video-2.mp4 --interactive
    # -> drag boxes; prints each as [x1,y1,x2,y2]
"""

import argparse
import os

import cv2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--frame", type=int, default=0, help="frame index to grab")
    ap.add_argument("--out", default=None)
    ap.add_argument("--grid", type=int, default=100, help="grid spacing in px")
    ap.add_argument("--interactive", action="store_true",
                    help="drag ROIs in a window (needs a display)")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise SystemExit(f"cannot open {args.video}")
    if args.frame:
        cap.set(cv2.CAP_PROP_POS_FRAMES, args.frame)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise SystemExit("could not read a frame")

    H, W = frame.shape[:2]
    print(f"frame size: {W}x{H}")

    if args.interactive:
        rois = cv2.selectROIs("drag zones (Enter=add, Esc=done)", frame)
        cv2.destroyAllWindows()
        for r in rois:
            x, y, w, h = (int(v) for v in r)
            print(f"  zone: [{x}, {y}, {x + w}, {y + h}]")
        return

    grid = frame.copy()
    for x in range(0, W, args.grid):
        cv2.line(grid, (x, 0), (x, H), (0, 255, 0), 1)
        cv2.putText(grid, str(x), (x + 2, 14),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
    for y in range(0, H, args.grid):
        cv2.line(grid, (0, y), (W, y), (0, 255, 0), 1)
        cv2.putText(grid, str(y), (2, y + 14),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)

    out = args.out or os.path.splitext(args.video)[0] + ".reference.jpg"
    cv2.imwrite(out, grid)
    print(f"reference grid -> {out}")
    print("read regions as [x1,y1,x2,y2] off the grid into cameras/<id>.json")


if __name__ == "__main__":
    main()
