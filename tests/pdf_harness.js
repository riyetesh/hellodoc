"use strict";
/*
 * Runs the *real* inline JavaScript of the rendered results page under a
 * minimal DOM + jsPDF stub, then prints what the PDF generator actually drew
 * as JSON on stdout.
 *
 * Usage: node tests/pdf_harness.js <rendered-results.html>
 *
 * No copy of the page's PDF code lives in this file: the harness evaluates the
 * script embedded in the server-rendered HTML, so a test failure means the
 * shipped page really does draw something unexpected.
 */

const fs = require("fs");
const vm = require("vm");

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error("usage: node tests/pdf_harness.js <rendered-results.html>");
  process.exit(2);
}

const html = fs.readFileSync(htmlPath, "utf8");

// Collect only inline scripts; external <script src="..."> tags have no body.
const inlineScripts = [];
const scriptRe = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let scriptMatch;
while ((scriptMatch = scriptRe.exec(html)) !== null) {
  if (scriptMatch[1].trim()) inlineScripts.push(scriptMatch[1]);
}

const calls = [];
const instances = [];
let savedName = null;

class FakeJsPDF {
  constructor() {
    this.pageCount = 1;
    this.lastAutoTable = null;
    const self = this;
    this.internal = {
      pageSize: { width: 210, height: 297 },
      getNumberOfPages: () => self.pageCount,
      setPage: (n) => {
        self.pageCount = Math.max(self.pageCount, Number(n) || 1);
        return self;
      },
    };
    instances.push(this);
  }

  addPage() {
    this.pageCount += 1;
    calls.push({ type: "page" });
  }

  setPage(n) {
    this.pageCount = Math.max(this.pageCount, Number(n) || 1);
  }

  setFont() {}
  setFontSize() {}
  setTextColor() {}
  line() {
    calls.push({ type: "line" });
  }

  text(content, x, y) {
    calls.push({ type: "text", content: String(content), x: x, y: y });
  }

  addImage(img, format, x, y, w, h) {
    calls.push({ type: "image", src: (img && img.src) || "" });
  }

  // Applies the same greedy wrap a real PDF would to keep text on the page.
  splitTextToSize(text, width) {
    const maxChars = Math.max(16, Math.floor((width || 170) / 1.9));
    const lines = [];
    let line = "";
    String(text)
      .split(/\s+/)
      .filter(Boolean)
      .forEach((word) => {
        if (line && (line + " " + word).length > maxChars) {
          lines.push(line);
          line = word;
        } else {
          line = line ? line + " " + word : word;
        }
      });
    if (line) lines.push(line);
    return lines;
  }

  autoTable(options) {
    const startY = typeof options.startY === "number" ? options.startY : 0;
    const head = options.head || [[]];
    const body = (options.body || []).map((row) =>
      Array.isArray(row) ? row.map(String) : [String(row)]
    );
    const columnStyles = options.columnStyles || {};
    const cellWidth = columnStyles[0] ? columnStyles[0].cellWidth : null;
    calls.push({
      type: "table",
      title: String(head[0][0]),
      rows: body,
      startY: startY,
      cellWidth: cellWidth,
    });
    this.lastAutoTable = { finalY: startY + Math.min(200, 14 + body.length * 12) };
  }

  save(name) {
    savedName = String(name);
  }
}

// --- DOM stubs -------------------------------------------------------------

const elements = new Map();
const handlers = new Map();
const domReadyHandlers = [];

function makeElement(id) {
  return {
    id: id,
    hidden: false,
    disabled: false,
    value: "",
    title: "",
    textContent: "",
    innerHTML: "",
    style: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    focus() {},
    contains() {
      return false;
    },
    addEventListener(type, handler) {
      if (!handlers.has(id)) handlers.set(id, {});
      handlers.get(id)[type] = handler;
    },
  };
}

const documentStub = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  },
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
  addEventListener(type, handler) {
    if (type === "DOMContentLoaded") domReadyHandlers.push(handler);
  },
};

class ImageStub {
  constructor() {
    this.src = "";
    this.onload = null;
  }
}

const windowStub = {
  jspdf: { jsPDF: FakeJsPDF },
  history: { length: 1, back() {} },
  location: { href: "" },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return true;
  },
  matchMedia() {
    return { matches: false, addEventListener() {}, addListener() {} };
  },
};

const context = vm.createContext({
  window: windowStub,
  document: documentStub,
  Image: ImageStub,
  console: console,
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
});

try {
  inlineScripts.forEach((code, index) => {
    vm.runInContext(code, context, { filename: "results-inline-" + index + ".js" });
  });
  domReadyHandlers.forEach((handler) => handler());
} catch (error) {
  console.error("Inline script failed to run: " + (error && error.stack ? error.stack : error));
  process.exit(4);
}

const downloadHandler = (handlers.get("downloadPdfBtn") || {}).click;
if (typeof downloadHandler !== "function") {
  console.error("FAIL: the Download Report button never received a click handler.");
  process.exit(3);
}

downloadHandler({ preventDefault() {}, target: null });

process.stdout.write(
  JSON.stringify({ calls: calls, savedName: savedName, pdfCount: instances.length })
);
