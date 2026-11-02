# Aesthetic Preview

A browser app that simulates filler treatments on a face photo using a fal.ai image-editing model.

- Take a photo with the camera or upload one
- Choose treatments and amounts: lips, cheeks, chin, jawline, nasolabial folds, marionette lines, under-eye, double chin reduction, eye brightening
- Send to an AI model (default: `fal-ai/nano-banana-2/edit`) and compare before / after

Plain HTML, CSS and JavaScript. No build step, no libraries.

## Use it

1. Open the GitHub Pages link (or `index.html` in a browser).
2. Click **Settings**, paste your fal API key (fal.ai → Dashboard → Keys) and pick a model.
3. Add a photo, move the sliders, click **Apply treatments**.

## Important

- The API key is stored only in your browser (localStorage) and sent directly to fal. Fine for personal testing. **Before sharing the app publicly, move the key to a small server proxy** (e.g. a Cloudflare Worker) so it is never exposed.
- Results are AI simulations for visualization only, not medical outcomes.

## Files

- `index.html` – layout
- `style.css` – styles (light/dark)
- `app.js` – treatments, prompt builder, camera/upload, fal queue API calls, before/after slider
