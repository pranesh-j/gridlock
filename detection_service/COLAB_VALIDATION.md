# LocateAnything-3B — 20-minute Colab validation

Goal: prove the model runs on a free T4 **and capture its raw output format**
before committing to the cloud path. Success = you see real `<box>`/plate text
in the output. Failure here saves you from migrating a broken model.

## Before you open Colab
- [ ] Have `no-helmet.jpg` ready to upload (and 1–2 more test images if handy).
- [ ] Have `colab_validate.py` (in this folder) ready to upload.
- [ ] **Check if the model is gated.** Open https://huggingface.co/nvidia/LocateAnything-3B
      while logged in. If it shows a license/"agree" gate, accept it and create a
      read token at https://huggingface.co/settings/tokens — you'll need it in step 3.

## In Colab
1. **New notebook → Runtime → Change runtime type → T4 GPU → Save.**
   Verify with a cell:
   ```python
   !nvidia-smi
   ```
   You want to see a Tesla T4 with ~15 GB.

2. **Pin the one dependency that matters** (Colab's torch is already fine):
   ```python
   !pip install -q "transformers==4.53.0" "accelerate>=1.0" peft decord lmdb
   ```
   (Colab already has opencv, pillow, requests. If a later cell complains about a
   missing module, `!pip install -q <name>` it and re-run.)

3. **Only if the model was gated**, log in:
   ```python
   from huggingface_hub import login
   login("hf_xxxxxxxxxxxxxxxxx")  # your read token
   ```

4. **Upload the two files** (folder icon on the left → upload, or):
   ```python
   from google.colab import files
   files.upload()   # pick colab_validate.py and no-helmet.jpg
   ```

5. **Run the validation:**
   ```python
   !python colab_validate.py no-helmet.jpg
   ```
   First run downloads ~6 GB of weights + custom code (a few minutes). Loading the
   model again is cached for the session.

## What to look for in the output
- [ ] **It loads** — `model loaded in Xs`, VRAM ~6 GB. If this fails on a T4, the
      model itself is the problem, not your laptop.
- [ ] **`RAW STR` per prompt** — this is the prize. Read it and check:
  - Does it actually contain box coordinates? In what exact syntax?
  - Is it `<box><x1><y1>...` like `detector.py` assumes, or something else
    (JSON? `(x1,y1,x2,y2)`? `<|box_start|>`? plain prose)?
  - For the `license_plate` prompt, is there readable plate text, and where does it
    sit relative to the box?
  - Are coords 0–1000, 0–1, or raw pixels?
- [ ] **Inference time per prompt** — tells you if real-time/video is even on the table.

## Decision
- **Output has usable boxes/plate text** → cloud path (Option A) is viable. Next:
  copy the real format back so we fix `_parse_boxes` in `detector.py` to match.
- **Loads but output is garbage/empty/unparseable** → the model isn't pulling its
  weight for these tasks. Commit to the YOLO + OCR pipeline (Option C).
- **Won't even load on a T4** → same conclusion: drop the VLM, go to Option C.

Paste the `RAW STR` blocks back here and I'll tune the parser or pivot accordingly.
