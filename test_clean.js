const fs = require('fs');

function cleanMathJaxHtml(html) {
    if (!html) return "";
    try {
      // Mocking DOM Parser via jsdom for Node.js
      const { JSDOM } = require("jsdom");
      const dom = new JSDOM(`<!DOCTYPE html><body><div id="tmp">${html}</div></body>`);
      const tmp = dom.window.document.getElementById("tmp");
      const document = dom.window.document;

      const convertNode = (node) => {
        if (!node) return "";
        if (node.nodeType === 3) return node.textContent;
        if (node.nodeType !== 1) return "";
        const tag = node.tagName.toLowerCase();

        // Skip visual-only elements that don't contribute to LaTeX
        if (tag === "mjx-surd") return "";
        if (tag === "mjx-stretchy-h" || tag === "mjx-stretchy-v") return ""; // Simplified for test
        if (tag === "mjx-assistive-mml") return "";

        if (tag === "mjx-c") {
          const cls = Array.from(node.classList).find((c) => c.startsWith("mjx-c"));
          if (cls) {
            const hex = cls.replace("mjx-c", "");
            const code = parseInt(hex, 16);
            if (isNaN(code)) return "";
            if (code === 0xA0) return "";
            const char = String.fromCodePoint(code);
            if (["%", "$", "#", "_"].includes(char)) return "\\" + char;
            if (code >= 0x1D44E && code <= 0x1D467) return String.fromCharCode(97 + (code - 0x1D44E));
            if (code >= 0x1D434 && code <= 0x1D44D) return String.fromCharCode(65 + (code - 0x1D434));
            return char;
          }
        }

        const getInner = (sel) => {
          if (!sel) return Array.from(node.childNodes).map(convertNode).join("");
          const all = node.querySelectorAll(sel);
          for (const el of all) {
            let parent = el.parentNode;
            let nested = false;
            while (parent && parent !== node) {
              if (parent.tagName && parent.tagName.toLowerCase() === "mjx-frac") {
                nested = true;
                break;
              }
              parent = parent.parentNode;
            }
            if (!nested) return Array.from(el.childNodes).map(convertNode).join("");
          }
          return "";
        };

        const getBase = () => {
          const baseEl = node.querySelector("mjx-base");
          if (baseEl) return Array.from(baseEl.childNodes).map(convertNode).join("");
          return Array.from(node.children)
            .filter(c => c.tagName.toLowerCase() !== "mjx-script")
            .map(c => convertNode(c))
            .join("");
        };

        // NEW LOGIC
        if (tag === "mjx-mroot") {
          const rootNode = node.querySelector("mjx-root");
          const degree = rootNode ? Array.from(rootNode.childNodes).map(convertNode).join("") : "";
          const sqrtNode = node.querySelector("mjx-sqrt");
          const box = sqrtNode ? sqrtNode.querySelector("mjx-box") : null;
          const base = box ? Array.from(box.childNodes).map(convertNode).join("") : (sqrtNode ? Array.from(sqrtNode.childNodes).map(convertNode).join("") : getBase());
          return `\\sqrt[${degree}]{${base}}`;
        }

        // ORIGINAL LOGIC (To keep as fallback if not mroot)
        if (tag === "mjx-msqrt" || tag === "mjx-sqrt") {
          const box = node.querySelector("mjx-box");
          if (box) return `\\sqrt{${Array.from(box.childNodes).map(convertNode).join("")}}`;
          return `\\sqrt{${getInner()}}`;
        }
        if (tag === "mjx-root") return `\\sqrt[${getInner("mjx-degree")}]{${getBase()}}`;
        if (tag === "mjx-math") return getInner();
        if (tag === "mjx-box") return getInner();
        if (tag === "mjx-mstyle") return getInner();
        if (tag === "mjx-mfenced") return Array.from(node.childNodes).map(convertNode).join("");

        return Array.from(node.childNodes).map(convertNode).join("");
      };

      tmp.querySelectorAll("mjx-assistive-mml").forEach((el) => el.remove());
      tmp.querySelectorAll("mjx-container").forEach((container) => {
        const tex = convertNode(container).trim();
        if (tex) {
          const span = document.createElement("span");
          span.className = "math-tex";
          span.textContent = tex;
          container.replaceWith(span);
        } else {
          container.remove();
        }
      });
      return tmp.innerHTML;
    } catch (e) {
      console.warn("MathJax clean failed:", e);
      return html;
    }
}

const mathjaxHtml = `<mjx-container class="MathJax" jax="CHTML"><mjx-math class=" MJX-TEX"><mjx-mroot><mjx-root style="vertical-align: 0.344em; width: 0;"><mjx-mn class="mjx-n" size="ss" style="padding-left: 0.524em;"><mjx-c class="mjx-c33"></mjx-c></mjx-mn></mjx-root><mjx-sqrt><mjx-surd><mjx-mo class="mjx-n"><mjx-c class="mjx-c221A"></mjx-c></mjx-mo></mjx-surd><mjx-box style="padding-top: 0.281em;"><mjx-mi class="mjx-i"><mjx-c class="mjx-c1D465 TEX-I"></mjx-c></mjx-mi></mjx-box></mjx-sqrt></mjx-mroot></mjx-math></mjx-container>`;
console.log(cleanMathJaxHtml(mathjaxHtml));
