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

    const lipW = dist(P(61), P(291)), lipH = Math.max(dist(P(0), P(17)), 0.06 * W);
    const mouth = mid(P(13), P(14));
    // Lip expansion: lips grow away from the line where they meet (stomion);
    // eu/el = relative growth of upper/lower lip height, tapered toward the corners.
    // taper: higher = volume more concentrated in the centre of the lips.
    const lipStretch = (eu, el, taper = 2) => out.push({
      t: 'L', c: mouth, ang, halfW: lipW * 0.72, taper,
      hu: Math.max(dist(P(0), P(13)), 0.015 * W), hl: Math.max(dist(P(14), P(17)), 0.02 * W),
      eu: eu * f, el: el * f,
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
          bulge(p.apple, 0.16 * W, 0.15 * W, 0.34, 0.34);
          push(off(p.apple, 0.02 * sx, 0.03), 0.18 * W, 0.17 * W, 0.008 * sx, -0.032);
          push(p.contourLow, 0.09 * W, 0.11 * W, 0.018 * sx, -0.008);
          // Shadow fill: hollows under the cheekbone and around the apple get filled in.
          if (sv > 0.72) {     // skip on a strongly turned-away side (lighting there is unreliable)
            const k = sv * sv * sv;
            out.push({ t: 'S', grp: 'low', c: off(mid(p.apple, p.angle), 0.02 * sx * sv, -0.03), rx: 0.12 * W * sv, ry: 0.11 * W, ang, amt: 0.7 * f * k, W, vis: sv });
            out.push({ t: 'S', grp: 'apple', c: off(p.apple, 0.035 * sx * sv, -0.01), rx: 0.10 * W * sv, ry: 0.1 * W, ang, amt: 0.45 * f * k, W, vis: sv });   // kept off the nose shadow
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
          out.push({ t: 'W', c: mid(a, m), rx: len * 0.62 + 0.02 * W, ry: 0.075 * W * sv,
            ang: Math.atan2(m.y - a.y, m.x - a.x), amt: Math.min(1, 2.2 * f * sv), W, rs: 0.007, rb: 0.085, darkOnly: true, brightK: 0.45 });
          // filler supports the fold: slight lift of the cheek mass above it
          push(off(mid(a, m), 0.04 * sx, -0.01), 0.07 * W, 0.08 * W, 0.004 * sx, -0.012);
        });
        break;
      case 'marionette':
        sides(sx => {
          // mouth corner down toward the jaw (marionette line + pre-jowl groove)
          const a = P(sx < 0 ? 61 : 291), b2 = off(a, 0.045 * sx, 0.2), len = dist(a, b2);
          out.push({ t: 'W', c: off(mid(a, b2), 0.006 * sx, 0), rx: len * 0.62, ry: 0.075 * W * sv,
            ang: Math.atan2(b2.y - a.y, b2.x - a.x), amt: Math.min(1, 2.2 * f * sv), W, rs: 0.007, rb: 0.08, darkOnly: true, brightK: 0.45 });
          // lift the mouth corners slightly (no downturned look)
          push(off(a, 0.005 * sx, 0.01), 0.05 * W, 0.05 * W, 0, -0.012);
        });
        break;
      case 'tearTrough':
        sides(sx => {
          // the trough runs from the inner eye corner down and outward under the eye
          const inner = P(sx < 0 ? 133 : 362), lower = P(sx < 0 ? 145 : 374);
          const a = off(inner, -0.005 * sx, 0.035), b2 = off(lower, 0.035 * sx, 0.075);
          const c = mid(a, b2), ang2 = Math.atan2(b2.y - a.y, b2.x - a.x), len = dist(a, b2);
          // 1) fill the hollow's shadow up to the lit cheek level below it
          out.push({ t: 'S', grp: 'tear', c, rx: len * 0.7 + 0.02 * W, ry: 0.05 * W, ang: ang2, amt: Math.min(2.2, 1.9 * f * sv), W, vis: sv });
          // 2) even out the groove and soften the bag edge above it (per-channel, no tint)
          out.push({ t: 'W', c: off(c, 0, -0.005), rx: len * 0.75 + 0.03 * W, ry: 0.06 * W * sv, ang: ang2,
            amt: Math.min(1, 2.2 * f * sv), W, rs: 0.006, rb: 0.085, darkOnly: true, brightK: 0.5 });
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
        sides((sx, p) => push(p.angle, 0.12 * W, 0.12 * W, 0.026 * sx, 0.014));
        push(off(P(152), 0, -0.02), 0.12 * W, 0.1 * W, 0, 0.012);
        break;
      case 'temples':
        sides((sx, p) => push(off(p.temple, -0.035 * sx, 0.04), 0.09 * W, 0.11 * W, 0.012 * sx, 0));
        break;
      case 'nose':
        push(P(4), 0.07 * W, 0.06 * W, 0, -0.014);
        break;
      case 'browLift':
        sides((sx, p) => {
          push(p.brow, 0.1 * W, 0.08 * W, 0, -0.042);
          push(off(p.brow, -0.06 * sx, 0), 0.08 * W, 0.06 * W, 0, -0.012);
        });
        break;
      case 'masseter':
        sides((sx, p) => push(off(p.angle, -0.02 * sx, -0.04), 0.13 * W, 0.16 * W, -0.035 * sx, 0));
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
    const ref = vals[Math.floor(vals.length * 0.75)];
    const maxGain = 1 + 0.3 * d.amt;
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
      const feather = Math.max(2, 0.025 * d.W);
      mc.filter = `blur(${feather}px)`;
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
      wmap = new Float32Array(bw * bh);
      for (let i = 0; i < bw * bh; i++) wmap[i] = md[i * 4 + 3] / 255;
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
      const t = Math.min(1, Math.max(0, (1 - Math.sqrt(s2)) / 0.45)), wgt = t * t * (3 - 2 * t);
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

  // CPU-only filters (also used by Live on small read-back areas).
  function cpuFilter(ctx, w, h, d) {
    if (d.t === 'W') wrinkleSmooth(ctx, w, h, d);
    else if (d.t === 'M') blemish(ctx, w, h, d);
  }

  function postFilters(ctx, w, h, list) {
    list.filter(d => d.t === 'W').forEach(d => wrinkleSmooth(ctx, w, h, d));
    list.filter(d => d.t === 'M').forEach(d => blemish(ctx, w, h, d));
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
    const POST = ALL.filter(d => d.t === 'W' || d.t === 'G' || d.t === 'M');
    if (!D.length) { shadeBalanced(ctx, w, h, SHADE); postFilters(ctx, w, h, POST); return out; }

    // Only process the region the deformations touch.
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (const d of D) {
      if (d.t === 'L') {           // bounding radius for lip stretch
        d.rx = d.halfW;
        d.ry = Math.max(d.hu * (1 + d.eu) + d.hu * 1.4, d.hl * (1 + d.el) + d.hl * 1.4);
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
            const up = ly < 0, Y = Math.abs(ly), h = up ? d.hu : d.hl, e = (up ? d.eu : d.el) * wx;
            if (!e) continue;
            const Hn = h * (1 + e), B = h * 1.4;
            let srcY;
            if (Y <= Hn) srcY = Y / (1 + e);                       // lip body: stretched
            else if (Y <= Hn + B) {                                 // skin above/below: eases back
              const t = (Y - Hn) / B, sm = t * t * (3 - 2 * t);
              srcY = Y - h * e * (1 - sm);
            } else continue;
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
