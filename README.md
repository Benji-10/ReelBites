# 🍳 Reel Recipes

Turn any Instagram food reel into a structured, editable recipe — with AI-extracted ingredients, instructions, and **evidence-backed flags** that warn you when information is missing or unclear.

Paste an Instagram reel URL → the app scrapes the video, transcribes the audio (Whisper), OCRs the on-screen text (Tesseract), and uses **Gemini** to generate a recipe. Every ingredient, step, and metadata field is tagged with its **source** (caption, transcript, OCR, or comments), and any gaps are flagged so you know exactly what to verify.

---

## ✨ Features

- **One-click extraction** — paste an Instagram reel URL and get a full recipe.
- **Multi-modal pipeline** — combines caption, comments, audio transcript, and on-screen OCR text.
- **Evidence-backed** — every field cites where the info came from (caption / audio / OCR / comments).
- **Hallucination flags** — if an amount is missing or a step is vague, the app flags it instead of inventing data.
- **Editable recipe box** — every section (title, description, ingredients, instructions, metadata, source link) has an edit button.
- **Real-time progress** — live SSE streaming shows each pipeline step as it runs.
- **Responsive design** — works on desktop and mobile.
- **Auth-gated** — Netlify Identity handles signup/login; each user has their own private recipe box.
- **Persistent storage** — recipes are saved to a Neon PostgreSQL database.

---

## 🏗️ Architecture

```
Instagram URL
    │
    ▼
┌─────────────┐    ┌──────────────┐    ┌───────────────┐    ┌───────────┐
│   Apify     │───▶│   ffmpeg     │───▶│   Whisper     │───▶│  ffmpeg   │
│ (scrape IG) │    │ (audio extract)│   │ (HF Inference)│    │ (frames)  │
└─────────────┘    └──────────────┘    └───────────────┘    └─────┬─────┘
       │                                                       │
       │       ┌───────────────────────────────────────────────┘
       │       │
       │       ▼
       │    ┌───────────────┐
       │    │  Tesseract.js │
       │    │   (OCR)       │
       │    └───────┬───────┘
       │            │
       ▼            ▼
┌──────────────────────────┐
│       Gemini LLM          │
│  (recipe + evidence)      │
└────────────┬─────────────┘
             │
             ▼
    ┌─────────────────┐
    │   Neon (PG)     │
    │  recipe storage │
    └─────────────────┘
```

**Architecture: Hybrid (Client-side WASM + Server-side API calls)**

Heavy media processing (ffmpeg, OCR) runs **client-side** via WebAssembly to stay under Netlify's 250MB function size limit. The server only handles API-key-dependent work.

```
Browser (client-side WASM)          Server (Netlify Functions)
┌──────────────────────────┐        ┌──────────────────────────┐
│  1. Download video       │        │  /api/scrape             │
│  2. ffmpeg.wasm: audio   │───────▶│    → Apify (Instagram)   │
│  3. ffmpeg.wasm: frames  │        │  /api/transcribe         │
│  4. Tesseract.js: OCR    │───────▶│    → HuggingFace Whisper │
│  5. Upload audio         │        │  /api/generate           │
│  6. Collect all text     │───────▶│    → Gemini LLM          │
│                          │        │  /api/recipes            │
│                          │        │    → Neon PostgreSQL     │
└──────────────────────────┘        └──────────────────────────┘
```

**Tech Stack:**
- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui
- **Client-side processing**: ffmpeg.wasm (video/audio), Tesseract.js (OCR)
- **Backend**: Next.js API Routes (deployed as Netlify Functions, ~10MB bundle)
- **Database**: Neon PostgreSQL + Prisma ORM
- **Auth**: Netlify Identity (GoTrue)
- **Instagram scraping**: Apify (free tier, server-side)
- **Speech-to-text**: OpenAI Whisper via HuggingFace Inference API (server-side)
- **Recipe generation**: Google Gemini `gemini-2.5-flash-lite` (server-side)
- **Hosting**: Netlify

---

## 📋 Prerequisites (all free tiers)

You'll need accounts on these services. All have generous free tiers:

