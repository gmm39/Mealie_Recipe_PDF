<p align="center">
  <img src=".images/icon.png" alt="Mealie Recipe PDF icon" width="96">
</p>

<h1 align="center">Mealie Recipe PDF</h1>

<p align="center">
  Generates printable PDFs from your <a href="https://mealie.io/">Mealie</a> recipes. Browse your recipes, filter by tag or category, pick what you want, and export as a single PDF or a ZIP of individual files.
</p>

<p align="center">
  <img src=".images/site-preview.jpg" alt="Mealie Recipe PDF web app preview" width="800">
</p>

## Features

- Browse recipes from your Mealie instance, filterable by tag and category
- Convert any recipe into a print-ready PDF with ingredients, instructions, and notes
- Export multiple recipes at once as either one combined PDF or a ZIP of individual PDFs
- Toggle images, tags, notes, and source URLs on or off
- Set your own page margins
- Docker image published on GitHub Container Registry
- Long ingredient lists wrap into 2 or 3 columns automatically instead of running off the page

### Print Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `showTags` | boolean | `true` | Include recipe tags |
| `showImage` | boolean | `false` | Include recipe image |
| `showSource` | boolean | `true` | Include source URL |
| `showNotes` | boolean | `true` | Include recipe notes |
| `combine` | boolean | `true` | Combine into one PDF (`true`) or return a ZIP of individual PDFs (`false`) |
| `margin` | string | `"0.5in"` | Page margin |

### Example Output

| `showImage: true` | `showImage: false` |
|:---:|:---:|
| <img src=".images/pdf-with-image.jpg" alt="Example PDF output with recipe image" width="380"> | <img src=".images/pdf-without-image.jpg" alt="Example PDF output without recipe image" width="380"> |

## Quick Start

### Using Docker

```bash
docker run -d \
  -p 3000:3000 \
  -e MEALIE_URL="https://your-mealie-instance.com" \
  -e MEALIE_TOKEN="your-api-token" \
  ghcr.io/gmm39/mealie_recipe_pdf:latest
```

Then open `http://localhost:3000` in your browser.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MEALIE_URL` | URL of your Mealie instance | `http://localhost:3030` |
| `MEALIE_TOKEN` | Mealie API access token (required) | – |
| `PORT` | Port the app listens on | `3000` |
| `CACHE_TTL` | Cache TTL in seconds | `3600` |

> `MEALIE_TOKEN` is required. Generate one from your Mealie instance under User Settings → API Tokens.

## Docker Image

`ghcr.io/gmm39/mealie_recipe_pdf`