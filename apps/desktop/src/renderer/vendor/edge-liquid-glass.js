/* ============================================================
   Liquid Glass 折射引擎（无依赖，MV3 安全：不依赖任何内联脚本）
   ------------------------------------------------------------
   原理：
   1) Canvas 生成内部透镜位移，并沿圆角矩形 SDF 平滑过渡到边缘法线，
      把 x/y 位移编码进 R/G 通道（0.5 为原点，故 feDisplacementMap 的
      scale 必须取 2×位移量，才能保证通道值落在 [0,1]）；B 通道存边缘遮罩。
   2) 贴图经 feImage 进入 SVG 滤镜，由 3 路 feDisplacementMap（scale
      依次 1 / 1-0.10d / 1-0.20d）分离 RGB，再两次 screen 混合 → 边缘色散。
   3) 挂到 backdrop-filter: url(#id) saturate() brightness()，折射的是真实背景。
   每个元素独占滤镜实例；相同几何参数仍共用位移贴图数据，避免重复逐像素计算。
   ============================================================ */
(function (global) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var XL = "http://www.w3.org/1999/xlink";
  var SUPPORTED = !!(global.CSS && CSS.supports && (
    CSS.supports("backdrop-filter", "url(#x)") ||
    CSS.supports("-webkit-backdrop-filter", "url(#x)")));

  var ROOT = document.documentElement;
  var DEF = { band: 0.16, str: 0.22, disp: 1, blur: 2.4 };
  var PROFILE_SCALE = {
    clear: { display: [1.22, 1.06, 1.15], operation: [1, 1, 1], reading: [0.48, 0.88, 0.34] },
    balanced: { display: [1.12, 1, 1], operation: [0.9, 0.92, 0.86], reading: [0.34, 0.78, 0.22] },
    readable: { display: [1.08, 1, 0.9], operation: [0.74, 0.9, 0.64], reading: [0.16, 0.66, 0.12] }
  };

  var defs = null, uid = 0, owner = {}, els = [], rafId = 0, sizeKey = "", needsCollect = false;
  var active = false, resizeObserver = null, startupTimers = [];

  /* ---------------- 数学 ---------------- */
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
  function ss(a, b, t) { t = (t - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function glassRole(el) {
    var role = el.getAttribute("data-lg-role");
    if (role === "display" || role === "reading" || role === "operation") return role;
    return el.matches && el.matches(".calwrap,.todo,.note,.cd,.feature-box,.sheetbox,.dlgbox,.sbcard,.sbRefr") ? "reading" : "operation";
  }
  function rrSDF(px, py, hw, hh, r) {
    var qx = Math.abs(px) - hw + r, qy = Math.abs(py) - hh + r;
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  }

  /* ---------------- 位移贴图 ---------------- */
  function dispMap(W, H, radius, band, strength) {
    var s = Math.min(1, 240 / Math.max(W, H));
    var mw = Math.max(8, Math.round(W * s)), mh = Math.max(8, Math.round(H * s));
    var cv = document.createElement("canvas");
    cv.width = mw; cv.height = mh;
    var ctx = cv.getContext("2d"), im = ctx.createImageData(mw, mh);
    var e = Math.max(0.75, Math.min(W, H) * 0.006);
    var S = Math.max(1, strength * 2);
    var inner = band * 0.42;
    var hw = W / 2, hh = H / 2, R = clamp(radius, 0, Math.min(hw, hh));
    var bodyStrength = Math.min(strength * 0.75, Math.min(W, H) * 0.08);
    for (var y = 0; y < mh; y++) {
      var py = (y + 0.5) / mh * H - hh;
      for (var x = 0; x < mw; x++) {
        var px = (x + 0.5) / mw * W - hw;
        var d = rrSDF(px, py, hw, hh, R);
        var m = 1 - ss(inner, band, -d);
        /* 内部边缘权重为零，无需四次 SDF 采样和法线归一化。 */
        var gx = 0, gy = 0;
        if (m > 0) {
          gx = rrSDF(px + e, py, hw, hh, R) - rrSDF(px - e, py, hw, hh, R);
          gy = rrSDF(px, py + e, hw, hh, R) - rrSDF(px, py - e, hw, hh, R);
          var L = Math.hypot(gx, gy) || 1;
          gx /= L; gy /= L;
        }
        /* 中部也向光学中心采样，形成可见的透镜放大；此前 m=0 使整片内部
           完全不偏折。与边缘法线平滑混合，保持中心不平移、取样不越过边界。 */
        var dx = (px / hw) * bodyStrength * (1 - m) + gx * m * strength;
        var dy = (py / hh) * bodyStrength * (1 - m) + gy * m * strength;
        var i = (y * mw + x) * 4;
        im.data[i] = clamp(Math.round(255 * (0.5 - dx / S)), 0, 255);
        im.data[i + 1] = clamp(Math.round(255 * (0.5 - dy / S)), 0, 255);
        im.data[i + 2] = clamp(Math.round(255 * m), 0, 255);
        im.data[i + 3] = 255;
      }
    }
    ctx.putImageData(im, 0, 0);
    return cv.toDataURL("image/png");
  }

  /* ---------------- SVG 滤镜 ---------------- */
  function buildFilter(id, href, strength, disp) {
    var f = document.createElementNS(NS, "filter");
    f.setAttribute("id", id);
    f.setAttribute("x", "0%"); f.setAttribute("y", "0%");
    f.setAttribute("width", "100%"); f.setAttribute("height", "100%");
    f.setAttribute("color-interpolation-filters", "sRGB");

    var fi = document.createElementNS(NS, "feImage");
    fi.setAttribute("href", href);
    fi.setAttributeNS(XL, "xlink:href", href);
    fi.setAttribute("x", "0%"); fi.setAttribute("y", "0%");
    fi.setAttribute("width", "100%"); fi.setAttribute("height", "100%");
    fi.setAttribute("preserveAspectRatio", "none");
    fi.setAttribute("result", "map");
    f.appendChild(fi);

    var S = Math.max(1, strength * 2);
    /* 色散取原来的一半：R/B 差速过大时，高频照片背景会被撕成整块红蓝重影；
       渐变壁纸上的棱线观感保留，只是 photorealistic 壁纸不再炸开 */
    [["R", 1.00, "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"],
     ["G", 1 - disp * 0.05, "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"],
     ["B", 1 - disp * 0.10, "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"]].forEach(function (c) {
      var dm = document.createElementNS(NS, "feDisplacementMap");
      dm.setAttribute("in", "SourceGraphic"); dm.setAttribute("in2", "map");
      dm.setAttribute("scale", String(S * c[1]));
      dm.setAttribute("xChannelSelector", "R");
      dm.setAttribute("yChannelSelector", "G");
      dm.setAttribute("result", "d" + c[0]);
      f.appendChild(dm);

      var cm = document.createElementNS(NS, "feColorMatrix");
      cm.setAttribute("in", "d" + c[0]);
      cm.setAttribute("type", "matrix");
      cm.setAttribute("values", c[2]);
      cm.setAttribute("result", "c" + c[0]);
      f.appendChild(cm);
    });

    var b1 = document.createElementNS(NS, "feBlend");
    b1.setAttribute("in", "cR"); b1.setAttribute("in2", "cG");
    b1.setAttribute("mode", "screen"); b1.setAttribute("result", "rg");
    f.appendChild(b1);

    var b2 = document.createElementNS(NS, "feBlend");
    b2.setAttribute("in", "rg"); b2.setAttribute("in2", "cB");
    b2.setAttribute("mode", "screen");
    f.appendChild(b2);
    return f;
  }

  /* 简化版滤镜：只做单次位移，不拆 RGB 通道。
     拖动等高频交互期间使用 —— 折射保留、色散舍弃，滤镜开销约降到 1/4。 */
  function buildFilterLite(id, href, strength) {
    var f = document.createElementNS(NS, "filter");
    f.setAttribute("id", id);
    f.setAttribute("x", "0%"); f.setAttribute("y", "0%");
    f.setAttribute("width", "100%"); f.setAttribute("height", "100%");
    f.setAttribute("color-interpolation-filters", "sRGB");

    var fi = document.createElementNS(NS, "feImage");
    fi.setAttribute("href", href);
    fi.setAttributeNS(XL, "xlink:href", href);
    fi.setAttribute("x", "0%"); fi.setAttribute("y", "0%");
    fi.setAttribute("width", "100%"); fi.setAttribute("height", "100%");
    fi.setAttribute("preserveAspectRatio", "none");
    fi.setAttribute("result", "map");
    f.appendChild(fi);

    var dm = document.createElementNS(NS, "feDisplacementMap");
    dm.setAttribute("in", "SourceGraphic");
    dm.setAttribute("in2", "map");
    dm.setAttribute("scale", String(Math.max(1, strength * 2)));
    dm.setAttribute("xChannelSelector", "R");
    dm.setAttribute("yChannelSelector", "G");
    f.appendChild(dm);
    return f;
  }

  /* 位移贴图按几何参数缓存：精简版与完整版共用同一张图，避免重复计算 */
  var mapCache = new Map();
  function getMap(geo, W, H, radius, band, strength) {
    var href = mapCache.get(geo);
    if (href !== undefined) {
      mapCache.delete(geo);
    } else {
      href = dispMap(W, H, radius, band, strength);
      /* 只淘汰最久未用的一张，避免容量临界点清空所有常用贴图。 */
      if (mapCache.size >= 60) mapCache.delete(mapCache.keys().next().value);
    }
    mapCache.set(geo, href);
    return href;
  }

  /* ---------------- 渲染 ---------------- */
  function filterSurface(el, cs, W, H) {
    if (!el.matches || !el.matches(".lg-material-surface")) return el;
    var clip = el.__lgClip, surface = el.__lgSurface;
    if (!clip || clip.parentNode !== el) {
      clip = document.createElement("span");
      surface = document.createElement("span");
      clip.className = "lg-optics-clip";
      clip.setAttribute("aria-hidden", "true");
      Object.assign(clip.style, {
        position: "absolute", display: "block", overflow: "hidden",
        pointerEvents: "none", zIndex: "-1", margin: "0", padding: "0", border: "0"
      });
      Object.assign(surface.style, {
        position: "absolute", inset: "0", borderRadius: "inherit", pointerEvents: "none"
      });
      clip.appendChild(surface);
      el.appendChild(clip);
      el.__lgClip = clip;
      el.__lgSurface = surface;
    }
    /* 布局尺寸包含边框；内部绝对定位以 padding box 为原点，需要补回边框。
       父卡片和独立 clip 都执行圆角裁剪，滤镜层不参与鼠标命中或内容布局。 */
    clip.style.left = -num(cs.borderLeftWidth, 0) + "px";
    clip.style.top = -num(cs.borderTopWidth, 0) + "px";
    clip.style.width = W + "px";
    clip.style.height = H + "px";
    clip.style.borderRadius = cs.borderRadius || cs.borderTopLeftRadius;
    /* 负层级留在卡片的堆叠上下文内，避免折射层覆盖按钮的直接文本节点。 */
    el.style.isolation = "isolate";
    el.style.backdropFilter = "none";
    el.style.webkitBackdropFilter = "none";
    return surface;
  }

  function clearDefs() {
    if (!defs) return;
    while (defs.firstChild) defs.removeChild(defs.firstChild);
  }

  function render(only) {
    var partial = Array.isArray(only);
    if (!partial) rafId = 0;
    if (!defs) defs = document.getElementById("glass-defs");
    if (!defs) return;

    var BAND = num(ROOT.style.getPropertyValue("--lg-band"), DEF.band);
    var STR = num(ROOT.style.getPropertyValue("--lg-str"), DEF.str);
    var DISP = num(ROOT.style.getPropertyValue("--lg-disp"), DEF.disp);

    /* 参数变化：只回收本引擎自己登记的滤镜，
       外部用 LiquidGlass.rawFilter() 钉住的滤镜（如液态水滴）不受影响 */
    var profile = ROOT.getAttribute ? (ROOT.getAttribute("data-glass-profile") || "balanced") : "balanced";
    var scales = PROFILE_SCALE[profile] || PROFILE_SCALE.balanced;
    var key = [BAND, STR, DISP, profile].join("|");
    if (key !== sizeKey) {
      partial = false; // 参数变化时仍需更新所有材质。
      sizeKey = key;
      Object.keys(owner).forEach(function (fid) {
        var n = document.getElementById(fid);
        if (n && n.parentNode) n.parentNode.removeChild(n);
      });
      owner = {};
      els.forEach(function (el) { el.__lgId = null; el.__lgKey = null; });
    }

    if (!partial && needsCollect) collect();
    var used = {};
    /* 新元素可能在延迟 collect 前已切换 lite；以登记表保留它的滤镜。 */
    if (partial) Object.keys(owner).forEach(function (fid) {
      if (owner[fid].isConnected) used[fid] = 1;
    });
    var targets = partial ? only : els;
    for (var n = 0; n < targets.length; n++) {
      var el = targets[n];
      if (!el.isConnected) continue;
      /* SVG 使用元素局部坐标；祖先的开场缩放不能缩小贴图，
         否则动画结束后右侧/底部会留下未覆盖的折射接缝。 */
      var W = el.offsetWidth, H = el.offsetHeight;
      if (W < 10 || H < 10) continue;                       /* 隐藏元素跳过 */

      var cs = getComputedStyle(el);
      var radius = num(cs.borderTopLeftRadius, 0);
      var short = Math.min(W, H);
      var roleScale = scales[glassRole(el)] || scales.operation;
      /* 每元素可覆盖：data-lg-band / data-lg-str / data-lg-disp，
         大面板用小比例（否则折射强度按短边等比放大后会失真） */
      /* 折射带加绝对上限：大元素若按比例算带（如 0.29×160=46px），位移被摊薄在宽带里，
         棱边感会被稀释成柔和扭曲；钳到与小元素同量级后，同等位移压缩进窄带，
         边缘密度翻倍，所有玻璃都有小元素那种「彩虹棱线」观感 */
      var band = Math.max(3, Math.min(short * num(el.getAttribute("data-lg-band"), BAND) * roleScale[1], 26));
      /* 位移绝对值上限：strength 按短边等比放大时，大瓦片轻松冲到 20~50px，
         在报纸/照片这类高频壁纸上等于把几十像素外的 unrelated 内容拽进来，
         再叠加 RGB 分通道差速 → 整块红蓝重影（渐变壁纸上看不出来）。
         10px 足够保留边缘棱光，滑块开到最大也不会再撕裂。 */
      var strength = Math.max(3, Math.min(10, short * num(el.getAttribute("data-lg-str"), STR) * roleScale[0]));
      var disp = num(el.getAttribute("data-lg-disp"), DISP) * roleScale[2];
      var id;

      if (!SUPPORTED) {
        if (el.__lgId !== "fallback") {
          el.__lgId = "fallback";
      el.style.backdropFilter = "blur(16px) saturate(140%)";
          el.style.webkitBackdropFilter = el.style.backdropFilter;
        }
        continue;
      }

      var lite = !!el.__lgLite;
      var geo = [W, H, Math.round(radius), Math.round(band * 4), Math.round(strength * 4), Math.round(disp * 10)].join(",");
      var ck = (lite ? "L," : "N,") + geo;
      var previousId = el.__lgId;
      if (partial && previousId) delete used[previousId];
      var filterNode = previousId && el.__lgKey === ck ? document.getElementById(previousId) : null;
      if (filterNode) {
        id = previousId;
      } else {
        id = "lgf" + (++uid);
        owner[id] = el;
        /* 色散仅影响滤镜链，不影响贴图；按实际生成参数复用像素数据。 */
        var mapGeo = [W, H, radius, band, strength].join(",");
        var nextFilter = lite
          ? buildFilterLite(id, getMap(mapGeo, W, H, radius, band, strength), strength)
          : buildFilter(id, getMap(mapGeo, W, H, radius, band, strength), strength, disp);
        /* feImage 的百分比按 SVG 视口解析，不是卡片边界。
           必须与 dispMap 使用同一组局部像素尺寸，否则移动时中部也会
           读到边缘位移或透明贴图，产生横带及未接触元素的错误采样。
           材质预设只能改变强度，不能改变这里的坐标约定。 */
        nextFilter.setAttribute("primitiveUnits", "userSpaceOnUse");
        var mapImage = nextFilter.firstChild;
        mapImage.setAttribute("x", "0"); mapImage.setAttribute("y", "0");
        mapImage.setAttribute("width", String(W)); mapImage.setAttribute("height", String(H));
        defs.appendChild(nextFilter);
        el.__lgId = id;
        el.__lgKey = ck;
      }
      used[id] = 1;

      var surface = filterSurface(el, cs, W, H);
      if (previousId !== id || (surface.style.backdropFilter || "").indexOf("#" + id) < 0) {
        /* 不挂 blur —— Chromium 对「近透明背景 + border + backdrop blur」的组合
           会把模糊结果溢出绘制到元素顶缘外约 3σ 的壁纸区，形成一条亮带（实测 blur≥1px 即出现）。
           磨砂感由折射 + 页面纹理承担，不再依赖 backdrop blur。 */
        var v = "url(#" + id + ") saturate(140%) brightness(1.02)";
        surface.style.backdropFilter = v;
        surface.style.webkitBackdropFilter = v;
      }
    }

    /* 回收本轮未使用的滤镜 */
    Object.keys(owner).forEach(function (fid) {
      if (!used[fid]) {
        var node = document.getElementById(fid);
        if (node && node.parentNode) node.parentNode.removeChild(node);
        var oldOwner = owner[fid];
        if (oldOwner && oldOwner.__lgId === fid) {
          oldOwner.__lgId = null;
          oldOwner.__lgKey = null;
        }
        delete owner[fid];
      }
    });
  }

  function schedule() {
    if (!active) return;
    if (rafId) return;
    rafId = global.requestAnimationFrame ? requestAnimationFrame(render) : setTimeout(render, 16);
  }

  function collect() { els = [].slice.call(document.querySelectorAll("[data-glass]")); needsCollect = false; }

  var rt = 0;
  function onResize() { clearTimeout(rt); rt = setTimeout(function () { schedule(); }, 120); }

  function init() {
    if (active) return;
    active = true;
    collect();
    render();
    global.addEventListener("resize", onResize);
    if (global.ResizeObserver) {
      try { resizeObserver = new ResizeObserver(onResize); resizeObserver.observe(document.body); } catch (e) { /* noop */ }
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    /* 兜底：字体/布局晚到时再刷一次 */
    startupTimers = [setTimeout(schedule, 200), setTimeout(schedule, 800)];
  }

  global.LiquidGlass = {
    supported: SUPPORTED,
    init: init,
    dispose: function () {
      active = false;
      global.removeEventListener("resize", onResize);
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = null; clearTimeout(rt);
      if (rafId) global.cancelAnimationFrame(rafId);
      rafId = 0; startupTimers.forEach(clearTimeout); startupTimers = [];
      clearDefs(); defs = null; owner = {}; els = []; sizeKey = "";
      mapCache.clear();
    },
    /* 指定元素时同步更新尺寸；无参数则在下一帧重新收集新增/显示的元素。 */
    refresh: function (list) {
      if (Array.isArray(list)) { render(list); return; }
      needsCollect = true; schedule();
    },
    /* 实时调参：清缓存并强制重建 */
    set: function (o) {
      if (o.band != null) ROOT.style.setProperty("--lg-band", o.band);
      if (o.str != null) ROOT.style.setProperty("--lg-str", o.str);
      if (o.disp != null) ROOT.style.setProperty("--lg-disp", o.disp);
      if (o.blur != null) ROOT.style.setProperty("--lg-blur", o.blur + "px");
      sizeKey = ""; schedule();
    },
    get: function () {
      return {
        band: num(ROOT.style.getPropertyValue("--lg-band"), DEF.band),
        str: num(ROOT.style.getPropertyValue("--lg-str"), DEF.str),
        disp: num(ROOT.style.getPropertyValue("--lg-disp"), DEF.disp),
        blur: num(ROOT.style.getPropertyValue("--lg-blur"), DEF.blur)
      };
    },

    /* 交互期间降级：对给定元素改用简化滤镜（保留折射、去掉色散），
       移动结束后再调一次 lite(list,false) 恢复完整效果。 */
    lite: function (list, on) {
      var changed = [];
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (!el || !!el.__lgLite === !!on) continue;
        el.__lgLite = !!on;
        changed.push(el);
      }
      /* 首个移动帧前完成切换；只测量受影响的玻璃，不扫描整页。 */
      if (changed.length) render(changed);
    },

    /* ---------- 底层接口：给非矩形形状（metaball 等）复用 ---------- */
    rawMap: function (W, H, sdf, band, strength) {
      var s = Math.min(1, 240 / Math.max(W, H));
      var mw = Math.max(8, Math.round(W * s)), mh = Math.max(8, Math.round(H * s));
      var cv = document.createElement("canvas");
      cv.width = mw; cv.height = mh;
      var ctx = cv.getContext("2d"), im = ctx.createImageData(mw, mh);
      var e = 1.5, S = Math.max(1, strength * 2), inner = band * 0.42;
      for (var y = 0; y < mh; y++) {
        var py = (y + 0.5) / mh * H;
        for (var x = 0; x < mw; x++) {
          var px = (x + 0.5) / mw * W;
          var d = sdf(px, py);
          var m = 1 - ss(inner, band, -d);
          var gx = sdf(px + e, py) - sdf(px - e, py);
          var gy = sdf(px, py + e) - sdf(px, py - e);
          var L = Math.hypot(gx, gy) || 1;
          gx /= L; gy /= L;
          var i = (y * mw + x) * 4;
          im.data[i] = clamp(Math.round(255 * (0.5 - gx * m * strength / S)), 0, 255);
          im.data[i + 1] = clamp(Math.round(255 * (0.5 - gy * m * strength / S)), 0, 255);
          im.data[i + 2] = clamp(Math.round(255 * m), 0, 255);
          im.data[i + 3] = 255;
        }
      }
      ctx.putImageData(im, 0, 0);
      return cv.toDataURL("image/png");
    },
    /* 用固定 id 挂一个滤镜（不参与自动回收）。
       同一 id 重复调用时只更新贴图，不重建整个滤镜链。 */
    rawFilter: function (id, href, strength, disp, lite) {
      if (!defs) defs = document.getElementById("glass-defs");
      if (!defs) return;
      var f = document.getElementById(id);
      if (!f || f.__lite !== !!lite || f.__strength !== strength || f.__disp !== disp) {
        if (f && f.parentNode) f.parentNode.removeChild(f);
        f = lite ? buildFilterLite(id, href, strength) : buildFilter(id, href, strength, disp);
        f.__lite = !!lite;
        f.__strength = strength;
        f.__disp = disp;
        defs.appendChild(f);
        return;
      }
      var fi = f.firstChild;
      if (fi && fi.getAttribute("href") !== href) {
        fi.setAttribute("href", href);
        fi.setAttributeNS(XL, "xlink:href", href);
      }
    }
  };
})(window);
