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
  const SHAPE = new Set([
    'lips', 'cheeks', 'chin', 'jawline',
    'browLift', 'lipFlip', 'gummy', 'masseter',
    'doubleChin', 'buccal', 'jowls', 'threads', 'tightening',
  ]);

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
    const bulge = (c, rx, ry, ax, ay) => out.push({ t: 'b', c, rx, ry, ax: ax * f, ay: ay * f, ang });
    const push = (c, rx, ry, dx, dy) => { const v = vec(dx * f, dy * f); out.push({ t: 'p', c, rx, ry, vx: v.x, vy: v.y, ang }); };
    // side = -1 → person's right (image left), +1 → person's left
    const sides = fn => { fn(-1, { apple: mid(P(50), P(205)), contourLow: mid(P(93), P(132)), cheek: mid(P(50), P(117)), zyg: mid(P(234), P(93)), angle: P(172), jowl: P(136), lowCheek: mid(P(132), P(58)), brow: mid(P(46), P(70)), temple: P(21) });
                          fn(+1, { apple: mid(P(280), P(425)), contourLow: mid(P(323), P(361)), cheek: mid(P(280), P(346)), zyg: mid(P(454), P(323)), angle: P(397), jowl: P(365), lowCheek: mid(P(361), P(288)), brow: mid(P(276), P(300)), temple: P(251) }); };

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
          out.push({ t: 'S', grp: 'low', c: off(mid(p.apple, p.angle), 0.01 * sx, -0.03), rx: 0.13 * W, ry: 0.11 * W, ang, amt: 0.7 * f, W });
          out.push({ t: 'S', grp: 'apple', c: off(p.apple, 0, -0.01), rx: 0.13 * W, ry: 0.11 * W, ang, amt: 0.45 * f, W });
        });
        break;
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
        // Jawline definition: tighten the soft tissue just below the jaw edge up against it,
        // from the jaw angle to beside the chin (the chin centre is handled by Double chin).
        for (const i of [172, 136, 150, 176, 397, 365, 379, 400]) {
          const sx = [172, 136, 150, 176].includes(i) ? -1 : 1;
          push(off(P(i), 0, 0.045), 0.09 * W, 0.075 * W, -0.008 * sx, -0.028);
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

  // Run shadow fills so paired areas (left/right cheek) get the SAME average fill,
  // even when the photo is lit from one side.
  function shadeBalanced(ctx, w, h, list) {
    const groups = {};
    list.forEach(d => (groups[d.grp || Math.random()] ||= []).push(d));
    for (const g of Object.values(groups)) {
      if (g.length > 1) {
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
    const D = ALL.filter(d => d.t !== 'S'), SHADE = ALL.filter(d => d.t === 'S');
    if (!D.length) { shadeBalanced(ctx, w, h, SHADE); return out; }

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
    return out;
  }

  window.Warp = { isShape: id => SHAPE.has(id), apply };
})();
