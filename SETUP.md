# Running Gridlock — local mirrors production

The three services run the same code locally and when hosted. The only
difference is configuration (env vars). Point local at the **same Supabase
project** as prod and every screen shows identical data in both places.

```
frontend (Vercel / :5173) ──► backend (Render / :8000) ──► detection_service (:8001, GPU)
                                     │                            │
                                     ▼                            ▼
                              Supabase (shared)            YOLO + helmet + plate + OCR
```

Where compute runs:
- **Frontend + backend + Supabase** — hosted, no GPU, serve data to anyone, zero-touch.
- **detection_service** — runs where a GPU is (3060 for real-time, M1 via `mps` for dev,
  CPU as a slow fallback). Auto-selected; no code change between machines.

## 1. Detection service

```bash
cd detection_service
cp .env.example .env                 # defaults are fine for local
pip install -r requirements.txt
# weights: see ../models/README.md (helmet_best.pt, plate_mkgoud.pt); base yolo11m auto-downloads
python service.py                    # :8001  — device auto-picks cuda > mps > cpu
```

Sanity check: `curl localhost:8001/health` → `"ready": true`.

## 2. Backend

```bash
cd backend
cp .env.example .env                 # set SUPABASE_URL/KEY to the shared project
pip install -r requirements.txt
python train_models.py               # trains the 3 forecast models into ../models
uvicorn main:app --port 8000
```

With Supabase set, hotspots + feedback use Supabase; otherwise they fall back to
the local `data/police_violations.csv`. Either way the API shape is identical.

## 3. Frontend

```bash
cd frontend
cp .env.example .env                 # VITE_API_URL=http://localhost:8000 ; VITE_MAPPLS_KEY=...
npm install
npm run dev                          # :5173
```

## Seeding real CV results into Supabase (the zero-touch demo)

One-time setup:
1. In the Supabase SQL editor, run `db/cv_schema.sql` (creates `cv_violations`
   + `cv_congestion`).
2. In Supabase Storage, create a **public** bucket named `evidence`.

Then, run the real pipeline once on demo footage and push the results:

```bash
cd detection_service
# 1) detect -> writes ../data/feeds/violations.csv, congestion.csv, evidence/*.jpg
python video_pipeline.py --video ../demo-clips/clip.mp4 --emit \
    --zone x1,y1,x2,y2 --dwell 5 --flow 0,1
# 2) upload evidence to Storage + upsert rows into cv_violations / cv_congestion
python seed_supabase.py --feeds ../data/feeds --bucket evidence
```

Now the hosted **Detections** screen shows genuine CV output (with evidence
thumbnails) served from Supabase — no GPU on the server.

## Live detection at the finale

Run `detection_service` on the 3060, expose it with a tunnel, point the hosted
backend's `DETECTION_URL` at the tunnel for the Live Analysis screen. If the
tunnel is down, the rest of the app still works from seeded Supabase data.