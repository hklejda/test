// Face mapping + protected compositing.
//
// Why: image-edit models tend to change the whole face (skin, eyes, nose…) even
// when asked to edit only the lips. To guarantee that ONLY the selected areas
// change, we:
//   1. find 478 face landmarks on the original photo (MediaPipe Face Landmarker),
//   2. build a soft mask covering just the selected treatment areas,
//   3. align the AI result to the original (landmarks on both images),
//   4. paste the AI pixels back ONLY inside the mask. Everything else is the
//      original photo, pixel for pixel.
//
// Exposes window.Face = { load, detect, buildMask, protect, tint, hasRegion }.

(function () {
  const CFG = Object.assign({
    bundle: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
    wasmBase: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
    model: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  }, window.FACE_CONFIG || {});

  /* ---------------- Landmarker ---------------- */
  let landmarkerPromise = null;
  function load() {
    if (!landmarkerPromise) {
      landmarkerPromise = (async () => {
        const vision = await import(CFG.bundle);
        const fileset = await vision.FilesetResolver.forVisionTasks(CFG.wasmBase);
        return vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: CFG.model, delegate: 'CPU' },
          runningMode: 'IMAGE',
          numFaces: 1,
        });
      })();
      landmarkerPromise.catch(() => { landmarkerPromise = null; }); // allow retry
    }
    return landmarkerPromise;
  }

  const sizeOf = s => ({ w: s.naturalWidth || s.videoWidth || s.width, h: s.naturalHeight || s.videoHeight || s.height });

  async function detect(source) {
    const lm = await load();
    const { w, h } = sizeOf(source);
    const res = lm.detect(source);
    const f = res.faceLandmarks && res.faceLandmarks[0];
    return f ? f.map(p => ({ x: p.x * w, y: p.y * h })) : null;
  }

  /* ---------------- Geometry helpers ---------------- */
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // Face coordinate frame: W = face width, x → image right, y → down the face.
  function frame(L) {
    const r = mid(L[33], L[133]), l = mid(L[362], L[263]);
    const ang = Math.atan2(l.y - r.y, l.x - r.x);
    const W = dist(L[234], L[454]);
    const c = Math.cos(ang), s = Math.sin(ang);
    const off = (p, dx, dy) => ({ x: p.x + (dx * c - dy * s) * W, y: p.y + (dx * s + dy * c) * W });
    return { W, ang, off };
  }

  // Landmark index sets (MediaPipe 468/478 mesh). "R" = person's right = image left.
  const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
    152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  const LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
  const JAW = [132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361];
  const LOWER_JAW = [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397];
  const R_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
  const L_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
  const R_BROW = [46, 53, 52, 65, 55, 107, 66, 105, 63, 70];
  const L_BROW = [276, 283, 282, 295, 285, 336, 296, 334, 293, 300];
  const R_BROW_TOP = [70, 63, 105, 66, 107];
  const L_BROW_TOP = [300, 293, 334, 296, 336];
  // Points that treatments don't move — used to align the AI result to the original.
  const STABLE = [33, 133, 362, 263, 168, 6, 9, 151, 10, 234, 454, 127, 356, 159, 386];

  // Region shapes, in face-width units. Each returns { add: [...], cut: [...] }.
  //   e = ellipse, p = polygon (grow = dilation), l = thick polyline
  function regions(id, L) {
    const { W, ang, off } = frame(L);
    const P = i => L[i];
    const pts = idx => idx.map(P);
    const e = (c, rx, ry) => ({ t: 'e', c, rx: rx * W, ry: ry * W, a: ang });
    const p = (points, grow = 0) => ({ t: 'p', pts: points, grow: grow * W });
    const l = (points, w) => ({ t: 'l', pts: points, w: w * W });
    const below = (idx, d) => idx.map(i => off(P(i), 0, d)).reverse();

    const skinCut = [p(pts(R_EYE), 0.02), p(pts(L_EYE), 0.02), l(pts(R_BROW), 0.05), l(pts(L_BROW), 0.05), p(pts(LIPS), 0.005)];
    const faceSkin = [p(pts(OVAL), 0.015)];
    const underEyes = (rx, ry) => [e(off(P(145), 0, 0.06), rx, ry), e(off(P(374), 0, 0.06), rx, ry)];
    const cheeks = [
      e(off(mid(P(50), P(117)), -0.02, -0.01), 0.19, 0.15), e(off(mid(P(280), P(346)), 0.02, -0.01), 0.19, 0.15),
      l(pts([127, 234, 93, 132]), 0.09), l(pts([356, 454, 323, 361]), 0.09),
      e(off(P(205), 0, 0.02), 0.09, 0.08), e(off(P(425), 0, 0.02), 0.09, 0.08)];
    const jawLine = [l(pts(JAW), 0.11)];
    const jowls = [e(off(P(136), 0.02, -0.02), 0.1, 0.09), e(off(P(365), -0.02, -0.02), 0.1, 0.09)];
    const naso = [
      l([P(129), off(mid(P(129), P(61)), -0.015, 0), off(P(61), -0.02, 0.025)], 0.09),
      l([P(358), off(mid(P(358), P(291)), 0.015, 0), off(P(291), 0.02, 0.025)], 0.09),
    ];

    switch (id) {
      // Fillers
      case 'lips':       return { add: [p(pts(LIPS), 0.05)] };
      case 'cheeks':     return { add: cheeks };
      case 'chin':       return { add: [e(off(P(152), 0, -0.06), 0.17, 0.12)] };
      case 'jawline':    return { add: jawLine };
      case 'nasolabial': return { add: naso };
      case 'marionette': return { add: [
        l([P(61), off(P(61), -0.035, 0.17)], 0.09),
        l([P(291), off(P(291), 0.035, 0.17)], 0.09)] };
      case 'tearTrough': return { add: underEyes(0.11, 0.055) };
      case 'temples':    return { add: [e(off(P(21), 0.035, 0.04), 0.075, 0.11), e(off(P(251), -0.035, 0.04), 0.075, 0.11)] };
      case 'nose':       return { add: [l(pts([168, 6, 197, 195, 5, 4]), 0.12), e(P(1), 0.1, 0.075)] };

      // Botox
      case 'forehead':   return { add: [e(off(P(151), 0, -0.01), 0.33, 0.13)] };
      case 'glabella':   return { add: [e(P(9), 0.08, 0.08)] };
      case 'crowsFeet':  return { add: [e(off(P(33), -0.07, 0), 0.07, 0.08), e(off(P(263), 0.07, 0), 0.07, 0.08)] };
      case 'browLift':   return { add: [
        l(pts(R_BROW_TOP), 0.08), l(R_BROW_TOP.map(i => off(P(i), 0, -0.03)), 0.08),
        l(pts(L_BROW_TOP), 0.08), l(L_BROW_TOP.map(i => off(P(i), 0, -0.03)), 0.08),
        e(mid(P(105), P(159)), 0.11, 0.06), e(mid(P(334), P(386)), 0.11, 0.06)] };
      case 'bunny':      return { add: [e(off(P(6), -0.045, 0.03), 0.04, 0.05), e(off(P(6), 0.045, 0.03), 0.04, 0.05)] };
      case 'lipFlip':    return { add: [p(pts(LIPS), 0.035)] };
      case 'gummy':      return { add: [p(pts(LIPS), 0.04)] };
      case 'masseter':   return { add: [e(off(P(172), 0.05, -0.06), 0.12, 0.15), e(off(P(397), -0.05, -0.06), 0.12, 0.15)] };
      case 'mentalis':   return { add: [e(off(P(152), 0, -0.06), 0.13, 0.09)] };
      case 'platysma':   return { add: [p([...pts(LOWER_JAW), ...below(LOWER_JAW, 0.45)]), ...jawLine] };

      // Skin
      case 'booster': case 'peel': case 'microneedling': case 'laser': case 'pigment': case 'acne':
        return { add: faceSkin, cut: skinCut };
      case 'eyeBright':  return { add: underEyes(0.12, 0.065) };
      case 'tightening': return { add: [...faceSkin, ...jawLine, p([...pts(LOWER_JAW), ...below(LOWER_JAW, 0.12)])], cut: skinCut };

      // Contouring
      case 'doubleChin': return { add: [p([...pts([136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365]), ...below([136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365], 0.3)]), e(off(P(152), 0, 0.02), 0.16, 0.08)] };
      case 'buccal':     return { add: [e(mid(P(50), P(172)), 0.11, 0.11), e(mid(P(280), P(397)), 0.11, 0.11), l(pts([93, 132, 58, 172]), 0.08), l(pts([323, 361, 288, 397]), 0.08)] };
      case 'jowls':      return { add: [...jowls, ...jawLine] };
      case 'threads':    return { add: [...cheeks, ...jowls, ...jawLine, ...naso] };
      default: return null;
    }
  }

  const hasRegion = id => !!regions(id, Array.from({ length: 478 }, () => ({ x: 0, y: 0 })));

  /* ---------------- Mask ---------------- */
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function drawShape(ctx, s) {
    ctx.beginPath();
    if (s.t === 'e') {
      ctx.ellipse(s.c.x, s.c.y, s.rx, s.ry, s.a, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.t === 'p') {
      s.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fill();
      if (s.grow > 0) { ctx.lineWidth = s.grow * 2; ctx.lineJoin = 'round'; ctx.stroke(); }
    } else if (s.t === 'l') {
      s.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.lineWidth = s.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  const FILTER_OK = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

  // Returns a canvas whose ALPHA is the mask (1 = take AI pixels, 0 = keep original).
  function buildMask(ids, landmarkSets, w, h) {
    const W = frame(landmarkSets[0]).W;
    const hard = canvas(w, h);
    const hctx = hard.getContext('2d');
    for (const id of ids) {
      for (const L of landmarkSets) {
        const r = regions(id, L);
        if (!r) continue;
        const layer = canvas(w, h);
        const c = layer.getContext('2d');
        c.fillStyle = c.strokeStyle = '#fff';
        r.add.forEach(s => drawShape(c, s));
        if (r.cut) { c.globalCompositeOperation = 'destination-out'; r.cut.forEach(s => drawShape(c, s)); }
        hctx.drawImage(layer, 0, 0);
      }
    }
    // Feather the edges so the blend is invisible.
    const sigma = Math.max(3, 0.03 * W);
    const soft = canvas(w, h);
    const sctx = soft.getContext('2d');
    if (FILTER_OK) {
      sctx.filter = `blur(${sigma}px)`;
      sctx.drawImage(hard, 0, 0);
    } else {
      const k = Math.max(1, sigma * 1.5);
      const small = canvas(Math.max(1, Math.round(w / k)), Math.max(1, Math.round(h / k)));
      const m = small.getContext('2d');
      m.imageSmoothingQuality = 'high';
      m.drawImage(hard, 0, 0, small.width, small.height);
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(small, 0, 0, w, h);
    }
    return soft;
  }

  /* ---------------- Alignment (2D similarity, least squares) ---------------- */
  function similarity(src, dst) {
    const n = src.length;
    let sx = 0, sy = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { sx += src[i].x; sy += src[i].y; dx += dst[i].x; dy += dst[i].y; }
    sx /= n; sy /= n; dx /= n; dy /= n;
    let a = 0, b = 0, norm = 0;
    for (let i = 0; i < n; i++) {
      const px = src[i].x - sx, py = src[i].y - sy, qx = dst[i].x - dx, qy = dst[i].y - dy;
      a += px * qx + py * qy;
      b += px * qy - py * qx;
      norm += px * px + py * py;
    }
    const c = a / norm, s = b / norm;
    return { c, s, tx: dx - (c * sx - s * sy), ty: dy - (s * sx + c * sy) };
  }
  const applyM = (M, q) => ({ x: M.c * q.x - M.s * q.y + M.tx, y: M.s * q.x + M.c * q.y + M.ty });

  /* ---------------- Seamless matching ---------------- */
  // AI models often re-light the photo or shift brightness/colour. If we pasted
  // their pixels directly, each treated area would show as a lighter or darker
  // patch. Instead (gradient-domain idea, as in "seamless cloning"):
  //   D = original − AI result, measured just OUTSIDE the treated areas,
  //   smoothly interpolated INTO them (push-pull pyramid),
  //   AI pixels + D  → matches the original exactly at every border, while the
  //   real shape/texture change inside the area is kept.
  function pushPull(vals, wts, w, h) {
    if (w <= 2 && h <= 2) return;
    const W2 = Math.ceil(w / 2), H2 = Math.ceil(h / 2);
    const v2 = new Float32Array(W2 * H2 * 3), w2 = new Float32Array(W2 * H2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, j = (y >> 1) * W2 + (x >> 1), wt = wts[i];
      if (!wt) continue;
      w2[j] += wt;
      v2[j * 3] += wt * vals[i * 3]; v2[j * 3 + 1] += wt * vals[i * 3 + 1]; v2[j * 3 + 2] += wt * vals[i * 3 + 2];
    }
    for (let j = 0; j < W2 * H2; j++) {
      if (w2[j] > 0) { v2[j * 3] /= w2[j]; v2[j * 3 + 1] /= w2[j]; v2[j * 3 + 2] /= w2[j]; }
      w2[j] = Math.min(1, w2[j]);
    }
    pushPull(v2, w2, W2, H2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, wt = wts[i];
      if (wt >= 1) continue;
      // bilinear sample of the coarse level
      const fx = Math.min(W2 - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), fy = Math.min(H2 - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W2 - 1, x0 + 1), y1 = Math.min(H2 - 1, y0 + 1);
      const ax = fx - x0, ay = fy - y0;
      for (let k = 0; k < 3; k++) {
        const c = (v2[(y0 * W2 + x0) * 3 + k] * (1 - ax) + v2[(y0 * W2 + x1) * 3 + k] * ax) * (1 - ay) +
                  (v2[(y1 * W2 + x0) * 3 + k] * (1 - ax) + v2[(y1 * W2 + x1) * 3 + k] * ax) * ay;
        vals[i * 3 + k] = wt * vals[i * 3 + k] + (1 - wt) * c;
      }
      wts[i] = 1;
    }
  }

  function seamless(origCanvas, warpCtx, maskCanvas, w, h) {
    // Work on a small copy — the correction is smooth by nature.
    const sc = Math.min(1, 360 / Math.max(w, h));
    const sw = Math.max(4, Math.round(w * sc)), sh = Math.max(4, Math.round(h * sc));
    const grab = src => { const c = canvas(sw, sh), x = c.getContext('2d'); x.drawImage(src, 0, 0, sw, sh); return x.getImageData(0, 0, sw, sh).data; };
    const O = grab(origCanvas), A = grab(warpCtx.canvas), M = grab(maskCanvas);

    const n = sw * sh, vals = new Float32Array(n * 3), wts = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // known = clearly outside every treated area, and covered by the AI image
      if (M[i * 4 + 3] < 6 && A[i * 4 + 3] > 250) {
        wts[i] = 1;
        for (let k = 0; k < 3; k++) vals[i * 3 + k] = O[i * 4 + k] - A[i * 4 + k];
      }
    }
    pushPull(vals, wts, sw, sh);

    // Encode the offset (±127) into an image, upscale smoothly, apply at full size.
    const oc = canvas(sw, sh), ox = oc.getContext('2d'), od = ox.createImageData(sw, sh);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) od.data[i * 4 + k] = Math.max(0, Math.min(255, Math.round(vals[i * 3 + k] + 128)));
      od.data[i * 4 + 3] = 255;
    }
    ox.putImageData(od, 0, 0);
    const big = canvas(w, h), bx = big.getContext('2d', { willReadFrequently: true });
    bx.imageSmoothingQuality = 'high';
    bx.drawImage(oc, 0, 0, w, h);
    const D = bx.getImageData(0, 0, w, h).data;
    const wd = warpCtx.getImageData(0, 0, w, h), P = wd.data;
    for (let i = 0; i < P.length; i += 4) {
      if (!P[i + 3]) continue;
      P[i] += D[i] - 128; P[i + 1] += D[i + 1] - 128; P[i + 2] += D[i + 2] - 128;
    }
    warpCtx.putImageData(wd, 0, 0);
  }

  /* ---------------- Protect ---------------- */
  // original: canvas/img of the source photo. origL: its landmarks.
  // result: img/bitmap returned by the model. ids: selected treatment ids.
  async function protect({ original, origL, result, ids }) {
    const { w, h } = sizeOf(original);
    const { w: rw, h: rh } = sizeOf(result);

    let resL = null;
    try { resL = await detect(result); } catch { /* fall back to plain fit */ }

    let M;
    if (resL) {
      M = similarity(STABLE.map(i => resL[i]), STABLE.map(i => origL[i]));
    } else {
      const s = Math.min(w / rw, h / rh);
      M = { c: s, s: 0, tx: (w - rw * s) / 2, ty: (h - rh * s) / 2 };
    }

    const warped = canvas(w, h);
    const wctx = warped.getContext('2d', { willReadFrequently: true });
    wctx.setTransform(M.c, M.s, -M.s, M.c, M.tx, M.ty);
    wctx.imageSmoothingQuality = 'high';
    wctx.drawImage(result, 0, 0);
    wctx.setTransform(1, 0, 0, 1, 0, 0);

    // Mask = selected areas on the original AND where they ended up in the result
    // (e.g. fuller lips extend past the original lip line).
    const sets = [origL];
    if (resL) sets.push(resL.map(q => applyM(M, q)));
    const mask = buildMask(ids, sets, w, h);

    const out = canvas(w, h);
    const octx = out.getContext('2d', { willReadFrequently: true });
    octx.drawImage(original, 0, 0, w, h);

    try { seamless(out, wctx, mask, w, h); } catch (e) { console.warn('seamless blend skipped', e); }

    wctx.globalCompositeOperation = 'destination-in';
    wctx.drawImage(mask, 0, 0);
    octx.drawImage(warped, 0, 0);

    const scale = Math.hypot(M.c, M.s);
    return { canvas: out, mask, aligned: !!resL, scale };
  }

  /* ---------------- Area preview ---------------- */
  function tint(original, mask, color = '#c0587a') {
    const { w, h } = sizeOf(original);
    const out = canvas(w, h);
    const o = out.getContext('2d');
    o.drawImage(original, 0, 0, w, h);
    const t = canvas(w, h);
    const tc = t.getContext('2d');
    tc.fillStyle = color;
    tc.fillRect(0, 0, w, h);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(mask, 0, 0);
    o.globalAlpha = 0.55;
    o.drawImage(t, 0, 0);
    return out;
  }

  window.Face = { load, detect, buildMask, protect, tint, hasRegion };
})();
