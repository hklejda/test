# Aesthetic Preview

A browser studio for aesthetic consultations: take or upload a client photo, build a treatment plan, and generate an AI before/after preview with a fal.ai image-editing model.

Live: https://hklejda.github.io/test/

## Features

- **Photo:** camera with face guide, or upload
- **Treatment categories**
  - **Dermal fillers (mL):** lips, cheeks, chin, jawline, nasolabial, marionette, tear troughs, temples, non-surgical nose
  - **Botox (units):** forehead, glabella, crow's feet, brow lift, bunny lines, lip flip, gummy smile, masseter, chin dimpling, neck (Nefertiti)
  - **Skin:** skin booster, chemical peel, microneedling, laser, pigmentation, acne scars, eye brightening, HIFU/RF tightening
  - **Contouring:** double chin, lower-cheek slimming, jowls, thread lift
- Filter by face area, adjust dose or intensity per treatment
- **Result style:** Natural / Balanced / Enhanced
- Treatment plan summary with total filler mL and botox units
- Compare slider, side-by-side or after-only view
- Version history for comparing plans
- Printable report (before/after and plan table) → save as PDF
- **Precise reshaping for shape treatments:** fillers (lips, cheeks, chin, jawline, temples, nose), brow lift, lip flip, gummy smile, jaw slimming, double chin, lower cheeks, jowls, thread lift and tightening are done by landmark-driven warping (`warp.js`), not AI. Amount scales with the dose. Instant, free, no lighting artefacts.
- **AI for skin & line treatments:** acne, pigmentation, peel, laser, microneedling, booster, dark circles, wrinkles (botox lines), nasolabial/marionette lines, tear troughs.
- **Change only selected areas (on by default):** the app maps the face (MediaPipe Face Landmarker, 478 points), builds a soft mask of just the selected treatment areas, aligns the AI result to the original, and pastes AI pixels **only inside that mask**. Everything else (eyes, skin, hair, background) is the original photo, pixel for pixel. **👁 Show areas** previews exactly what can change.

Plain HTML, CSS and JavaScript. No build step, no libraries.

## Setup

1. Open the app → **⚙ Settings** → paste your fal API key (fal.ai → Dashboard → Keys), choose a model, and optionally add your clinic name.
2. Add a photo, pick treatments, click **Generate preview**.

## Files

- `data.js` – treatment catalog (categories, doses, prompt text)
- `warp.js` – landmark-driven reshaping for shape treatments
- `face.js` – face landmarks, treatment-area masks, alignment, colour match, protected compositing
- `app.js` – UI, prompt builder, camera/upload, fal queue API, history, report
- `style.css` – styles (light/dark, print)
- `.github/workflows/pages.yml` – deploys to GitHub Pages on every push

## Important

- The API key is stored only in the browser. Before giving the app to clients or staff, move the key to a server proxy (e.g. a Cloudflare Worker).
- Results are AI simulations for consultation only. Doses are reference ranges, not medical advice.
