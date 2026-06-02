"""Semantic b-roll search (#12).

Indexes a folder of the user's OWN clips/images with CLIP embeddings and finds
matches by meaning ("city skyline at night") — upgrading the keyword matcher in
the engine. Nothing is generated; it only retrieves existing media.

Needs:  pip install open_clip_torch faiss-cpu pillow torch
Pure helper `top_k_cosine` needs nothing and is unit-tested.

CLI:
  python -m vibecut.sidecars.broll --index ./broll_folder --out broll.index.json
  python -m vibecut.sidecars.broll --use broll.index.json --search "sunrise over city" -k 5
"""
from __future__ import annotations

import argparse
import json
import math
import os


def _load_clip():
    try:
        import open_clip
        import torch
    except ImportError as exc:  # pragma: no cover - needs deps
        raise SystemExit("b-roll search needs CLIP:  pip install open_clip_torch faiss-cpu pillow torch\n"
                         f"(import failed: {exc})")
    model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")
    tokenizer = open_clip.get_tokenizer("ViT-B-32")
    return model, preprocess, tokenizer, torch


def build_index(media_dir: str, out_path: str):  # pragma: no cover - needs deps
    from PIL import Image
    model, preprocess, _, torch = _load_clip()
    items = []
    for fn in sorted(os.listdir(media_dir)):
        path = os.path.join(media_dir, fn)
        if not fn.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            continue
        with torch.no_grad():
            img = preprocess(Image.open(path).convert("RGB")).unsqueeze(0)
            v = model.encode_image(img)[0]
            v = (v / v.norm()).tolist()
        items.append({"url": path, "embedding": [round(x, 5) for x in v]})
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"model": "ViT-B-32", "items": items}, fh)
    return len(items)


def search(index_path: str, query: str, k: int = 5):  # pragma: no cover - needs deps
    model, _, tokenizer, torch = _load_clip()
    with open(index_path, encoding="utf-8") as fh:
        idx = json.load(fh)
    with torch.no_grad():
        q = model.encode_text(tokenizer([query]))[0]
        q = (q / q.norm()).tolist()
    ranked = top_k_cosine(q, [(it["url"], it["embedding"]) for it in idx["items"]], k)
    return ranked


# ---- pure helper (no deps; unit-tested) -----------------------------------

def top_k_cosine(query_vec, items, k=5):
    """items: [(url, vec)]; vectors assumed L2-normalized -> dot == cosine."""
    def dot(a, b):
        return sum(x * y for x, y in zip(a, b))
    scored = [(url, round(dot(query_vec, v), 5)) for url, v in items]
    scored.sort(key=lambda r: r[1], reverse=True)
    return scored[:k]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="vibecut.sidecars.broll")
    ap.add_argument("--index", help="folder of images to index")
    ap.add_argument("--use", help="an existing index json to search")
    ap.add_argument("--search", help="text query")
    ap.add_argument("--out", default="broll.index.json")
    ap.add_argument("-k", type=int, default=5)
    args = ap.parse_args(argv)
    if args.index:
        n = build_index(args.index, args.out)
        print(f"indexed {n} images -> {args.out}")
    elif args.use and args.search:
        for url, score in search(args.use, args.search, args.k):
            print(f"  {score:.3f}  {url}")
    else:
        ap.error("use --index DIR, or --use index.json --search 'query'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
