"""
Standalone LocateAnything-3B validation script for Google Colab (T4).

Purpose: confirm the model actually runs AND see its RAW output format,
so we know (a) whether the cloud path is viable and (b) whether the box
parser in detector.py matches what the model really emits.

This deliberately does NOT parse boxes. It prints the raw decoded string
for each prompt so we can read the real format with our own eyes.

Usage in Colab (after setting Runtime -> GPU):
    !python colab_validate.py no-helmet.jpg
or just run main() in a cell.
"""

import sys
import time

import torch
from PIL import Image
from transformers import AutoModel, AutoTokenizer, AutoProcessor

MODEL_ID = "nvidia/LocateAnything-3B"
MAX_SIDE = 896  # match the local downscale so behavior is comparable

PROMPTS = {
    "lane_block": "Locate all vehicles parked on the road or blocking a lane, including cars, trucks, buses, and motorcycles stopped in travel lanes.",
    "no_helmet": "Locate all motorcycle riders and bicycle riders. For each rider, also locate their helmet if visible.",
    "license_plate": "Locate all visible vehicle license plates and read the registration number text on each plate.",
}


def load_model():
    print(f"loading {MODEL_ID} ...")
    t0 = time.time()
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
    processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)
    model = AutoModel.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.bfloat16,
        trust_remote_code=True,
        low_cpu_mem_usage=True,
        device_map="cuda",
        attn_implementation="sdpa",
    ).eval()

    # same belt-and-suspenders sdpa forcing as detector.py
    for module in model.modules():
        if hasattr(module, "_attn_implementation"):
            module._attn_implementation = "sdpa"
        cfg = getattr(module, "config", None)
        if cfg is not None and hasattr(cfg, "_attn_implementation"):
            cfg._attn_implementation = "sdpa"

    print(f"model loaded in {time.time() - t0:.1f}s")
    print(f"VRAM allocated: {torch.cuda.memory_allocated() / 1e9:.2f} GB")
    return model, tokenizer, processor


def run_prompt(model, tokenizer, processor, image, prompt):
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": prompt},
            ],
        }
    ]
    text = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    images, videos = processor.process_vision_info(messages)
    inputs = processor(
        text=[text], images=images, videos=videos, return_tensors="pt"
    ).to("cuda")

    with torch.no_grad():
        response = model.generate(
            pixel_values=inputs["pixel_values"].to(torch.bfloat16),
            input_ids=inputs["input_ids"],
            attention_mask=inputs["attention_mask"],
            image_grid_hws=inputs.get("image_grid_hws"),
            tokenizer=tokenizer,
            max_new_tokens=2048,
            generation_mode="hybrid",
            use_cache=True,
        )
    return response


def main():
    image_path = sys.argv[1] if len(sys.argv) > 1 else "no-helmet.jpg"
    image = Image.open(image_path).convert("RGB")
    w, h = image.size
    print(f"image: {image_path}  size: {w}x{h}")
    if max(w, h) > MAX_SIDE:
        s = MAX_SIDE / max(w, h)
        image = image.resize((int(w * s), int(h * s)), Image.LANCZOS)
        print(f"downscaled to: {image.size}")

    model, tokenizer, processor = load_model()

    for name, prompt in PROMPTS.items():
        print("\n" + "=" * 70)
        print(f"PROMPT [{name}]: {prompt}")
        print("=" * 70)
        t0 = time.time()
        raw = run_prompt(model, tokenizer, processor, image, prompt)
        dt = time.time() - t0
        print(f"--- inference {dt:.1f}s ---")
        print("RAW TYPE:", type(raw))
        print("RAW REPR:")
        print(repr(raw))
        print("RAW STR:")
        print(str(raw))


if __name__ == "__main__":
    main()
