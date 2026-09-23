/** Model SVG is untrusted. Rebuild a small static SVG vocabulary, then use image context. */
const NS = "http://www.w3.org/2000/svg";
const TAGS = new Set("svg g defs title desc rect circle ellipse line polyline polygon path text tspan linearGradient radialGradient stop marker clipPath".split(" "));
const ATTRS = new Set("id x y x1 y1 x2 y2 cx cy r rx ry width height viewBox preserveAspectRatio d points transform fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset opacity font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline dx dy textLength lengthAdjust offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod fx fy fr markerWidth markerHeight refX refY orient markerUnits marker-start marker-mid marker-end clip-path clipPathUnits".split(" "));
const PAINT = new Set(["fill", "stroke", "clip-path", "marker-start", "marker-mid", "marker-end"]);
const MAX_LENGTH = 300000, MAX_NODES = 5000, MAX_DEPTH = 40;
const caches = new WeakMap();

export function sanitizeSVG(source, document) {
  if (typeof source !== "string" || source.length > MAX_LENGTH || /<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error("The SVG is too large or contains unsupported declarations.");
  const { DOMParser, XMLSerializer } = document.defaultView;
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  if (!root || root.localName !== "svg" || ![NS, null, ""].includes(root.namespaceURI) || parsed.getElementsByTagName("parsererror").length)
    throw new Error("The SVG is incomplete or contains invalid XML.");
  const output = document.implementation.createDocument(NS, "svg", null);
  let count = 0;
  function copy(input, target, depth) {
    if (++count > MAX_NODES || depth > MAX_DEPTH) throw new Error("The SVG is too complex to preview.");
    for (const attr of input.attributes) {
      const name = attr.name, value = attr.value;
      if (!ATTRS.has(name) || attr.namespaceURI || value.length > 50000) continue;
      // No CSS, URLs, imports, event handlers, foreign content, animation or external references.
      if (/url\s*\(/i.test(value) && !(PAINT.has(name) && /^url\(#[A-Za-z_][\w.-]*\)$/.test(value))) continue;
      if (/[<>]|[\\]|(?:javascript|data|https?|file):|@import|expression\s*\(/i.test(value)) continue;
      if (name === "id" && !/^[A-Za-z_][\w.-]*$/.test(value)) continue;
      target.setAttribute(name, value);
    }
    for (const child of input.childNodes) {
      if (child.nodeType === 3 && ["text", "tspan", "title", "desc"].includes(input.localName)) {
        target.appendChild(output.createTextNode(child.textContent));
      } else if (child.nodeType === 1 && TAGS.has(child.localName) && [NS, null, ""].includes(child.namespaceURI)) {
        const element = output.createElementNS(NS, child.localName);
        copy(child, element, depth + 1);
        target.appendChild(element);
      }
    }
  }
  copy(root, output.documentElement, 0);
  const svg = output.documentElement;
  let box = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) {
    const dimension = (name) => {
      const value = svg.getAttribute(name) || "";
      return /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? parseFloat(value) : 0;
    };
    box = [0, 0, dimension("width"), dimension("height")];
    if (!box[2] || !box[3]) throw new Error("Add a viewBox or numeric width and height to the SVG.");
    svg.setAttribute("viewBox", box.join(" "));
  }
  if (box.some((n) => Math.abs(n) > 20000) || box[2] / box[3] > 50 || box[3] / box[2] > 50)
    throw new Error("The SVG dimensions are outside the preview limits.");
  svg.setAttribute("width", String(box[2]));
  svg.setAttribute("height", String(box[3]));
  const title = svg.getElementsByTagName("title")[0]?.textContent.trim().slice(0, 200) || "Generated diagram";
  const text = new XMLSerializer().serializeToString(svg);
  return { text, title, url: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text) };
}

export function createSVGPreview(document, source, { pending = false, incomplete = false } = {}) {
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const card = el("figure", "", "svg-card");
  if (pending) {
    const waiting = el("p", "Drawing your diagram…", "svg-pending");
    waiting.setAttribute("role", "status");
    card.append(waiting);
    return card;
  }
  let svg;
  try {
    if (incomplete) throw new Error("The SVG code block was not completed. Ask Chat to finish the diagram.");
    let cache = caches.get(document);
    if (!cache) { cache = new Map(); caches.set(document, cache); }
    svg = cache.get(source);
    if (!svg) {
      svg = sanitizeSVG(source, document);
      if (cache.size >= 16) cache.delete(cache.keys().next().value);
      cache.set(source, svg);
    }
  } catch (error) {
    card.append(el("p", "Diagram preview unavailable. " + error.message, "svg-error"));
    const details = el("details"), pre = el("pre", source, "code-block");
    details.append(el("summary", "View SVG source"), pre);
    card.append(details);
    return card;
  }
  const header = el("figcaption", "", "svg-heading");
  const actions = el("div", "", "svg-actions");
  const expand = el("button", "Expand", "text-button");
  expand.type = "button";
  expand.setAttribute("aria-label", "Expand " + svg.title);
  const download = el("a", "Download SVG", "text-button");
  download.href = svg.url;
  download.download = (svg.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 70) || "diagram") + ".svg";
  actions.append(expand, download);
  header.append(el("strong", svg.title), actions);
  const picture = () => {
    const img = el("img", "", "svg-image");
    img.src = svg.url;
    img.alt = svg.title;
    return img;
  };
  card.append(header, picture());
  expand.addEventListener("click", () => {
    const modal = el("dialog", "", "svg-dialog");
    const bar = el("div", "", "svg-heading"), controls = el("div", "", "svg-actions");
    const viewport = el("div", "", "svg-viewport"), img = picture();
    const label = el("output", "Fit"), minus = el("button", "−", "text-button"), plus = el("button", "+", "text-button"), fit = el("button", "Fit", "text-button"), close = el("button", "Close", "text-button");
    minus.setAttribute("aria-label", "Zoom out");
    plus.setAttribute("aria-label", "Zoom in");
    let zoom = 0;
    function update() {
      viewport.className = "svg-viewport svg-zoom-" + zoom;
      label.textContent = zoom ? zoom * 100 + "%" : "Fit";
      minus.disabled = zoom === 0;
      plus.disabled = zoom === 4;
    }
    for (const b of [minus, plus, fit, close]) b.type = "button";
    minus.addEventListener("click", () => { zoom = Math.max(0, zoom - 1); update(); });
    plus.addEventListener("click", () => { zoom = Math.min(4, zoom + 1); update(); });
    fit.addEventListener("click", () => { zoom = 0; update(); });
    close.addEventListener("click", () => modal.close());
    modal.addEventListener("close", () => { modal.remove(); if (expand.isConnected) expand.focus(); }, { once: true });
    modal.setAttribute("aria-label", svg.title);
    controls.append(minus, label, plus, fit, close);
    bar.append(el("strong", svg.title), controls);
    viewport.append(img);
    viewport.tabIndex = 0;
    viewport.setAttribute("aria-label", "Diagram. Scroll to pan when zoomed in.");
    modal.append(bar, viewport);
    document.body.append(modal);
    update();
    modal.showModal();
    close.focus();
  });
  return card;
}
