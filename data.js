// Treatment catalog. Doses are typical reference ranges for visualization only.
// type "dose"  → numeric amount (mL or U) with min/max/step/default
// type "level" → 1 Light · 2 Medium · 3 Intensive
//
// prompt(k): plain visual instruction for the image model.
//   k(n) scales a percentage n by the chosen dose/intensity and result style,
//   so the model gets a concrete amount ("about 40% fuller") instead of medical
//   units it cannot visualise ("2 mL filler").

const CATEGORIES = [
  { id: 'filler',  name: 'Dermal Fillers',  short: 'Fillers',    icon: '💧', unit: 'mL', blurb: 'Hyaluronic acid, mL per session (both sides for paired areas)' },
  { id: 'botox',   name: 'Botulinum Toxin', short: 'Botox',      icon: '✦',  unit: 'U',  blurb: 'Units of onabotulinumtoxinA (Botox®), total for the area' },
  { id: 'skin',    name: 'Skin Treatments', short: 'Skin',       icon: '✧',  unit: null, blurb: 'Skin quality, scars, pigmentation and firmness' },
];

const LEVELS = ['', 'Light', 'Medium', 'Intensive'];

const TREATMENTS = [
  // ---------- Dermal fillers ----------
  { id: 'lips', cat: 'filler', name: 'Lips', area: 'Lips', type: 'dose', min: 0.5, max: 2, step: 0.5, def: 1,
    desc: 'Volume, shape and border definition',
    prompt: k => `LIPS — increase the volume of both lips by about ${k(60, 90)}%: the upper and lower lip become physically bigger, thicker and more projected (as with lip filler), with a naturally defined border. Same lip color, no lipstick or lip liner.` },
  { id: 'cheeks', cat: 'filler', name: 'Cheeks / Midface', area: 'Cheeks', type: 'dose', min: 1, max: 4, step: 0.5, def: 2,
    desc: 'Cheekbone projection and midface lift',
    prompt: k => `CHEEKS — add real volume under the skin of the cheekbones and cheek apples so they become about ${k(50, 75)}% fuller, rounder and higher in 3D shape (as with cheek filler). The face outline at the cheekbones curves outward a little more and the midface looks lifted. This is a change of facial SHAPE only — do not add highlighter, contour, blush or any brightness change.` },
  { id: 'chin', cat: 'filler', name: 'Chin', area: 'Chin', type: 'dose', min: 0.5, max: 3, step: 0.5, def: 1,
    desc: 'Projection and profile balance',
    prompt: k => `CHIN — change the chin shape so it is about ${k(35, 55)}% more prominent: slightly longer and projecting further forward, with a more defined chin tip (as with chin filler). Move the face outline at the chin accordingly.` },
  { id: 'jawline', cat: 'filler', name: 'Jawline', area: 'Jaw', type: 'dose', min: 2, max: 8, step: 1, def: 4,
    desc: 'Sharper jaw contour, angle to chin',
    prompt: k => `JAWLINE — reshape the jaw so the jawline is about ${k(50, 75)}% sharper and more defined: a straight, crisp jaw edge from below the ears to the chin, more defined jaw angles and a clear separation between jaw and neck (as with jawline filler). Change the outline, not the shading.` },
  { id: 'nasolabial', cat: 'filler', name: 'Nasolabial folds', area: 'Lower face', type: 'dose', min: 0.5, max: 2, step: 0.5, def: 1,
    desc: 'Soften smile lines nose → mouth',
    prompt: k => `SMILE LINES (nasolabial folds) — make the folds running from the sides of the nose to the corners of the mouth about ${k(85)}% shallower, so that area looks smooth and filled.` },
  { id: 'marionette', cat: 'filler', name: 'Marionette lines', area: 'Lower face', type: 'dose', min: 0.5, max: 2, step: 0.5, def: 1,
    desc: 'Soften lines below mouth corners',
    prompt: k => `MARIONETTE LINES — make the lines running down from the corners of the mouth toward the chin about ${k(85)}% shallower, and lift the mouth corners slightly so they don't turn down.` },
  { id: 'tearTrough', cat: 'filler', name: 'Tear troughs', area: 'Eyes', type: 'dose', min: 0.5, max: 1.5, step: 0.5, def: 1,
    desc: 'Fill under-eye hollows',
    prompt: k => `UNDER-EYE HOLLOWS — fill the hollows and grooves under both eyes, reducing them by about ${k(85)}%: a smooth, flat transition from the lower eyelid to the cheek, with fewer shadows. Don't change the eyes themselves.` },

  // ---------- Botulinum toxin ----------
  { id: 'forehead', cat: 'botox', name: 'Forehead lines', area: 'Upper face', type: 'dose', min: 6, max: 20, step: 2, def: 10,
    desc: 'Smooth horizontal lines',
    prompt: k => `FOREHEAD — remove about ${k(90)}% of the horizontal forehead wrinkles, so the forehead skin looks smooth and relaxed.` },
  { id: 'glabella', cat: 'botox', name: 'Frown lines (glabella)', area: 'Upper face', type: 'dose', min: 10, max: 30, step: 5, def: 20,
    desc: '"11" lines between the brows',
    prompt: k => `FROWN LINES — remove about ${k(90)}% of the vertical "11" wrinkles between the eyebrows, so that area is smooth.` },
  { id: 'crowsFeet', cat: 'botox', name: "Crow's feet", area: 'Eyes', type: 'dose', min: 12, max: 30, step: 2, def: 24,
    desc: 'Lines at outer eye corners (both sides)',
    prompt: k => `CROW'S FEET — remove about ${k(85)}% of the wrinkles at the outer corners of both eyes.` },
  { id: 'browLift', cat: 'botox', name: 'Brow lift', area: 'Eyes', type: 'dose', min: 4, max: 10, step: 2, def: 6,
    desc: 'Lift the tail of the brows',
    prompt: k => `EYEBROWS — lift the outer half (tail) of both eyebrows about ${k(60, 90)}% higher, giving a more arched brow shape and a more open, awake look. Keep the eyebrow color and thickness.` },
  { id: 'bunny', cat: 'botox', name: 'Bunny lines', area: 'Nose', type: 'dose', min: 4, max: 10, step: 2, def: 6,
    desc: 'Lines on the sides of the nose',
    prompt: k => `BUNNY LINES — remove about ${k(90)}% of the small wrinkles on the sides of the upper nose.` },
  { id: 'lipFlip', cat: 'botox', name: 'Lip flip', area: 'Lips', type: 'dose', min: 2, max: 8, step: 2, def: 4,
    desc: 'Slightly more visible upper lip',
    prompt: k => `UPPER LIP FLIP — roll the upper lip slightly outward so about ${k(40, 60)}% more of the pink upper lip is visible. Don't change the lower lip.` },
  { id: 'gummy', cat: 'botox', name: 'Gummy smile', area: 'Lips', type: 'dose', min: 2, max: 6, step: 2, def: 4,
    desc: 'Less gum showing when smiling',
    prompt: k => `GUMMY SMILE — lower the upper lip slightly so about ${k(70)}% less gum is visible above the upper teeth.` },
  { id: 'masseter', cat: 'botox', name: 'Masseter / jaw slimming', area: 'Jaw', type: 'dose', min: 40, max: 100, step: 10, def: 60,
    desc: 'Slimmer lower face (both sides)',
    prompt: k => `JAW SLIMMING — make the lower face about ${k(20, 30)}% narrower at the jaw angles (below the ears on both sides), giving a slimmer, more V-shaped face. Move the face outline inward there.` },
  { id: 'mentalis', cat: 'botox', name: 'Chin dimpling', area: 'Chin', type: 'dose', min: 4, max: 10, step: 2, def: 6,
    desc: 'Smooth "orange peel" chin',
    prompt: k => `CHIN SKIN — remove about ${k(85)}% of the dimpled, "orange-peel" texture on the chin, so the chin skin is smooth.` },
  { id: 'platysma', cat: 'botox', name: 'Neck bands (Nefertiti)', area: 'Neck', type: 'dose', min: 20, max: 60, step: 10, def: 40,
    desc: 'Smoother neck, sharper jaw line',
    prompt: k => `NECK — soften the vertical neck bands by about ${k(75)}% and make the jawline look crisper and more lifted.` },

  // ---------- Skin treatments ----------
  { id: 'booster', cat: 'skin', name: 'Skin booster', area: 'Full face', type: 'level', def: 2,
    desc: 'Hydration and healthy glow',
    prompt: k => `SKIN QUALITY (skin booster) — improve skin quality by about ${k(55, 75)}%: smoother, more even and more hydrated-looking skin, softer fine lines and smaller pores. Natural MATTE finish: no shine, no oily or glossy look, no glow effect. Keep the same skin tone and brightness.` },
  { id: 'laser', cat: 'skin', name: 'Laser resurfacing', area: 'Full face', type: 'level', def: 2,
    desc: 'Fine lines and texture',
    prompt: k => `RESURFACING — remove about ${k(75)}% of fine lines, wrinkles and rough texture on the face, so the skin looks smoother, tighter and more even.` },
  { id: 'pigment', cat: 'skin', name: 'Pigmentation', area: 'Full face', type: 'level', def: 2,
    desc: 'Sun spots, melasma',
    prompt: k => `PIGMENTATION — remove about ${k(90)}% of dark spots, sun spots, melasma patches and brown marks on the face, leaving an even skin tone.` },
  { id: 'acne', cat: 'skin', name: 'Acne scars', area: 'Full face', type: 'level', def: 2,
    desc: 'Smooth scarring and redness',
    prompt: k => `ACNE — remove about ${k(90)}% of acne scars (pitted, rolling and boxcar scars), acne redness, post-acne marks and pimples, so the facial skin surface is smooth, clear and even. Keep natural pores.` },
  { id: 'eyeBright', cat: 'skin', name: 'Eye brightening', area: 'Eyes', type: 'level', def: 2,
    desc: 'Reduce dark circles',
    prompt: k => `DARK CIRCLES — remove about ${k(85)}% of the dark circles, discoloration and shadows under both eyes, so the under-eye skin matches the cheek tone. Don't change the eyes themselves.` },
  { id: 'brighten', cat: 'skin', name: 'Face brightening (filter)', area: 'Full face', type: 'level', def: 2,
    desc: 'Brighter, softer, glowing face — like a beauty filter',
    prompt: () => '' },

];

const STYLES = [
  { id: 'natural',  name: 'Natural',  hint: 'Softer, natural-looking result', factor: 0.75 },
  { id: 'balanced', name: 'Balanced', hint: 'Clearly visible, still natural',  factor: 1 },
  { id: 'enhanced', name: 'Enhanced', hint: 'Bold, more defined result',       factor: 1.3 },
];
