// Live preview — "Snapchat-style" real-time reshaping on the camera feed.
//
// Every frame: track the face (MediaPipe, VIDEO mode, smoothed), build the same
// deformations the photo pipeline uses (Warp.deforms), and render them on the GPU
// with a WebGL2 fragment shader. Shape treatments are live; AI skin treatments are
// applied after capture (they take seconds and cost per image).
//
// Exposes window.Live = { supported, start, stop, setBypass, captureFrame }.

(function () {
  const MAXD = 64;

  const VS = `#version 300 es
in vec2 a;
out vec2 uv;
void main() { uv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;

  // Same maths as warp.js (backward mapping), one deformation per uniform slot:
  //   d0 = (type, cx, cy, angle)   type: 0 bulge, 1 push, 2 lip stretch, 3 shadow fill, 4 wrinkle smooth, 5 glow
  //   d1 = bulge (rx, ry, ax, ay) | push (rx, ry, vx, vy) | lip (halfW, taper, gapUp, gapLow) | shade (rx, ry, amt, -)
  //   d2 = lip (hu, hl, eu, el) | shade (mipLevel, -, -, -)
  const FS = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D tex;
uniform vec2 size;
uniform int n;
uniform vec4 d0[${MAXD}];
uniform vec4 d1[${MAXD}];
uniform vec4 d2[${MAXD}];
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 p = vec2(uv.x, 1.0 - uv.y) * size;
  vec2 off = vec2(0.0);
  for (int i = 0; i < ${MAXD}; i++) {
    if (i >= n) break;
    vec4 a = d0[i], b = d1[i], c = d2[i];
    if (a.x > 2.5) continue;
    vec2 r = p - a.yz;
    float cs = cos(a.w), sn = sin(a.w);
    vec2 l = vec2(r.x * cs + r.y * sn, -r.x * sn + r.y * cs);
    if (a.x < 0.5) {
      vec2 q = l / b.xy; float s2 = dot(q, q);
      if (s2 >= 1.0) continue;
      float fall = (1.0 - s2) * (1.0 - s2);
      vec2 sl = -l * b.zw * fall;
      off += vec2(sl.x * cs - sl.y * sn, sl.x * sn + sl.y * cs);
    } else if (a.x < 1.5) {
      vec2 q = l / b.xy; float s2 = dot(q, q);
      if (s2 >= 1.0) continue;
      float fall = (1.0 - s2) * (1.0 - s2);
      off -= b.zw * fall;
    } else {
      float u = l.x / b.x;
      if (abs(u) >= 1.0) continue;
      float wx = pow(1.0 - u * u, b.y);
      bool up = l.y < 0.0;
      float h = up ? c.x : c.y;
      float e = (up ? c.z : c.w) * wx;
      if (e <= 0.0) continue;
      float ui = u / 0.66;
      float gap = (up ? b.z : b.w) * sqrt(max(0.0, 1.0 - ui * ui));   // mouth opening: not stretched
      float Y = abs(l.y) - gap;
      if (Y <= 0.0) continue;
      float Hn = h * (1.0 + e), B = h * 1.4, srcY;
      if (Y <= Hn) srcY = Y / (1.0 + e);
      else if (Y <= Hn + B) { float t = (Y - Hn) / B; float sm = t * t * (3.0 - 2.0 * t); srcY = Y - h * e * (1.0 - sm); }
      else continue;
      srcY += gap;
      float dy = (up ? -srcY : srcY) - l.y;
      off += vec2(-dy * sn, dy * cs);
    }
  }
  vec2 q = clamp(p + off, vec2(0.5), size - 0.5);
  vec2 tuv = q / size;
  vec3 col = texture(tex, tuv).rgb;

  // Shadow fill (cheeks): lift blurred shading toward the lit-cheek level around it.
  for (int i = 0; i < ${MAXD}; i++) {
    if (i >= n) break;
    vec4 a = d0[i], b = d1[i], c = d2[i];
    if (a.x < 2.5 || a.x > 3.5) continue;
    vec2 r = p - a.yz;
    float cs = cos(a.w), sn = sin(a.w);
    vec2 l = vec2(r.x * cs + r.y * sn, -r.x * sn + r.y * cs);
    vec2 qq = l / b.xy; float s2 = dot(qq, qq);
    if (s2 >= 1.0) continue;
    float S = lum(textureLod(tex, tuv, c.x).rgb);
    float ref = 0.0;
    for (int k = 0; k < 8; k++) {
      float ang = float(k) * 0.7853982;
      vec2 lp = vec2(cos(ang) * b.x, sin(ang) * b.y) * 1.2;
      vec2 ip = a.yz + vec2(lp.x * cs - lp.y * sn, lp.x * sn + lp.y * cs);
      ref = max(ref, lum(textureLod(tex, clamp(ip, vec2(0.5), size - 0.5) / size, c.x + 1.0).rgb));
    }
    ref = min(ref, lum(textureLod(tex, a.yz / size, c.x + 2.0).rgb) * 1.25);
    if (S < ref && S > 0.004) {
      float w = (1.0 - s2) * (1.0 - s2);
      float g = min(1.0 + 0.3 * b.z, 1.0 + b.z * w * (ref - S) / S);
      col = min(col * g, vec3(1.0));
    }
  }

  // Wrinkle smoothing (4) and glow / brightening (5).
  for (int i = 0; i < ${MAXD}; i++) {
    if (i >= n) break;
    vec4 a = d0[i], b = d1[i], c = d2[i];
    if (a.x < 3.5) continue;
    vec2 r = p - a.yz;
    float cs = cos(a.w), sn = sin(a.w);
    vec2 l = vec2(r.x * cs + r.y * sn, -r.x * sn + r.y * cs);
    vec2 qq = l / b.xy; float s2 = dot(qq, qq);
    if (s2 >= 1.0) continue;
    if (a.x < 4.5) {
      // frequency separation: reduce the wrinkle-sized band, keep fine texture and base
      float Yv = lum(col);
      float Ys = lum(textureLod(tex, tuv, c.x).rgb);
      float Yb = 0.0;                                   // wide blur: 5×5 taps over ±rb, pre-smoothed by mip
      for (int yy = -2; yy <= 2; yy++) for (int xx = -2; xx <= 2; xx++)
        Yb += lum(textureLod(tex, clamp(q + vec2(float(xx), float(yy)) * c.y * 0.5, vec2(0.5), size - 0.5) / size, c.z).rgb);
      Yb /= 25.0;
      if (Yv < 0.008 || Yb < 0.008) continue;
      float band = Ys - Yb, rel = abs(band) / Yb;
      float k = clamp((0.48 - rel) / 0.18, 0.0, 1.0);
      float w = min(1.0, (1.0 - s2) * (1.0 - s2) * 1.6);
      col = min(col * max(0.6, (Yv - b.z * w * k * band) / Yv), vec3(1.0));
    } else {
      float t = clamp((1.0 - sqrt(s2)) / 0.45, 0.0, 1.0), w = t * t * (3.0 - 2.0 * t);
      vec3 cb = textureLod(tex, tuv, c.x).rgb;
      float Yv = lum(col), Yb = max(lum(cb), 0.004);
      float sm = c.y * 0.45 * b.z * max(0.0, 1.0 - abs(Yv - Yb) / Yb / 0.1);   // c.y = smoothing share
      float gm = 1.0 - 0.16 * b.z * b.w;                 // b.w = brightening share (0 = smoothing only)
      vec3 v = mix(pow(col, vec3(gm)), pow(cb, vec3(gm)), sm);
      v *= vec3(1.0 + 0.015 * b.z * b.w, 1.0, 1.0 - 0.015 * b.z * b.w);
      col = min(mix(col, v, w), vec3(1.0));
    }
  }
  o = vec4(col, 1.0);
}`;

  const supported = (() => {
    try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
  })();

  let overlay = null, octx = null, scratch = null, sctx = null, lastW = [], overlayUsed = false;
  let gl = null, prog = null, texObj = null, loc = {}, raf = 0, running = false;
  let video = null, canvas = null, getItems = null, onStatus = null, landmarker = null;
  let smooth = null, lastTs = -1, bypass = false, missed = 0;
  const U0 = new Float32Array(MAXD * 4), U1 = new Float32Array(MAXD * 4), U2 = new Float32Array(MAXD * 4);

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  function initGL() {
    gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL2 not available');
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aLoc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
    texObj = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texObj);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (const k of ['tex', 'size', 'n', 'd0', 'd1', 'd2']) loc[k] = gl.getUniformLocation(prog, k);
    gl.uniform1i(loc.tex, 0);
  }

  // Exponential smoothing of landmarks; resets on big jumps (fast head moves).
  function smoothLandmarks(L) {
    if (!smooth || smooth.length !== L.length) { smooth = L.map(p => ({ x: p.x, y: p.y })); return smooth; }
    const W = Math.hypot(L[234].x - L[454].x, L[234].y - L[454].y) || 1;
    const jump = Math.hypot(L[1].x - smooth[1].x, L[1].y - smooth[1].y) / W;
    const a = jump > 0.08 ? 1 : 0.55;
    for (let i = 0; i < L.length; i++) {
      smooth[i].x += a * (L[i].x - smooth[i].x);
      smooth[i].y += a * (L[i].y - smooth[i].y);
    }
    return smooth;
  }

  function pack(D0, W) {
    const D = D0.filter(d => d.t !== 'W' && d.t !== 'M' && d.t !== 'U');   // CPU filters run in cpuPost()
    const n = Math.min(MAXD, D.length);
    U0.fill(0); U1.fill(0); U2.fill(0);
    for (let i = 0; i < n; i++) {
      const d = D[i], j = i * 4;
      if (d.t === 'b') {
        U0.set([0, d.c.x, d.c.y, d.ang], j); U1.set([d.rx, d.ry, d.ax, d.ay], j);
      } else if (d.t === 'p') {
        U0.set([1, d.c.x, d.c.y, d.ang], j); U1.set([d.rx, d.ry, d.vx, d.vy], j);
      } else if (d.t === 'L') {
        U0.set([2, d.c.x, d.c.y, d.ang], j); U1.set([d.halfW, d.taper || 2, d.gu || 0, d.gl || 0], j); U2.set([d.hu, d.hl, d.eu, d.el], j);
      } else if (d.t === 'S') {
        U0.set([3, d.c.x, d.c.y, d.ang], j); U1.set([d.rx, d.ry, d.amt, 0], j);
        U2.set([Math.log2(Math.max(1, 0.05 * W)), 0, 0, 0], j);
      } else if (d.t === 'W') {
        continue;   // wrinkle smoothing runs on the CPU (same code as photos) — see cpuPost()
        U0.set([4, d.c.x, d.c.y, d.ang], j); U1.set([d.rx, d.ry, d.amt, 0], j);
        const rb = 0.032 * W;   // same scales as the photo version (warp.js)
        U2.set([Math.log2(Math.max(1, 0.006 * W)), rb, Math.log2(Math.max(1, rb / 2.5)), 0], j);
      } else if (d.t === 'G') {
        U0.set([5, d.c.x, d.c.y, d.ang], j); U1.set([d.rx, d.ry, d.amt, d.bright ?? 1], j);
        U2.set([Math.log2(Math.max(1, 0.016 * W)), d.soft ?? 1, 0, 0], j);
      }
    }
    return n;
  }

  // Wrinkle smoothing: read back just those areas, run the photo pipeline's filter, draw on an overlay.
  // CPU filters (tear troughs, folds…). The finished frame and the treated areas are composed on
  // ONE 2D canvas (the overlay), so both go through the same colour pipeline — on iPhone Safari the
  // WebGL canvas and a 2D canvas render colours slightly differently, which showed as rectangles.
  function cpuPost(W, w, h) {
    if (!overlay) return;
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; scratch.width = w; scratch.height = h; }
    if (!lastW.length) { if (overlayUsed) { octx.clearRect(0, 0, w, h); overlayUsed = false; } return; }
    octx.drawImage(canvas, 0, 0, w, h);                 // full treated frame from WebGL, opaque
    overlayUsed = true;
    for (const d of lastW) {
      let x0, y0, x1, y1;
      if (d.poly) {
        const m = 0.06 * d.W, xs = d.poly.map(q => q.x), ys = d.poly.map(q => q.y);
        x0 = Math.max(0, Math.floor(Math.min(...xs) - m)); y0 = Math.max(0, Math.floor(Math.min(...ys) - m));
        x1 = Math.min(w, Math.ceil(Math.max(...xs) + m)); y1 = Math.min(h, Math.ceil(Math.max(...ys) + m));
      } else {
        const R = Math.max(d.rx, d.ry) * 1.15;
        x0 = Math.max(0, Math.floor(d.c.x - R)); y0 = Math.max(0, Math.floor(d.c.y - R));
        x1 = Math.min(w, Math.ceil(d.c.x + R)); y1 = Math.min(h, Math.ceil(d.c.y + R));
      }
      const bw = x1 - x0, bh = y1 - y0;
      if (bw < 8 || bh < 8) continue;
      const src = octx.getImageData(x0, y0, bw, bh);      // same canvas, same colours
      sctx.clearRect(x0, y0, bw, bh);
      sctx.putImageData(src, x0, y0);
      Warp.cpuFilter(sctx, w, h, d);
      const res = sctx.getImageData(x0, y0, bw, bh), R = res.data, O = src.data;
      const fb = Math.max(4, Math.round(0.08 * Math.min(bw, bh)));   // soft fade toward the box edges
      for (let y = 0; y < bh; y++) {
        const ey = Math.min(1, Math.min(y, bh - 1 - y) / fb);
        for (let x = 0; x < bw; x++) {
          const i = (y * bw + x) * 4;
          const ex = Math.min(1, Math.min(x, bw - 1 - x) / fb);
          const diff = Math.abs(R[i] - O[i]) + Math.abs(R[i + 1] - O[i + 1]) + Math.abs(R[i + 2] - O[i + 2]);
          const a = Math.min(1, Math.max(0, (diff - 4) / 10)) * ex * ey;   // ignore tiny round-trip noise
          R[i + 3] = Math.round(255 * a);
        }
      }
      sctx.putImageData(res, x0, y0);
      octx.drawImage(scratch, x0, y0, bw, bh, x0, y0, bw, bh);
    }
  }

  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (video.readyState < 2 || !video.videoWidth) return;
    const w = video.videoWidth, h = video.videoHeight;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }

    let n = 0;
    if (landmarker && !bypass) {
      const ts = performance.now();
      if (ts > lastTs) {
        lastTs = ts;
        let L = null;
        try { L = Face.detectVideo(landmarker, video, ts); } catch { /* skip frame */ }
        if (L) { missed = 0; L = smoothLandmarks(L); } else { missed++; if (missed > 5) smooth = null; }
        if (onStatus) onStatus(L ? 'ok' : missed > 5 ? 'noface' : 'ok');
        lastW = [];
        if (smooth) {
          const items = getItems();
          if (items.length) {
            const W = Math.hypot(smooth[234].x - smooth[454].x, smooth[234].y - smooth[454].y);
            const all = Warp.deforms(items, smooth);
            lastW = all.filter(d => d.t === 'W' || d.t === 'M' || d.t === 'U');
            n = pack(all, W);
          }
        }
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, texObj);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform2f(loc.size, w, h);
    gl.uniform1i(loc.n, n);
    gl.uniform4fv(loc.d0, U0); gl.uniform4fv(loc.d1, U1); gl.uniform4fv(loc.d2, U2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (bypass) lastW = [];
    cpuPost(0, w, h);
  }

  async function start(opts) {
    ({ video, canvas, getItems, onStatus } = opts);
    overlay = opts.overlay || null;
    if (overlay) { octx = overlay.getContext('2d'); scratch = document.createElement('canvas'); sctx = scratch.getContext('2d', { willReadFrequently: true }); }
    if (!gl) initGL();
    running = true; smooth = null; lastTs = -1; missed = 0; bypass = false;
    raf = requestAnimationFrame(frame);
    if (onStatus) onStatus('loading');
    landmarker = await Face.loadVideo();
    if (onStatus) onStatus('ok');
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    if (octx) { octx.clearRect(0, 0, overlay.width, overlay.height); overlayUsed = false; }
  }

  // Raw (untreated) current frame as a canvas, mirrored like the preview.
  function captureFrame() {
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    const x = c.getContext('2d');
    x.translate(c.width, 0); x.scale(-1, 1);
    x.drawImage(video, 0, 0);
    return c;
  }

  // What the client currently sees (treated), as a canvas — used for debugging/tests.
  function renderedFrame() {
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d');
    x.drawImage(canvas, 0, 0);
    if (overlay) x.drawImage(overlay, 0, 0);
    return c;
  }

  window.Live = { supported, start, stop, setBypass: v => { bypass = v; }, captureFrame, renderedFrame };
})();
