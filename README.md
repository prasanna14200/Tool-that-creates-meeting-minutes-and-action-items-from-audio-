

Live demo:https://meeting-minutes-studio.onrender.com/
# Meeting Minutes Studio

A free portfolio demo that turns short English meeting audio into a transcript and Markdown meeting minutes.

The original project is preserved in `Week_3_Day_5_Meeting_Minutes_product.ipynb`. That Colab notebook uses Google Drive, OpenAI Whisper, a Hugging Face token, CUDA, bitsandbytes, and Llama 3.1 8B. This web version removes those runtime requirements so it can run on free hosting.

## What runs where

- Transcription runs in the visitor's browser with `Xenova/whisper-tiny.en` through Transformers.js.
- Minutes generation runs in the browser with transparent rules, not a paid LLM.
- The optional Python Flask app only serves the static files and a health check.
- Audio files and transcripts are not uploaded to this app's server.

## Limits

- Best for English audio clips up to 30 seconds and 25 MB.
- The first transcription downloads the browser Whisper model and can take a minute.
- Older browsers may not support audio recording, WebAssembly, or decoding every audio codec.
- Long meetings should be transcribed elsewhere and pasted into the transcript box.
- Review generated minutes before sharing them.

## Local setup

```bash
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:7860`.

## Free deployment options

### GitHub Pages

The `.github/workflows/pages.yml` workflow deploys the static app in `docs/` to GitHub Pages on every push to `main`. Public repositories can use GitHub Pages and GitHub Actions free tiers.

### Render Free web service

`render.yaml` is included for a Python web service on Render's Free plan. It serves the same browser-local app and does not run Whisper on the server.

No API keys are required for either deployment.
