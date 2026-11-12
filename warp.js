// Precise face reshaping ("liquify") driven by face landmarks.
//
// Image AI models can't truly make a feature bigger — they fake volume with
// light (it looks like highlighter). So SHAPE treatments (fillers, jaw slimming,
// double chin, brow lift …) are done here geometrically: pixels are moved with
// smooth local deformations placed on the 478 face landmarks. Result: lips
// really get bigger, cheeks really push out, no lighting changes, same result
// every time, instant and free. Skin/line treatments still use the AI.
//
// Exposes window.Warp = { isShape, apply }.

(function () {
  // Treatments done here WITHOUT AI (reshaping + local filters). Everything else goes to the AI.
  const SHAPE = new Set([
    'lips', 'cheeks', 'chin', 'jawline',
    'browLift', 'lipFlip', 'gummy', 'masseter',
    'glabella', 'crowsFeet', 'bunny', 'mentalis',                 // wrinkle smoothing filter
    'nasolabial', 'marionette', 'tearTrough', 'eyeBright',       // shadow fill (folds, under-eyes)
    'booster', 'laser', 'pigment', 'acne',                        // skin filters
    'brighten', 'clearFace',                                      // beauty filters
  ]);
  const FILTER = new Set(['glabella', 'crowsFeet', 'bunny', 'mentalis', 'nasolabial', 'marionette', 'tearTrough', 'eyeBright',
    'booster', 'laser', 'pigment', 'acne', 'brighten']);
  const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
    152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  const LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
  const R_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
  const L_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
  const R_BROW = [46, 53, 52, 65, 55, 107, 66, 105, 63, 70];
  const L_BROW = [276, 283, 282, 295, 285, 336, 296, 334, 293, 300];

  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function frame(L) {
    const r = mid(L[33], L[133]), l = mid(L[362], L[263]);
    const ang = Math.atan2(l.y - r.y, l.x - r.x);
    const W = dist(L[234], L[454]);
    const c = Math.cos(ang), s = Math.sin(ang);
    const off = (p, dx, dy) => ({ x: p.x + (dx * c - dy * s) * W, y: p.y + (dx * s + dy * c) * W });
    const vec = (dx, dy) => ({ x: (dx * c - dy * s) * W, y: (dx * s + dy * c) * W });
    return { W, ang, off, vec };
  }

  // Deformations for one treatment at strength f (≈0.3 … 1.3).
  //   bulge: magnify around centre (ax/ay = horizontal/vertical amount, face frame)
  //   push : move content by a vector (face-width units, face frame)
  // Radii are in pixels; everything fades out smoothly to the ellipse edge.
  function deforms(id, f, L) {
    const { W, ang, off, vec } = frame(L);
    const P = i => L[i];
    const out = [];
    // Head turn: how visible each side of the face is (1 = frontal, smaller = turned away).
    // Measured from the nose tip to each face edge. Effects on a side are narrowed and
    // weakened by its visibility, so a turned face isn't pushed past its outline.
    const dR = dist(P(1), P(234)), dL = dist(P(1), P(454));
    const VIS = { '-1': Math.min(1, Math.max(0.2, (2 * dR) / (dR + dL))), '1': Math.min(1, Math.max(0.2, (2 * dL) / (dR + dL))) };
    let sv = 1;                                         // visibility of the side being built (1 outside sides())
    const bulge = (c, rx, ry, ax, ay) => out.push({ t: 'b', c, rx: rx * sv, ry, ax: ax * f * sv, ay: ay * f * sv, ang });
    const push = (c, rx, ry, dx, dy) => { const v = vec(dx * f * sv * sv, dy * f * sv); out.push({ t: 'p', c, rx: rx * sv, ry, vx: v.x, vy: v.y, ang }); };
    // side = -1 → person's right (image left), +1 → person's left
    const sides = fn => { const run = (sx, pts) => { sv = VIS[sx]; fn(sx, pts); sv = 1; }; run(-1, { apple: mid(P(50), P(205)), contourLow: mid(P(93), P(132)), cheek: mid(P(50), P(117)), zyg: mid(P(234), P(93)), angle: P(172), jowl: P(136), lowCheek: mid(P(132), P(58)), brow: mid(P(46), P(70)), temple: P(21) });
                          run(+1, { apple: mid(P(280), P(425)), contourLow: mid(P(323), P(361)), cheek: mid(P(280), P(346)), zyg: mid(P(454), P(323)), angle: P(397), jowl: P(365), lowCheek: mid(P(361), P(288)), brow: mid(P(276), P(300)), temple: P(251) }); };

    const smoothArea = (c, rx, ry, amt) => out.push({ t: 'W', c, rx: rx * sv, ry, ang, amt: Math.min(0.9, 1.9 * amt * f * sv), W });   // normal dose ≈ lines gone (a hint kept = natural)

    // Largest radius around c that stays inside the face outline (with a small margin).
    const OVAL_PTS = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
      152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109].map(P);
    const edgeCap = (c, r) => Math.min(r, Math.max(0.05 * W, 0.92 * Math.min(...OVAL_PTS.map(q => dist(q, c)))));

    const ellipsePoly = (c, rx, ry, a, n = 28) => Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2, x = Math.cos(t) * rx, y = Math.sin(t) * ry;
      return { x: c.x + x * Math.cos(a) - y * Math.sin(a), y: c.y + x * Math.sin(a) + y * Math.cos(a) };
    });

    const lipW = dist(P(61), P(291)), lipH = Math.max(dist(P(0), P(17)), 0.06 * W);
    const mouth = mid(P(13), P(14));
    // Lip expansion: lips grow away from the line where they meet (stomion);
    // eu/el = relative growth of upper/lower lip height, tapered toward the corners.
    // taper: higher = volume more concentrated in the centre of the lips.
    const lipStretch = (eu, el, taper = 2) => out.push({
      t: 'L', c: mouth, ang, halfW: lipW * 0.72, taper,
      hu: Math.max(dist(P(0), P(13)), 0.015 * W), hl: Math.max(dist(P(14), P(17)), 0.02 * W),
      eu: eu * f, el: el * f,
      // open mouth (smile): the opening between the lips must not be stretched (teeth stay as they are)
      gu: dist(mouth, P(13)), gl: dist(mouth, P(14)),
    });

    switch (id) {
      case 'lips':
        // Natural result (like real before/after photos): same lip shape, rounded,
        // fuller in the centre and softly less toward the corners; upper lip gains more.
        // Balanced: 0.5 mL ≈ +24% / +16%, 1 mL ≈ +40% / +27%, 2 mL ≈ +68% / +45% (upper / lower lip height).
        lipStretch(0.68, 0.45, 2);
        break;
        break;
      case 'lipFlip':
        lipStretch(0.45, 0);
        break;
      case 'gummy':
        push(P(0), 0.13 * W, 0.08 * W, 0, 0.016);
        break;
      case 'cheeks':
        // Volume on the cheek apples (nose level, below the cheekbone) with a gentle lift.
        // Nothing near the ears/eyes, no widening of the face.
        sides((sx, p) => {
          // radius capped so nothing reaches the face outline (ears, earrings, hair stay put)
          const r1 = edgeCap(p.apple, 0.17 * W), r2 = edgeCap(off(p.apple, 0.02 * sx, 0.03), 0.19 * W);
          bulge(p.apple, r1, r1 * 0.94, 0.3, 0.3);      // gentle magnify (strong values smear skin texture)
          push(off(p.apple, 0.02 * sx, 0.03), r2, r2 * 0.94, 0.012 * sx, -0.06);
          // Projection: a fuller cheek stands out more, so it catches a little more light on top of the
          // apple. On smooth, evenly lit skin this is the only cue that shows the added volume.
          out.push({ t: 'G', c: off(p.apple, 0.03 * sx * sv, -0.03), rx: 0.17 * W * sv, ry: 0.13 * W, ang, amt: 0.7 * f * sv, bright: 1, soft: 0, edge: 1, W });
          // Shadow fill: hollows under the cheekbone and around the apple get filled in.
          if (sv > 0.72) {     // skip on a strongly turned-away side (lighting there is unreliable)
            const k = sv * sv * sv;
            out.push({ t: 'S', grp: 'low', c: off(mid(p.apple, p.angle), 0.02 * sx * sv, -0.03), rx: 0.12 * W * sv, ry: 0.11 * W, ang, amt: 0.4 * f * k, W, vis: sv, pct: 0.62, maxG: 0.16 });
            out.push({ t: 'S', grp: 'apple', c: off(p.apple, 0.035 * sx * sv, -0.01), rx: 0.10 * W * sv, ry: 0.1 * W, ang, amt: 0.3 * f * k, W, vis: sv, pct: 0.62, maxG: 0.16 });   // kept off the nose shadow
          }
        });
        break;
      // ---- Wrinkle smoothing (no AI): lift thin dark creases toward the surrounding skin ----
      case 'glabella':  smoothArea(off(P(9), 0, -0.005), 0.085 * W, 0.085 * W, 0.9); break;
      case 'crowsFeet': sides(sx => smoothArea(off(P(sx < 0 ? 33 : 263), 0.075 * sx, 0.01), 0.065 * W, 0.075 * W, 0.85)); break;
      case 'bunny':     sides(sx => smoothArea(off(P(6), 0.045 * sx, 0.03), 0.045 * W, 0.055 * W, 0.9)); break;
      case 'mentalis':  smoothArea(off(P(152), 0, -0.06), 0.13 * W, 0.09 * W, 0.85); break;
      // ---- Beauty filter: brighter, softer, slightly warm face ----
      case 'brighten':  out.push({ t: 'G', c: off(P(5), 0, -0.06), rx: 0.62 * W, ry: 0.85 * W, ang, amt: Math.min(1.2, 0.9 * f), bright: 1, W }); break;
      case 'booster':   out.push({ t: 'G', c: off(P(5), 0, -0.06), rx: 0.62 * W, ry: 0.85 * W, ang, amt: Math.min(1.2, 0.8 * f), bright: 0.35, W }); break;
      case 'laser':     out.push({ t: 'G', c: off(P(5), 0, -0.06), rx: 0.62 * W, ry: 0.85 * W, ang, amt: Math.min(1.4, 1.15 * f), bright: 0, W }); break;

      // ---- Folds & under-eyes (no AI): fill the shadow of the fold toward the skin around it ----
      // ---- Folds & under-eyes (no AI): even out the fold — the dark groove gets lighter AND the
      //      bulge beside it (cheek fold / under-eye bag) gets flatter, so the line disappears
      //      instead of being lit up. Fold-sized frequency band, texture and overall light kept.
      case 'nasolabial':
        sides(sx => {
          // whole fold: from beside the nostril to just below the mouth corner
          const a = off(P(sx < 0 ? 129 : 358), 0.008 * sx, 0), m = off(P(sx < 0 ? 61 : 291), 0.03 * sx, 0.045), len = dist(a, m);
          // fold area as a band along the fold; lips and mouth corners cut out (their natural
          // shadows must stay, otherwise the corners get a light patch)
          out.push({ t: 'W', poly: ellipsePoly(mid(a, m), len * 0.62 + 0.02 * W, 0.075 * W * sv, Math.atan2(m.y - a.y, m.x - a.x)),
            cut: [{ poly: LIPS.map(P), grow: 0.035 * W },
              { poly: [P(sx < 0 ? 61 : 291), off(P(sx < 0 ? 61 : 291), 0.012 * sx, 0.004)], grow: 0.045 * W, line: true },   // mouth corner
              { poly: (sx < 0 ? [98, 64, 129] : [327, 294, 358]).map(P), grow: 0.022 * W, line: true }],                      // nostril wing
            c: mid(a, m), rx: len * 0.62 + 0.02 * W, ry: 0.075 * W, ang, feather: 0.02,
            amt: Math.min(1, 2.2 * f * sv), W, rs: 0.007, rb: 0.085, darkOnly: true, brightK: 0.45 });
          // filler supports the fold: slight lift of the cheek mass above it (kept away from the mouth)
          push(off(mid(a, m), 0.05 * sx, -0.025), 0.055 * W, 0.065 * W, 0.004 * sx, -0.012);
        });
        break;
      case 'marionette':
        sides(sx => {
          // mouth corner down toward the jaw (marionette line + pre-jowl groove)
          const a = P(sx < 0 ? 61 : 291), b2 = off(a, 0.045 * sx, 0.2), len = dist(a, b2);
          const cm = off(mid(a, b2), 0.006 * sx, 0), am = Math.atan2(b2.y - a.y, b2.x - a.x);
          // lips and the mouth corner itself are excluded, so the lips are never altered
          out.push({ t: 'W', poly: ellipsePoly(cm, len * 0.62, 0.075 * W * sv, am),
            cut: [{ poly: LIPS.map(P), grow: 0.035 * W }, { poly: [a, off(a, 0.012 * sx, 0.004)], grow: 0.045 * W, line: true }],
            c: cm, rx: len * 0.62, ry: 0.075 * W, ang, feather: 0.02,
            amt: Math.min(1, 2.2 * f * sv), W, rs: 0.007, rb: 0.08, darkOnly: true, brightK: 0.45 });
          // the skin just below/outside the corner lifts slightly (no downturned look) — lips stay as they are
          push(off(a, 0.03 * sx, 0.045), 0.04 * W, 0.045 * W, 0, -0.01);
        });
        break;
      case 'tearTrough':
        sides(sx => {
          // The hollow is a crescent that follows the lower eyelid. Area = band under the lid:
          // from just below the lashes down onto the upper cheek, inner corner to outer third.
          const lid = (sx < 0 ? [133, 155, 154, 153, 145, 144, 163, 7, 33] : [362, 382, 381, 380, 374, 373, 390, 249, 263]).map(P);
          const top = lid.map(q => off(q, 0, 0.024)), bot = lid.slice().reverse().map(q => off(q, 0, 0.125));
          const c = off(P(sx < 0 ? 145 : 374), 0, 0.06);
          // reference skin: the upper cheek just below the crescent
          const ref = off(P(sx < 0 ? 145 : 374), 0.01 * sx, 0.17);
          out.push({ t: 'U', poly: [...top, ...bot], c, rx: 0.14 * W, ry: 0.08 * W, ang, ref, refR: 0.045 * W,
            amt: Math.min(1, 0.8 * f * sv), W, feather: 0.04 });
        });
        break;
      case 'eyeBright':
        sides(sx => {
          out.push({ t: 'S', grp: id, c: off(P(sx < 0 ? 145 : 374), 0.005 * sx, 0.058), rx: 0.1 * W * sv, ry: 0.045 * W, ang,
            amt: Math.min(1.8, 1.5 * f * sv), W, vis: sv });
        });
        break;

      // ---- Pigmentation & acne (no AI): lighten small dark spots; acne also calms redness ----
      case 'clearFace':
        // Clear face: brighter, fresher skin only — no smoothing/blur, details stay sharp.
        out.push({ t: 'G', c: off(P(5), 0, -0.06), rx: 0.62 * W, ry: 0.85 * W, ang, amt: 1.0, bright: 1, soft: 0, W });
        break;
      case 'pigment':
      case 'acne': {
        const cut = [LIPS.map(P), R_EYE.map(P), L_EYE.map(P)].map(poly => ({ poly, grow: 0.03 * W }))
          .concat([R_BROW.map(P), L_BROW.map(P)].map(poly => ({ poly, grow: 0.03 * W, line: true })));
        out.push({ t: 'M', poly: OVAL.map(P), cut, c: P(5), rx: 0.6 * W, ry: 0.8 * W, ang, W,
          amt: Math.min(1, (id === 'acne' ? 0.9 : 1) * f), red: id === 'acne', scale: id === 'pigment' ? 0.02 : 0.012 });
        break;
      }

      case 'chin':
        push(off(P(152), 0, -0.04), 0.17 * W, 0.14 * W, 0, 0.035);
        bulge(off(P(152), 0, -0.05), 0.11 * W, 0.09 * W, 0.08, 0.08);
        break;
      case 'jawline':
        // One broad, even support along the whole jaw edge (angle → jowl → pre-jowl → chin), so the
        // line gets straighter and a little stronger. No single strong push: that made a lump at the angle.
        sides((sx, p) => {
          if (sv < 0.6) return;                 // side turned away: leave it
          push(p.angle, 0.17 * W, 0.17 * W, 0.015 * sx, 0.009);
          push(p.jowl, 0.14 * W, 0.14 * W, 0.008 * sx, 0.010);
          push(P(sx < 0 ? 149 : 378), 0.11 * W, 0.11 * W, 0.003 * sx, 0.011);
        });
        push(off(P(152), 0, -0.02), 0.12 * W, 0.1 * W, 0, 0.012);
        break;
      case 'temples':
        sides((sx, p) => push(off(p.temple, -0.035 * sx, 0.04), 0.09 * W, 0.11 * W, 0.012 * sx, 0));
        break;
      case 'nose':
        push(P(4), 0.07 * W, 0.06 * W, 0, -0.014);
        break;
      case 'browLift':
        // Botox brow lift: the brow moves up as one piece. Inner end stays; the ARCH (≈ 2/3 along,
        // above the outer iris) rises most; the tail a bit less. Kernels are centred just under the
        // brow, so brow + upper-lid skin move together (eye area opens, brow keeps its thickness),
        // while the forehead above absorbs the movement. Dense, wide kernels → smooth, no waves.
        sides(sx => {
          const line = (sx < 0 ? [107, 66, 105, 63, 70, 46] : [336, 296, 334, 293, 300, 276]).map(P);   // inner → tail
          const cum = [0];
          for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + dist(line[i - 1], line[i]));
          const total = cum[cum.length - 1];
          const at = u => {                                      // point at fraction u along the brow
            const d = u * total; let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
            const t = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
            return { x: line[i - 1].x + t * (line[i].x - line[i - 1].x), y: line[i - 1].y + t * (line[i].y - line[i - 1].y) };
          };
          const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
          const N = 14, lift = 0.036 * W * f * VIS[sx], rx = 0.07 * W * sv;
          const spacing = total / (N - 1), overlap = (rx * 2 * 0.53) / Math.max(1, spacing);   // ∫(1-s²)² ≈ 0.53·2r
          const v = vec(0, -1);
          for (let n = 0; n < N; n++) {
            const u = n / (N - 1);
            const prof = ss(0.12, 0.62, u) * (1 - 0.2 * ss(0.75, 1, u));   // 0 inner → 1 at arch → 0.8 at tail
            if (prof < 0.01) continue;
            const amt = (lift * prof) / overlap;
            out.push({ t: 'p', c: off(at(u), 0, 0.03), rx, ry: 0.085 * W, ang, vx: v.x / W * amt, vy: v.y / W * amt });
          }
        });
        break;
      case 'masseter':
        // broad, tall kernel + a small one toward the chin → the whole lower-face edge moves in evenly
        // (a small strong kernel left a dent in the outline)
        sides((sx, p) => {
          if (sv < 0.6) return;                 // side turned away: its outline is the cheek, not the jaw → leave it
          push(off(p.angle, -0.02 * sx, -0.06), 0.17 * W, 0.24 * W, -0.027 * sx, 0);
          push(p.jowl, 0.12 * W, 0.12 * W, -0.009 * sx, 0);
        });
        break;
      case 'buccal':
        sides((sx, p) => push(p.lowCheek, 0.12 * W, 0.12 * W, -0.022 * sx, 0));
        break;
      case 'doubleChin':
        push(off(P(152), 0, 0.10), 0.22 * W, 0.13 * W, 0, -0.05);
        break;
      case 'jowls': {
        // Jawline definition: one smooth, continuous tightening along the whole jaw edge.
        // Many small overlapping kernels follow the jaw curve (no gaps → no waves); each
        // pulls the soft tissue just below the edge up against the jaw, along the jaw normal.
        const J = [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397].map(P);
        const pts = [];
        for (let i = 0; i < J.length; i++) { pts.push(J[i]); if (i < J.length - 1) pts.push(mid(J[i], J[i + 1])); }
        const centre = P(1), total = 0.03 * W * f, perKernel = total / 3.2;
        for (let i = 1; i < pts.length - 1; i++) {
          const t = { x: pts[i + 1].x - pts[i - 1].x, y: pts[i + 1].y - pts[i - 1].y };
          const tl = Math.hypot(t.x, t.y) || 1; t.x /= tl; t.y /= tl;
          let nx = -t.y, ny = t.x;                               // normal, pointing into the face
          if ((centre.x - pts[i].x) * nx + (centre.y - pts[i].y) * ny < 0) { nx = -nx; ny = -ny; }
          const side = pts[i].x < centre.x ? VIS['-1'] : VIS['1'];
          const taper = Math.sin(Math.PI * i / (pts.length - 1));  // fade out toward the ears
          const amt = perKernel * side * (0.45 + 0.55 * taper);
          out.push({ t: 'p', c: { x: pts[i].x - nx * 0.03 * W, y: pts[i].y - ny * 0.03 * W },
            rx: 0.07 * W * side, ry: 0.065 * W, ang: Math.atan2(t.y, t.x), vx: nx * amt, vy: ny * amt });
        }
        break;
      }
      case 'threads':
        sides((sx, p) => {
          push(p.cheek, 0.2 * W, 0.18 * W, 0.006 * sx, -0.02);
          push(p.jowl, 0.1 * W, 0.1 * W, -0.008 * sx, -0.02);
        });
        break;
      case 'tightening':
        sides((sx, p) => push(p.jowl, 0.1 * W, 0.1 * W, -0.008 * sx, -0.02));
        push(off(P(152), 0, 0.08), 0.2 * W, 0.12 * W, 0, -0.025);
        break;
    }
    return out;
  }

  // Shadow fill: inside an ellipse, lift the LOW-FREQUENCY shading (hollows) toward the
  // brightness of the lit cheek around it. Texture and colour are kept (multiplicative
  // gain on a blurred luminance), and nothing is ever brightened above the reference
  // level — so it reads as "filled", never as highlighter.
  function shadowFill(ctx, w, h, d, dry = false) {
    const R = Math.max(d.rx, d.ry) * 1.6;
    const x0 = Math.max(0, Math.floor(d.c.x - R)), y0 = Math.max(0, Math.floor(d.c.y - R));
    const x1 = Math.min(w, Math.ceil(d.c.x + R)), y1 = Math.min(h, Math.ceil(d.c.y + R));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < 8 || bh < 8) return;
    const img = ctx.getImageData(x0, y0, bw, bh), P = img.data;
    const cos = Math.cos(d.ang), sin = Math.sin(d.ang);
    const ell = (x, y, k) => {
      const rx = x + x0 - d.c.x, ry = y + y0 - d.c.y;
      const lx = rx * cos + ry * sin, ly = -rx * sin + ry * cos;
      return (lx / (d.rx * k)) ** 2 + (ly / (d.ry * k)) ** 2;
    };
    // luminance + box blur (separable, 2 passes ≈ gaussian)
    const Y = new Float32Array(bw * bh);
    for (let i = 0; i < bw * bh; i++) Y[i] = 0.299 * P[i * 4] + 0.587 * P[i * 4 + 1] + 0.114 * P[i * 4 + 2];
    const r = Math.max(2, Math.round(d.W * 0.03));
    const blur = (src) => {
      const tmp = new Float32Array(bw * bh), out = new Float32Array(bw * bh);
      for (let y = 0; y < bh; y++) { let acc = 0, n = 0;
        for (let x = -r; x < bw + r; x++) {
          if (x + r < bw) { acc += src[y * bw + x + r]; n++; }
          if (x - r - 1 >= 0) { acc -= src[y * bw + x - r - 1]; n--; }
          if (x >= 0 && x < bw) tmp[y * bw + x] = acc / n;
        } }
      for (let x = 0; x < bw; x++) { let acc = 0, n = 0;
        for (let y = -r; y < bh + r; y++) {
          if (y + r < bh) { acc += tmp[(y + r) * bw + x]; n++; }
          if (y - r - 1 >= 0) { acc -= tmp[(y - r - 1) * bw + x]; n--; }
          if (y >= 0 && y < bh) out[y * bw + x] = acc / n;
        } }
      return out;
    };
    const S = blur(blur(Y));
    // reference = bright (lit) cheek level around the area: 75th percentile within 1.5× ellipse
    const vals = [];
    for (let y = 0; y < bh; y += 2) for (let x = 0; x < bw; x += 2) if (ell(x, y, 1.5) < 1) vals.push(S[y * bw + x]);
    if (vals.length < 20) return;
    vals.sort((a, b) => a - b);
    const ref = vals[Math.floor(vals.length * (d.pct || 0.75))];
    const maxGain = 1 + (d.maxG || 0.3) * d.amt;
    let lift = 0, cnt = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const s2 = ell(x, y, 1);
      if (s2 >= 1) continue;
      cnt++;
      const i = y * bw + x, sh = S[i];
      if (sh >= ref || sh < 1) continue;
      const wgt = (1 - s2) * (1 - s2);
      const g = Math.min(maxGain, 1 + d.amt * wgt * (ref - sh) / sh);
      lift += g - 1;
      if (dry) continue;
      P[i * 4] = Math.min(255, P[i * 4] * g); P[i * 4 + 1] = Math.min(255, P[i * 4 + 1] * g); P[i * 4 + 2] = Math.min(255, P[i * 4 + 2] * g);
    }
    if (!dry) ctx.putImageData(img, x0, y0);
    return cnt ? lift / cnt : 0;
  }

  // Separable box blur of a Float32 channel (radius r).
  function boxBlur(src, bw, bh, r) {
    const tmp = new Float32Array(bw * bh), out = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++) { let acc = 0, n = 0;
      for (let x = -r; x < bw + r; x++) {
        if (x + r < bw) { acc += src[y * bw + x + r]; n++; }
        if (x - r - 1 >= 0) { acc -= src[y * bw + x - r - 1]; n--; }
        if (x >= 0 && x < bw) tmp[y * bw + x] = acc / n;
      } }
    for (let x = 0; x < bw; x++) { let acc = 0, n = 0;
      for (let y = -r; y < bh + r; y++) {
        if (y + r < bh) { acc += tmp[(y + r) * bw + x]; n++; }
        if (y - r - 1 >= 0) { acc -= tmp[(y - r - 1) * bw + x]; n--; }
        if (y >= 0 && y < bh) out[y * bw + x] = acc / n;
      } }
    return out;
  }

  function region(ctx, w, h, d, pad = 1.05) {
    let x0, y0, x1, y1;
    if (d.poly) {
      const m = 0.06 * d.W, xs = d.poly.map(q => q.x), ys = d.poly.map(q => q.y);
      x0 = Math.max(0, Math.floor(Math.min(...xs) - m)); y0 = Math.max(0, Math.floor(Math.min(...ys) - m));
      x1 = Math.min(w, Math.ceil(Math.max(...xs) + m)); y1 = Math.min(h, Math.ceil(Math.max(...ys) + m));
    } else {
      const R = Math.max(d.rx, d.ry) * pad;
      x0 = Math.max(0, Math.floor(d.c.x - R)); y0 = Math.max(0, Math.floor(d.c.y - R));
      x1 = Math.min(w, Math.ceil(d.c.x + R)); y1 = Math.min(h, Math.ceil(d.c.y + R));
    }
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < 4 || bh < 4) return null;
    const img = ctx.getImageData(x0, y0, bw, bh);
    const cos = Math.cos(d.ang), sin = Math.sin(d.ang);
    const s2 = (x, y) => {
      const rx = x + x0 - d.c.x, ry = y + y0 - d.c.y;
      const lx = rx * cos + ry * sin, ly = -rx * sin + ry * cos;
      return (lx / d.rx) ** 2 + (ly / d.ry) ** 2;
    };
    // Polygon areas: soft (feathered) mask instead of an ellipse → even strength, soft edges.
    let wmap = null;
    if (d.poly) {
      const m = document.createElement('canvas'); m.width = bw; m.height = bh;
      const mc = m.getContext('2d');
      const feather = Math.max(2, (d.feather || 0.025) * d.W);
      // NOTE: no ctx.filter here — iPhone browsers (WebKit) handle canvas blur differently, which turned
      // these soft shapes into solid rectangles. The edge is softened in JS below instead (same on every browser).
      mc.fillStyle = '#fff';
      mc.beginPath(); d.poly.forEach((q, i) => (i ? mc.lineTo(q.x - x0, q.y - y0) : mc.moveTo(q.x - x0, q.y - y0))); mc.closePath(); mc.fill();
      if (d.cut) {                                    // keep eyes, brows, lips out of the area
        mc.globalCompositeOperation = 'destination-out';
        mc.strokeStyle = '#fff'; mc.lineJoin = 'round'; mc.lineCap = 'round';
        for (const c of d.cut) {
          mc.beginPath(); c.poly.forEach((q, i) => (i ? mc.lineTo(q.x - x0, q.y - y0) : mc.moveTo(q.x - x0, q.y - y0)));
          if (!c.line) { mc.closePath(); mc.fill(); }
          mc.lineWidth = c.grow * 2; mc.stroke();
        }
        mc.globalCompositeOperation = 'source-over';
      }
      const md = mc.getImageData(0, 0, bw, bh).data;
      let a = new Float32Array(bw * bh);
      for (let i = 0; i < bw * bh; i++) a[i] = md[i * 4 + 3] / 255;
      const r = Math.max(1, Math.round(feather * 0.9));
      wmap = boxBlur(boxBlur(a, bw, bh, r), bw, bh, r);        // ≈ gaussian feather
    }
    return { x0, y0, bw, bh, img, P: img.data, s2, wmap };
  }

  // Wrinkle smoothing (frequency separation): split luminance into
  //   fine  = Y − blur_small   (pores, skin texture)       → kept
  //   band  = blur_small − blur_big (wrinkle-sized shading) → reduced by the dose
  //   base  = blur_big          (overall shape & light)     → kept
  // Very strong band values (eyebrows, lashes, hairline, eye corners) are protected.
  function wrinkleSmooth(ctx, w, h, d) {
    const R = region(ctx, w, h, d, 1.15); if (!R) return;
    const { bw, bh, P } = R, n = bw * bh;
    const rs = Math.max(1, Math.round((d.rs || 0.0045) * d.W)), rb = Math.max(2, Math.round((d.rb || 0.045) * d.W));
    // per channel, so the groove takes the colour of the skin around it (no orange/brown tint)
    const C = [0, 1, 2].map(k => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = P[i * 4 + k]; return a; });
    const S = C.map(a => boxBlur(a, bw, bh, rs)), B = C.map(a => boxBlur(boxBlur(a, bw, bh, rb), bw, bh, rb));
    const lum = (A, i) => 0.299 * A[0][i] + 0.587 * A[1][i] + 0.114 * A[2][i];
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      let wf;
      if (R.wmap) { wf = R.wmap[i]; if (wf < 0.01) continue; }
      else { const s2 = R.s2(x, y); if (s2 >= 1) continue; wf = Math.min(1, (1 - s2) * (1 - s2) * 2.4); }
      const Yb = lum(B, i); if (Yb < 2) continue;
      const band = lum(S, i) - Yb, rel = Math.abs(band) / Yb;
      if (d.darkOnly && band >= 0 && !d.brightK) continue;    // folds: lift the groove…
      const kk = d.darkOnly && band >= 0 ? d.brightK : 1;      // …and flatten the bulge beside it a little
      const k = Math.min(1, Math.max(0, (0.48 - rel) / 0.18)) * kk;
      if (!k) continue;
      const t = Math.min(1, d.amt * wf * k);
      for (let c = 0; c < 3; c++) P[i * 4 + c] = Math.max(0, Math.min(255, C[c][i] - t * (S[c][i] - B[c][i])));
    }
    ctx.putImageData(R.img, R.x0, R.y0);
  }

  // Beauty filter: brighten midtones, soften skin (edge-aware), slight warmth. Soft edges.
  function glow(ctx, w, h, d) {
    const R = region(ctx, w, h, d); if (!R) return;
    const { bw, bh, P } = R, n = bw * bh;
    const ch = [0, 1, 2].map(k => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = P[i * 4 + k]; return a; });
    const r = Math.max(1, Math.round(0.008 * d.W));
    const B = ch.map(a => boxBlur(boxBlur(a, bw, bh, r), bw, bh, r));
    const br = d.bright ?? 1, gamma = 1 - 0.16 * d.amt * br, warm = 0.015 * d.amt * br;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const s2 = R.s2(x, y); if (s2 >= 1) continue;
      const t = Math.min(1, Math.max(0, (1 - Math.sqrt(s2)) / (d.edge || 0.45))), wgt = t * t * (3 - 2 * t);   // edge 1 = smooth dome
      const i = y * bw + x;
      const Yv = 0.299 * ch[0][i] + 0.587 * ch[1][i] + 0.114 * ch[2][i];
      const Yb = 0.299 * B[0][i] + 0.587 * B[1][i] + 0.114 * B[2][i] || 1;
      const sm = (d.soft ?? 1) * 0.45 * d.amt * Math.max(0, 1 - Math.abs(Yv - Yb) / Yb / 0.1);   // smooth skin, keep edges
      for (let k = 0; k < 3; k++) {
        const c = ch[k][i] / 255, cb = B[k][i] / 255;
        let v = Math.pow(c, gamma) * (1 - sm) + Math.pow(cb, gamma) * sm;
        v *= k === 0 ? 1 + warm : k === 2 ? 1 - warm : 1;
        P[i * 4 + k] = Math.min(255, 255 * (c + wgt * (v - c)));
      }
    }
    ctx.putImageData(R.img, R.x0, R.y0);
  }

  // Pigmentation / acne: lighten small dark spots toward the skin around them (frequency-band,
  // protected against eyes/brows by the area mask and a darkness limit); acne also pulls
  // local redness (red minus the local average red) back toward the surrounding skin tone.
  function blemish(ctx, w, h, d) {
    const R = region(ctx, w, h, d); if (!R || !R.wmap) return;
    const { bw, bh, P } = R, n = bw * bh;
    const ch = [0, 1, 2].map(k => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = P[i * 4 + k]; return a; });
    const r = Math.max(2, Math.round(d.scale * d.W));
    const B = ch.map(a => boxBlur(boxBlur(a, bw, bh, r), bw, bh, r));
    for (let i = 0; i < n; i++) {
      const wf = R.wmap[i]; if (wf < 0.01) continue;
      let rr = ch[0][i], gg = ch[1][i], bb = ch[2][i];
      const Y = 0.299 * rr + 0.587 * gg + 0.114 * bb, Yb = 0.299 * B[0][i] + 0.587 * B[1][i] + 0.114 * B[2][i];
      if (Y < 2 || Yb < 2) continue;
      if (Y < Yb) {                                         // darker spot → lift toward local skin level
        const dd = (Yb - Y) / Yb, k = Math.min(1, Math.max(0, (0.32 - dd) / 0.14));
        const g = (Y + d.amt * wf * k * (Yb - Y)) / Y;
        rr *= g; gg *= g; bb *= g;
      }
      if (d.red) {                                          // redness → toward local tone
        const ex = (rr - (gg + bb) / 2) - (B[0][i] - (B[1][i] + B[2][i]) / 2);
        if (ex > 0) { const t = d.amt * wf * ex * 0.75; rr -= t; gg += t * 0.35; bb += t * 0.25; }
      }
      P[i * 4] = Math.max(0, Math.min(255, rr)); P[i * 4 + 1] = Math.max(0, Math.min(255, gg)); P[i * 4 + 2] = Math.max(0, Math.min(255, bb));
    }
    ctx.putImageData(R.img, R.x0, R.y0);
  }

  // Under-eye: blend the dark crescent toward the colour of the cheek just below it.
  // Works on a blurred (base) layer and keeps the fine texture on top, so it never looks
  // painted; only pixels darker than the cheek are changed.
  function underEye(ctx, w, h, d) {
    const R = region(ctx, w, h, d); if (!R || !R.wmap) return;
    const { bw, bh, P, x0, y0 } = R, n = bw * bh;
    // reference colour from the cheek patch (read from the full canvas)
    const rr = Math.max(2, Math.round(d.refR));
    const rx0 = Math.max(0, Math.round(d.ref.x - rr)), ry0 = Math.max(0, Math.round(d.ref.y - rr));
    const rw = Math.min(w - rx0, 2 * rr), rh = Math.min(h - ry0, 2 * rr);
    if (rw < 2 || rh < 2) return;
    const RP = ctx.getImageData(rx0, ry0, rw, rh).data;
    const Ys = [];
    for (let i = 0; i < rw * rh; i++) Ys.push([0.299 * RP[i * 4] + 0.587 * RP[i * 4 + 1] + 0.114 * RP[i * 4 + 2], i]);
    Ys.sort((a, b) => a[0] - b[0]);
    const ref = [0, 0, 0]; let cnt = 0;
    for (let j = Math.floor(Ys.length * 0.3); j < Math.floor(Ys.length * 0.7); j++) { const i = Ys[j][1]; ref[0] += RP[i * 4]; ref[1] += RP[i * 4 + 1]; ref[2] += RP[i * 4 + 2]; cnt++; }
    if (!cnt) return;
    ref[0] /= cnt; ref[1] /= cnt; ref[2] /= cnt;
    const refY = 0.299 * ref[0] + 0.587 * ref[1] + 0.114 * ref[2];
    const C = [0, 1, 2].map(k => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = P[i * 4 + k]; return a; });
    const r = Math.max(2, Math.round(0.014 * d.W));
    const B = C.map(a => boxBlur(boxBlur(a, bw, bh, r), bw, bh, r));
    // Very dark things inside the area (glasses frames, lashes, hair) darken the blurred layer around
    // them; lifting that would draw a bright halo along the frame. Find them and stay away from them.
    const M = new Float32Array(n);
    for (let i = 0; i < n; i++) M[i] = (0.299 * C[0][i] + 0.587 * C[1][i] + 0.114 * C[2][i]) < 0.3 * refY ? 1 : 0;
    const Mb = boxBlur(boxBlur(M, bw, bh, r), bw, bh, r);
    for (let i = 0; i < n; i++) {
      const wf0 = R.wmap[i]; if (wf0 < 0.01) continue;
      const wf = wf0 * Math.max(0, 1 - Mb[i] * 4); if (wf < 0.01) continue;
      const Yb = 0.299 * B[0][i] + 0.587 * B[1][i] + 0.114 * B[2][i];
      if (Yb >= refY || Yb < 4) continue;
      const dark = (refY - Yb) / refY;
      // smooth ramps (no hard cut-offs → no islands/edges): fade in for slight darkness,
      // fade out only for lash-dark pixels
      const k = Math.min(1, dark / 0.06) * Math.min(1, Math.max(0, (0.7 - dark) / 0.2));
      const t = Math.min(0.75, d.amt * wf * k);
      if (t <= 0) continue;
      // lift brightness with a gain (keeps the skin's own hue — no grey/purple cast) …
      const Yn = Yb + t * (refY - Yb), g = Yn / Yb;
      for (let c = 0; c < 3; c++) {
        const lifted = B[c][i] * g;
        // … and nudge the colour a little toward the cheek (less purple/brown under the eye)
        const base = lifted + 0.35 * t * (ref[c] * (Yn / refY) - lifted);
        P[i * 4 + c] = Math.max(0, Math.min(255, base + (C[c][i] - B[c][i]) * (0.85 + 0.15 * g)));
      }
    }
    ctx.putImageData(R.img, x0, y0);
  }

  // CPU-only filters (also used by Live on small read-back areas).
  function cpuFilter(ctx, w, h, d) {
    if (d.t === 'W') wrinkleSmooth(ctx, w, h, d);
    else if (d.t === 'M') blemish(ctx, w, h, d);
    else if (d.t === 'U') underEye(ctx, w, h, d);
  }

  function postFilters(ctx, w, h, list) {
    list.filter(d => d.t === 'W').forEach(d => wrinkleSmooth(ctx, w, h, d));
    list.filter(d => d.t === 'M').forEach(d => blemish(ctx, w, h, d));
    list.filter(d => d.t === 'U').forEach(d => underEye(ctx, w, h, d));
    list.filter(d => d.t === 'G').forEach(d => glow(ctx, w, h, d));
  }

  // Run shadow fills so paired areas (left/right cheek) get the SAME average fill,
  // even when the photo is lit from one side.
  function shadeBalanced(ctx, w, h, list) {
    const groups = {};
    list.forEach(d => (groups[d.grp || Math.random()] ||= []).push(d));
    for (const g of Object.values(groups)) {
      if (g.length > 1 && Math.min(...g.map(d => d.vis ?? 1)) > 0.9) {   // only balance a near-frontal face
        const lifts = g.map(d => shadowFill(ctx, w, h, d, true));
        const target = Math.max(...lifts);
        g.forEach((d, i) => { if (lifts[i] > 0.0005) d.amt *= Math.min(2.5, target / lifts[i]); });
      }
      g.forEach(d => shadowFill(ctx, w, h, d));
    }
  }

  // Backward-mapped warp with bilinear sampling. src: image/canvas. items: [[id, f]].
  function apply(src, L, items) {
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, w, h);

    const ALL = items.flatMap(([id, f]) => (SHAPE.has(id) ? deforms(id, f, L) : []));
    const D = ALL.filter(d => d.t === 'b' || d.t === 'p' || d.t === 'L'), SHADE = ALL.filter(d => d.t === 'S');
    const POST = ALL.filter(d => d.t === 'W' || d.t === 'G' || d.t === 'M' || d.t === 'U');
    if (!D.length) { shadeBalanced(ctx, w, h, SHADE); postFilters(ctx, w, h, POST); return out; }

    // Only process the region the deformations touch.
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (const d of D) {
      if (d.t === 'L') {           // bounding radius for lip stretch
        d.rx = d.halfW;
        d.ry = Math.max(d.hu * (1 + d.eu) + d.hu * 1.4 + (d.gu || 0), d.hl * (1 + d.el) + d.hl * 1.4 + (d.gl || 0));
      }
      const r = Math.max(d.rx, d.ry) + 2;
      x0 = Math.min(x0, d.c.x - r); y0 = Math.min(y0, d.c.y - r);
      x1 = Math.max(x1, d.c.x + r); y1 = Math.max(y1, d.c.y + r);
    }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(w - 1, Math.ceil(x1)); y1 = Math.min(h - 1, Math.ceil(y1));

    const S = ctx.getImageData(0, 0, w, h).data;
    const img = ctx.getImageData(0, 0, w, h), O = img.data;
    for (const d of D) { d.cos = Math.cos(d.ang); d.sin = Math.sin(d.ang); }

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let ox = 0, oy = 0;
        for (const d of D) {
          const rx = x - d.c.x, ry = y - d.c.y;
          const lx = rx * d.cos + ry * d.sin, ly = -rx * d.sin + ry * d.cos;   // into face frame
          if (d.t === 'L') {
            const u = lx / d.halfW;
            if (u <= -1 || u >= 1) continue;
            const wx = Math.pow(1 - u * u, d.taper || 2);
            const up = ly < 0, h = up ? d.hu : d.hl, e = (up ? d.eu : d.el) * wx;
            if (!e) continue;
            // mouth opening at this column (0 when the mouth is closed): lips grow from their inner edge
            const ui = u / 0.66, gap = ((up ? d.gu : d.gl) || 0) * Math.sqrt(Math.max(0, 1 - ui * ui));
            const Y = Math.abs(ly) - gap;
            if (Y <= 0) continue;                                   // teeth / inside of the mouth: untouched
            const Hn = h * (1 + e), B = h * 1.4;
            let srcY;
            if (Y <= Hn) srcY = Y / (1 + e);                       // lip body: stretched
            else if (Y <= Hn + B) {                                 // skin above/below: eases back
              const t = (Y - Hn) / B, sm = t * t * (3 - 2 * t);
              srcY = Y - h * e * (1 - sm);
            } else continue;
            srcY += gap;
            const dy = (up ? -srcY : srcY) - ly;                    // local offset (face frame)
            ox += -dy * d.sin; oy += dy * d.cos;
            continue;
          }
          const s2 = (lx / d.rx) ** 2 + (ly / d.ry) ** 2;
          if (s2 >= 1) continue;
          const fall = (1 - s2) * (1 - s2);
          if (d.t === 'b') {
            const sx = -lx * d.ax * fall, sy = -ly * d.ay * fall;            // sample closer to centre → magnify
            ox += sx * d.cos - sy * d.sin; oy += sx * d.sin + sy * d.cos;
          } else {
            ox -= d.vx * fall; oy -= d.vy * fall;                             // sample from behind → content moves forward
          }
        }
        if (!ox && !oy) continue;
        const sx = Math.min(w - 1.001, Math.max(0, x + ox)), sy = Math.min(h - 1.001, Math.max(0, y + oy));
        const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy;
        const i00 = (iy * w + ix) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
        const o = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) {
          O[o + k] = (S[i00 + k] * (1 - fx) + S[i10 + k] * fx) * (1 - fy) + (S[i01 + k] * (1 - fx) + S[i11 + k] * fx) * fy;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    shadeBalanced(ctx, w, h, SHADE);
    postFilters(ctx, w, h, POST);
    return out;
  }

  // All deformations for a plan (used by the live WebGL renderer).
  const build = (items, L) => items.flatMap(([id, f]) => (SHAPE.has(id) ? deforms(id, f, L) : []));

  window.Warp = { isShape: id => SHAPE.has(id), isFilter: id => FILTER.has(id), apply, deforms: build, wrinkleSmooth, cpuFilter };
})();