| Service | Purpose | Free Tier | Sign Up |
|---------|---------|-----------|---------|
| **Netlify** | Hosting + Auth | 100GB bandwidth, 300 build min/month | [netlify.com](https://netlify.com) |
| **Neon** | PostgreSQL database | 0.5GB storage, free forever | [neon.tech](https://neon.tech) |
| **Apify** | Instagram scraping | $5/month credits (~10-25 scrapes) | [apify.com](https://apify.com) |
| **HuggingFace** | Whisper STT | Free Inference API | [huggingface.co](https://huggingface.co) |
| **Google AI Studio** | Gemini LLM | Free API key (15 RPM) | [aistudio.google.com](https://aistudio.google.com/app/apikey) |

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd reel-recipes
bun install   # or: npm install
```

### 2. Set Up Environment Variables

Copy the example and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env` and set these required values:

```env
# Neon PostgreSQL — copy the "pooled" connection string from your Neon dashboard
DATABASE_URL="postgresql://user:password@ep-xxx.region.aws.neon.tech/recipe_extractor?sslmode=require"

# Apify — from https://console.apify.com/account/settings/api
APIFY_API_TOKEN="apify_api_xxx..."

# Google Gemini — from https://aistudio.google.com/app/apikey
GEMINI_API_KEY="AIza..."
GEMINI_MODEL="gemini-2.5-flash-lite"

# HuggingFace — from https://huggingface.co/settings/tokens
HF_API_TOKEN="hf_..."
WHISPER_MODEL="openai/whisper-large-v3"

# Your deployed site URL (for Netlify Identity redirects)
NEXT_PUBLIC_SITE_URL="https://your-site.netlify.app"
```

### 3. Set Up the Database

The Prisma schema uses PostgreSQL. After setting `DATABASE_URL`:

```bash
# Generate the Prisma client
bun run db:generate

# Push the schema to your Neon database (creates tables)
bun run db:push
```

### 4. Run Locally

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Note:** Netlify Identity won't work on `localhost` by default. The app falls back to a "dev user" so you can test the full extraction pipeline without auth. To test auth locally, use `netlify dev` instead.

---

## 🌐 Deploy to Netlify

### Option A: Connect via GitHub (recommended)

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Reel Recipes"
   git branch -M main
   git remote add origin https://github.com/<your-username>/reel-recipes.git
   git push -u origin main
   ```

2. **Create a new Netlify site:**
   - Go to [app.netlify.com](https://app.netlify.com) → "Add new site" → "Import an existing project"
   - Connect your GitHub account and select the `reel-recipes` repo
   - Build settings are auto-detected from `netlify.toml`:
     - **Build command**: `bun run build`
     - **Publish directory**: `.next`
   - Click "Deploy site"

3. **Set environment variables:**
   - In your Netlify site dashboard: Site settings → Environment variables
   - Add all variables from `.env.example` (except `NEXT_PUBLIC_SITE_URL`, which you'll set after the first deploy)
   - Set `NEXT_PUBLIC_SITE_URL` to your Netlify URL (e.g. `https://reel-recipes.netlify.app`)

4. **Enable Netlify Identity:**
   - In your Netlify site dashboard: Integrations → Identity → Enable
   - Under Settings: set Registration to "Open" (or invite-only if you prefer)
   - Add your Netlify URL to the redirect URLs

5. **Push the database schema:**
   - Run `bun run db:push` locally with your Neon `DATABASE_URL` set
   - Or use the Neon SQL editor to run the schema manually

6. **Redeploy** (to pick up the env vars):
   - Deploy → Trigger deploy → Clear cache and deploy site

### Option B: Drag & Drop

1. Run `bun run build` locally
2. Drag the project folder to [app.netlify.com/drop](https://app.netlify.com/drop)
3. Set env vars and enable Identity as above

---

## 📖 How to Use

1. **Log in** — click "Sign up" in the top right (or use the dev mode if running locally)
2. **Extract a recipe:**
   - Go to the "Extract" tab
   - Paste an Instagram reel URL (e.g. `https://www.instagram.com/reel/Cx.../`)
   - Click "Extract Recipe"
   - Watch the live progress as each pipeline step runs
3. **View & edit:**
   - After extraction, you're taken to the recipe detail page
   - Click "Edit" on any section (title, description, ingredients, instructions, metadata, source)
   - Make changes and click "Save"
4. **Recipe Box:**
   - Click "Recipe Box" to see all your saved recipes
   - Click any card to view/edit the full recipe
   - Delete recipes with the trash icon

### Understanding Evidence & Flags

- **Evidence badges** appear next to ingredients, instructions, and metadata:
  - 📝 **Caption** — from the Instagram post caption
  - 🎙️ **Audio** — from the Whisper transcript
  - 📺 **On-screen** — from Tesseract OCR of video frames
  - 💬 **Comments** — from pinned/top comments
- **Flags** warn you about potential issues:
  - `missing_amount` — an ingredient is mentioned but no quantity is given
  - `vague_instruction` — a step lacks specific time/temperature
  - `not_a_recipe` — the reel doesn't appear to be a recipe

---

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | Neon PostgreSQL connection string (use the pooled connection) |
| `APIFY_API_TOKEN` | ✅ | — | Apify API token |
| `GEMINI_API_KEY` | ✅ | — | Google Gemini API key |
| `HF_API_TOKEN` | ✅ | — | HuggingFace API token for Whisper |
| `NEXT_PUBLIC_SITE_URL` | ✅ | — | Your deployed site URL |
| `APIFY_INSTAGRAM_ACTOR` | ❌ | `apify/instagram-scraper` | Apify actor ID for Instagram scraping |
| `GEMINI_MODEL` | ❌ | `gemini-2.5-flash-lite` | Gemini model name (set to `gemini-3.1-flash-lite` when available) |
| `WHISPER_MODEL` | ❌ | `openai/whisper-large-v3` | HuggingFace Whisper model |
| `TESSERACT_LANG` | ❌ | `eng` | Tesseract OCR language |
| `FRAME_INTERVAL_SECONDS` | ❌ | `2` | Seconds between OCR frames |
| `MAX_FRAMES_TO_OCR` | ❌ | `30` | Maximum frames to OCR per video |

### Switching the Instagram Scraper

The default Apify actor (`apify/instagram-scraper`) handles all Instagram content types. If you prefer a different actor (e.g. a cheaper community actor), set `APIFY_INSTAGRAM_ACTOR` to its ID. The code expects the actor to accept `startUrls` in its input and return results with `videoUrl`, `caption`, and `comments` fields.

### Switching the LLM Model

The user originally requested `gemini-3.1-flash-lite`. As of this writing, the latest available flash-lite model is `gemini-2.5-flash-lite`. To use a different model:

```env
GEMINI_MODEL="gemini-3.1-flash-lite"   # when Google ships this name
```

The code will automatically use whatever model name you set.

---

## 📁 Project Structure

```
reel-recipes/
├── netlify.toml              # Netlify build config
├── .env.example              # Environment variable template
├── prisma/
│   └── schema.prisma         # Database schema (User, Recipe, ExtractionJob)
├── src/
│   ├── app/
│   │   ├── layout.tsx        # Root layout (fonts, Netlify Identity redirect)
│   │   ├── page.tsx          # Main page (renders AppShell)
│   │   ├── globals.css       # Warm food-themed palette
│   │   └── api/
│   │       ├── extract/route.ts        # SSE streaming extraction endpoint
│   │       └── recipes/
│   │           ├── route.ts            # GET/POST recipes
│   │           └── [id]/route.ts       # GET/PUT/DELETE single recipe
│   ├── components/
│   │   ├── ui/               # shadcn/ui components
│   │   └── recipe/
│   │       ├── app-shell.tsx          # Main app container + auth
│   │       ├── navbar.tsx             # Header with nav + auth buttons
│   │       ├── extractor-view.tsx     # URL input + SSE consumer
│   │       ├── loading-status.tsx     # Step-by-step progress display
│   │       ├── recipe-box.tsx         # Recipe grid view
│   │       ├── recipe-card.tsx        # Individual recipe card
│   │       ├── recipe-detail.tsx      # Full recipe view + editor
│   │       ├── evidence-badge.tsx     # Source evidence badge
│   │       ├── flag-list.tsx          # Warning/flag alerts
│   │       └── footer.tsx
│   ├── hooks/
│   │   └── use-netlify-identity.ts    # Netlify Identity React hook
│   └── lib/
│       ├── types.ts          # Shared TypeScript types
│       ├── db.ts             # Prisma client
│       ├── store.ts          # Zustand app state
│       ├── auth.ts           # JWT decoding + user sync
│       ├── apify.ts          # Instagram scraping via Apify
│       ├── video.ts          # ffmpeg video download + audio/frame extraction
│       ├── whisper.ts        # HuggingFace Whisper STT
│       ├── ocr.ts            # Tesseract.js OCR
│       ├── gemini.ts         # Gemini recipe generation
│       └── recipe-pipeline.ts # Full pipeline orchestrator
└── package.json
```

---

## ⚠️ Limitations & Notes

- **Function timeout**: Netlify's free tier allows synchronous functions up to 10 seconds and background functions up to 5 minutes. The extraction pipeline typically takes 1-3 minutes. The `netlify.toml` sets the function timeout to 300 seconds (5 min). If your video is very long, the pipeline may time out — try a shorter reel.
- **Apify free tier**: Gives $5/month of credits. Each Instagram scrape costs ~$0.20-0.50, so you can do ~10-25 extractions per month for free.
- **HuggingFace cold start**: The first Whisper call after inactivity may take 20-30 seconds while the model loads. Subsequent calls are faster.
- **Tesseract accuracy**: OCR works best on high-contrast, large text. Small or stylized text on busy backgrounds may not be recognized.
- **JWT verification**: For simplicity, the server decodes JWTs without signature verification. For production with sensitive data, verify the JWT using the GoTrue JWT secret from your Netlify dashboard.
- **Private Instagram accounts**: Apify cannot scrape private/restricted Instagram content.

---

## 🔧 Troubleshooting

### "APIFY_API_TOKEN is not set"
Make sure you've copied `.env.example` to `.env` and filled in all required values. On Netlify, set these in Site settings → Environment variables.

### "Database unavailable" / Prisma errors
- Verify your `DATABASE_URL` is the **pooled** connection string from Neon (it contains `-pooler` in the hostname).
- Run `bun run db:push` to create the tables.
- Check that your Neon database is active (free tier auto-suspends after inactivity).

### Netlify Identity not working
- Ensure Identity is enabled in your Netlify dashboard.
- Set `NEXT_PUBLIC_SITE_URL` to your exact Netlify URL.
- Check that registration is set to "Open" or you've invited your email.

### Extraction times out
- The pipeline is bounded by the Netlify function timeout (5 min on free tier).
- Try a shorter Instagram reel.
- Reduce `MAX_FRAMES_TO_OCR` to speed up the OCR step.
- On Netlify Pro, you can increase the function timeout to 15 minutes.

### Whisper returns empty transcript
- The reel may not have speech (music-only videos).
- Check that `HF_API_TOKEN` is valid.
- The HuggingFace free tier may be rate-limited; wait a minute and retry.

### OCR finds no text
- The reel may not have on-screen text.
- Try decreasing `FRAME_INTERVAL_SECONDS` to capture more frames.
- Check `TESSERACT_LANG` if the video uses non-English text.

---

## 📝 License

MIT — feel free to use, modify, and distribute.

---

## 🙏 Acknowledgments

Built with these excellent free tools:
- [Apify](https://apify.com) — web scraping platform
- [ffmpeg](https://ffmpeg.org) — video processing
- [OpenAI Whisper](https://github.com/openai/whisper) — speech recognition (via HuggingFace)
- [Tesseract.js](https://tesseract.projectnaptha.com) — OCR engine
- [Google Gemini](https://ai.google.dev) — large language model
- [Neon](https://neon.tech) — serverless PostgreSQL
- [Netlify](https://netlify.com) — hosting & identity
- [shadcn/ui](https://ui.shadcn.com) — UI components
