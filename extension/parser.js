var SavemockParser = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/lib/parseQuestions.ts
  var parseQuestions_exports = {};
  __export(parseQuestions_exports, {
    SUBJECTS: () => SUBJECTS,
    cleanMathJaxHtml: () => cleanMathJaxHtml,
    generateAllSectionsHtml: () => generateAllSectionsHtml,
    generateDownloadHtml: () => generateDownloadHtml,
    generatePptHtml: () => generatePptHtml,
    parseQuestionsFromHtml: () => parseQuestionsFromHtml
  });
  var SUBJECTS = ["Math", "English", "GK/GS", "Reasoning"];
  function cleanMathJaxHtml(html) {
    if (!html) return "";
    try {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;

      const convertNode = (node) => {
        if (!node) return "";
        if (node.nodeType === 3) return node.textContent;
        if (node.nodeType !== 1) return "";
        const tag = node.tagName.toLowerCase();

        // Skip visual-only elements that don't contribute to LaTeX
        if (tag === "mjx-surd") return "";
        if (tag === "mjx-stretchy-h" || tag === "mjx-stretchy-v") {
          let hex = "";
          const firstC = node.querySelector("mjx-c");
          if (firstC) {
            const cls = Array.from(firstC.classList).find((c) => c.startsWith("mjx-c"));
            if (cls) hex = cls.replace("mjx-c", "").toUpperCase();
          }
          if (!hex) {
            const cAttr = node.getAttribute("c");
            if (cAttr) hex = cAttr.toUpperCase();
          }
          if (!hex) return "";
          
          const code = parseInt(hex, 16);
          if (!isNaN(code) && code < 128) {
             const char = String.fromCodePoint(code);
             if (["(", ")", "[", "]", "{", "}", "|"].includes(char)) {
                return char === "{" ? "\\{" : char === "}" ? "\\}" : char;
             }
          }
          
          const stretchyMap = {
            '239B': '(', '239C': '(', '239D': '(',
            '239E': ')', '239F': ')', '23A0': ')',
            '23A1': '[', '23A2': '[', '23A3': '[',
            '23A4': ']', '23A5': ']', '23A6': ']',
            '23A7': '\\{', '23A8': '\\{', '23A9': '\\{', '23AA': '|',
            '23AB': '\\}', '23AC': '\\}', '23AD': '\\}',
            '2320': '\\int', '2321': '\\int',
            '2223': '|', '2225': '\\|',
            '27E8': '\\langle', '27E9': '\\rangle'
          };
          if (stretchyMap[hex]) return stretchyMap[hex];
          return "";
        }
        // Skip assistive MathML duplicates — they contain nested mjx-container clones
        if (tag === "mjx-assistive-mml") return "";

        if (tag === "mjx-c") {
          const cls = Array.from(node.classList).find((c) => c.startsWith("mjx-c"));
          if (cls) {
            const hex = cls.replace("mjx-c", "");
            const code = parseInt(hex, 16);
            if (isNaN(code)) return "";
            // Skip non-breaking spaces — MathJax uses them as visual spacers, not math content
            if (code === 0xA0) return "";
            const char = String.fromCodePoint(code);
            if (["%", "$", "#", "_"].includes(char)) return "\\" + char;
            // Map Unicode math italic letters back to ASCII for KaTeX
            if (code >= 0x1D44E && code <= 0x1D467) return String.fromCharCode(97 + (code - 0x1D44E)); // a-z
            if (code >= 0x1D434 && code <= 0x1D44D) return String.fromCharCode(65 + (code - 0x1D434)); // A-Z
            return char;
          }
        }

        // Scoped query: finds sel under node, but skips any sel that is inside a nested mjx-frac
        const getInner = (sel) => {
          if (!sel) return Array.from(node.childNodes).map(convertNode).join("");
          const all = node.querySelectorAll(sel);
          for (const el of all) {
            // Walk up from el to node; if we cross another mjx-frac, skip this el
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

        // Helper: get base content, handling both <mjx-base> wrapped and unwrapped cases
        const getBase = () => {
          const baseEl = node.querySelector("mjx-base");
          if (baseEl) return Array.from(baseEl.childNodes).map(convertNode).join("");
          // Fallback: everything except mjx-script is the base
          return Array.from(node.childNodes)
            .filter(c => c.nodeType !== 1 || c.tagName.toLowerCase() !== "mjx-script")
            .map(c => convertNode(c))
            .join("");
        };

        if (tag === "mjx-frac") return `\\frac{${getInner("mjx-num")}}{${getInner("mjx-den")}}`;
        if (tag === "mjx-msup") {
          const script = getInner("mjx-script").trim();
          if (!script) return getBase(); // Skip empty superscript
          return `${getBase()}^{${script}}`;
        }
        if (tag === "mjx-msub") {
          const script = getInner("mjx-script").trim();
          if (!script) return getBase(); // Skip empty subscript
          return `${getBase()}_{${script}}`;
        }
        if (tag === "mjx-msubsup") {
          const base = getBase();
          const scripts = Array.from(node.children).filter((c) => c.tagName.toLowerCase() === "mjx-script");
          const sub = scripts[0] ? Array.from(scripts[0].childNodes).map(convertNode).join("").trim() : "";
          const sup = scripts[1] ? Array.from(scripts[1].childNodes).map(convertNode).join("").trim() : "";
          let result = base;
          if (sub) result += `_{${sub}}`;
          if (sup) result += `^{${sup}}`;
          return result;
        }
        if (tag === "mjx-mover") {
          const base = getBase();
          const over = node.querySelector("mjx-over");
          const html = over ? over.innerHTML : "";
          if (html.includes("mjx-cAF") || html.includes("\u00AF") || html.includes("mjx-c203E") || html.includes("mjx-stretchy-h")) {
            if (html.includes("mjx-c2192")) return `\\overrightarrow{${base}}`;
            return `\\overline{${base}}`;
          }
          return `\\overset{${getInner("mjx-over")}}{${base}}`;
        }
        // Handle mjx-menclose (Pinnacle uses this with border-top for recurring decimals)
        if (tag === "mjx-menclose") {
          const box = node.querySelector("mjx-box");
          const content = box ? Array.from(box.childNodes).map(convertNode).join("") : getInner();
          return `\\overline{${content}}`;
        }
        // Handle nth roots: in MathJax CHTML, mjx-mroot children are:
        //   children[0] = the degree/index element (e.g. "3" for cube root)
        //   children[1] = mjx-msqrt containing the radicand (e.g. "28")
        if (tag === "mjx-mroot") {
          const children = Array.from(node.children);
          const indexEl    = children[0]; // degree, e.g. 3
          const radicandEl = children[1]; // mjx-msqrt wrapping the radicand
          const index = indexEl ? Array.from(indexEl.childNodes).map(convertNode).join('').trim() : '';
          const radicand = radicandEl ? (() => {
            const innerBox = radicandEl.querySelector('mjx-box');
            if (innerBox) return Array.from(innerBox.childNodes).map(convertNode).join('');
            return Array.from(radicandEl.childNodes).map(convertNode).join('');
          })() : '';
          if (index) return `\\sqrt[${index}]{${radicand}}`;
          return `\\sqrt{${radicand}}`;
        }
        // Handle BOTH mjx-msqrt (outer wrapper) and mjx-sqrt (inner element)
        if (tag === "mjx-msqrt" || tag === "mjx-sqrt") {
          const box = node.querySelector("mjx-box");
          if (box) return `\\sqrt{${Array.from(box.childNodes).map(convertNode).join("")}}`;
          return `\\sqrt{${getInner()}}`;
        }
        if (tag === "mjx-root") return `\\sqrt[${getInner("mjx-degree")}]{${getBase()}}`;
        if (tag === "mjx-math") return getInner();
        // Skip box/num/den/base/script when encountered at wrong nesting level
        if (tag === "mjx-box") return getInner();
        if (tag === "mjx-mstyle") return getInner();
        // mjx-mfenced: process children directly (pipes, parens rendered via mjx-mo)
        if (tag === "mjx-mfenced") return Array.from(node.childNodes).map(convertNode).join("");

        return Array.from(node.childNodes).map(convertNode).join("");
      };

      // Remove assistive-mml wrappers first so nested containers don't get double-processed
      tmp.querySelectorAll("mjx-assistive-mml").forEach((el) => el.remove());
      tmp.querySelectorAll("mjx-container").forEach((container) => {
        const tex = convertNode(container).trim();
        if (tex) {
          const span = document.createElement("span");
          span.className = "math-tex";
          // Wrap with \( \) delimiters so KaTeX can render it properly
          span.textContent = "\\(" + tex + "\\)";
          container.replaceWith(span);
        } else {
          container.remove();
        }
      });

      // Cleanup MathJax 2.x remnants if any
      tmp.querySelectorAll(".math-tex").forEach((span) => {
        const scriptEl = span.querySelector('script[type="math/tex"]');
        if (scriptEl && scriptEl.textContent) {
          // Wrap with \( \) delimiters for proper KaTeX rendering
          const tex = scriptEl.textContent.trim();
          span.textContent = "\\(" + tex + "\\)";
        } else if (span.querySelector(".MathJax[data-mathml]")) {
          const mathml = span.querySelector(".MathJax").getAttribute("data-mathml");
          if (mathml) span.innerHTML = mathml;
        }
      });
      tmp.querySelectorAll(".MathJax_Preview, .MathJax, .MJX_Assistive_MathML").forEach((el) => el.remove());

      return tmp.innerHTML;
    } catch (e) {
      console.warn("MathJax clean failed:", e);
      return html;
    }
  }
  function cleanTestbookSpecifics(html) {
    if (!html) return html;
    try {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      // Downsize headers like "Additional Information" / "Key Points"
      // Match various ways Testbook might write font-size: 21px
      tmp.querySelectorAll("span").forEach((span) => {
        const style = span.getAttribute("style") || "";
        if (style.includes("font-size: 21px") || style.includes("font-size:21px") || span.style.fontSize === "21px") {
          span.style.fontSize = "";
          span.style.fontWeight = "600";

          // Fix the parent container if it's a flex header from Testbook
          const parentSpan = span.closest("span[style*='flex']");
          if (parentSpan) {
            parentSpan.style.display = "inline-flex";
            parentSpan.style.gap = "4px";
            parentSpan.style.width = "auto";
            parentSpan.style.justifyContent = "flex-start";
            parentSpan.style.margin = "8px 0";
          }
        }
      });
      // Downsize icons
      tmp.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src") || "";
        const widthAttr = img.getAttribute("width") || "";
        const heightAttr = img.getAttribute("height") || "";
        if (src.includes("creative_elements") || widthAttr === "26" || heightAttr === "26" || widthAttr === "26px" || heightAttr === "26px") {
          img.style.setProperty("width", "17px", "important");
          img.style.setProperty("height", "17px", "important");
          img.style.setProperty("display", "inline-block", "important");
          img.style.setProperty("margin", "0 4px 0 0", "important");
          img.style.setProperty("vertical-align", "middle", "important");
          img.style.setProperty("float", "none", "important");
          img.setAttribute("width", "17");
          img.setAttribute("height", "17");
        }
      });
      // Strip all inline font-family and font-size to ensure uniform export look
      tmp.querySelectorAll("*").forEach((el) => {
        if (el.style.fontFamily) el.style.fontFamily = "";
        if (el.style.fontSize) el.style.fontSize = "";
      });
      return tmp.innerHTML;
    } catch (e) {
      console.warn("Testbook cleaning failed:", e);
      return html;
    }
  }
  function cleanPinnacleSpecifics(html) {
    if (!html) return html;
    try {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      // Remove Pinnacle oversized font declarations and interface noise
      tmp.querySelectorAll("*").forEach(el => {
        if (el.style.fontSize) el.style.fontSize = "";
        if (el.style.fontFamily) el.style.fontFamily = "";
      });
      tmp.querySelectorAll(".reattempt-section, .see-solution, .reattempt-mode, .see-solution-content").forEach(el => el.remove());
      return tmp.innerHTML;
    } catch (e) {
      return html;
    }
  }
  function cleanOliveboardSpecifics(html) {
    if (!html) return html;
    try {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      tmp.querySelectorAll("*").forEach((el) => {
        if (el.style.fontFamily) el.style.fontFamily = "";
        if (el.style.fontSize) el.style.fontSize = "";
        if (el.style.border) el.style.border = "none";
        if (el.style.background) el.style.background = "transparent";
        if (el.style.backgroundColor) el.style.backgroundColor = "transparent";
        if (el.style.padding) el.style.padding = "0";
      });
      tmp.querySelectorAll("fieldset").forEach(fs => {
        const div = document.createElement("div");
        div.innerHTML = fs.innerHTML;
        fs.replaceWith(div);
      });
      tmp.querySelectorAll("legend").forEach(lg => {
        const strong = document.createElement("strong");
        strong.innerHTML = lg.innerHTML + " ";
        lg.replaceWith(strong);
      });
      return tmp.innerHTML;
    } catch (e) {
      return html;
    }
  }

  function stripLeadingNumber(html) {
    if (!html) return "";
    try {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT, null);
      let node;
      let cleanedAny = false;
      while (node = walker.nextNode()) {
        const text = node.textContent;
        // Match only real question-number prefixes like "1.", "Q1.", "(1)", "Q.1)", "#1-"
        // Avoid stripping math content like "[25%" where brackets+digits are part of the question
        const match = text.match(/^\s*(?:Q\.?\s*)?\d+[\s]*[\.\)\:\-\#\/]+\s*/);
        if (match) {
          const original = node.textContent;
          const cleaned = original.replace(match[0], "");
          if (cleaned !== original) {
            node.textContent = cleaned;
            cleanedAny = true;
            if (node.textContent.trim()) break;
          }
        } else {
          if (text.trim()) break;
        }
      }
      return cleanedAny ? tmp.innerHTML : html;
    } catch (e) {
      return html;
    }
  }
  function parseQuestionsFromHtml(rawHtml) {
    const cleanedHtml = cleanMathJaxHtml(rawHtml);
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${cleanedHtml}</div>`, "text/html");
    const questions = [];
    const containers = doc.querySelectorAll(
      ".BookmarkshowQuestions_question_detail__rDgAJ"
    );
    containers.forEach((container, idx) => {
      const testTitle = container.querySelector("h6")?.textContent?.replace("Test Title: ", "") || "";
      const questionDiv = container.querySelector("div:not([class*='option'])");
      const questionHtml = cleanTestbookSpecifics(questionDiv?.innerHTML || "");
      const images = [];
      container.querySelectorAll("img").forEach((img) => {
        if (img.src) images.push(img.src);
      });
      const optionDivs = container.querySelectorAll("[class*='option']");
      const options = [];
      optionDivs.forEach((opt) => {
        const label = opt.querySelector("strong")?.textContent?.replace(/[()]/g, "").trim() || "";
        const span = opt.querySelector("span");
        const html = span?.innerHTML || "";
        options.push({ label, html });
      });
      questions.push({ id: idx + 1, testTitle, questionHtml: stripLeadingNumber(questionHtml), options, images });
    });
    if (questions.length === 0) {
      // Try selecting options using Testbook's ng-repeat or generic option class
      let optionLis = Array.from(doc.querySelectorAll("ul.list-unstyled > li[ng-repeat*='getOptions'], li.option, li[ng-repeat*='getOptions()']"));
      // Ensure specific elements are unique
      optionLis = Array.from(new Set(optionLis));

      const ngRepeatOptions = optionLis.filter((li) => li.getAttribute("ng-repeat") && li.getAttribute("ng-repeat").includes("getOptions()"));
      if (ngRepeatOptions.length > 0) {
        optionLis = ngRepeatOptions;
      } else {
        optionLis = optionLis.filter((li) => {
          if (li.closest('[ng-show="isNumerical()"]')) return false;
          const text = li.textContent || "";
          if (text.includes("My Answer:") && !text.includes("Correct Answer")) return false;
          if (text.includes("Accepted answer is between:")) return false;
          return true;
        });
      }
      if (optionLis.length > 0) {
        // Use the full document for querying, not just first div
        const body = doc.body || doc.querySelector("div");
        let questionHtml = "";
        let passageHtmlStr = "";
        const images = [];
        
        // Extract comprehension passage if present
        const compEl = doc.querySelector(".aei-comprehension");
        if (compEl) {
          passageHtmlStr = '<div class="tb-passage" style="margin-bottom:10px;">' + cleanTestbookSpecifics(compEl.innerHTML) + '</div>';
          compEl.querySelectorAll("img").forEach((img) => {
            const src = img.getAttribute("src") || img.src || "";
            if (src && !src.startsWith("data:")) images.push(src.startsWith("//") ? "https:" + src : src);
          });
        }

        const allOptionQns = /* @__PURE__ */ new Set();
        optionLis.forEach((li) => {
          li.querySelectorAll(".qns-view-box").forEach((s) => allOptionQns.add(s));
        });
        // Look for question box – prefer the mar-b16 one (Testbook question node)
        const marB16 = doc.querySelector(".mar-b16.qns-view-box");
        if (marB16 && !allOptionQns.has(marB16)) {
          questionHtml = cleanTestbookSpecifics(marB16.innerHTML);
        } else {
          const allQns = body.querySelectorAll(".qns-view-box");
          for (let i = 0; i < allQns.length; i++) {
            if (!allOptionQns.has(allQns[i])) {
              questionHtml = cleanTestbookSpecifics(allQns[i].innerHTML);
              break;
            }
          }
        }
        if (!questionHtml) {
          const list = body.querySelector("ol, ul");
          if (list) {
            const clone = body.cloneNode(true);
            const listClone = clone.querySelector("ol, ul");
            listClone?.remove();
            questionHtml = clone.innerHTML;
          }
        }
        
        if (passageHtmlStr) {
          questionHtml = passageHtmlStr + questionHtml;
        }
        // Collect ALL images from the document (question + options + solution)
        doc.querySelectorAll("img").forEach((img) => {
          const src = img.getAttribute("src") || img.src || "";
          if (src && !src.startsWith("data:")) images.push(src.startsWith("//") ? "https:" + src : src);
        });
        const labels = ["a", "b", "c", "d", "e", "f"];
        const options = [];
        optionLis.forEach((li, idx) => {
          const qnsBox = li.querySelector(".qns-view-box");
          let html = "";
          let label = labels[idx] || String(idx + 1);

          // Detect correctness:
          // Case 1 – solution shown: correct-option / correct-icon class present
          // Case 2 – solution hidden: only the correct option has 'stat-available'
          //          WITHOUT also having 'incorrect-option', 'actual-incorrect-option',
          //          or 'incorrect-icon' (those mark the user's wrong answer)
          let isCorrect;
          const cl = li.classList;
          if (cl.contains("correct-option") || cl.contains("correct-icon")) {
            isCorrect = true;
          } else if (
            cl.contains("stat-available") &&
            !cl.contains("incorrect-option") &&
            !cl.contains("actual-incorrect-option") &&
            !cl.contains("incorrect-icon")
          ) {
            // stat-available without wrong markers = correct option (answer % shown only on correct)
            isCorrect = true;
          }

          if (qnsBox) {
            html = qnsBox.innerHTML;
            const textContent = qnsBox.textContent || "";
            const labelMatch = textContent.match(/^\s*\(([a-z])\)\s*/i);
            if (labelMatch) {
              label = labelMatch[1];
            }
          } else {
            const labelEl = li.querySelector("label");
            const text = labelEl?.textContent || "";
            const labelMatch = text.match(/\(([a-z])\)/i);
            if (labelMatch) label = labelMatch[1];
            const span = li.querySelector("span.qns-view-box, span.mar-l8");
            html = span?.innerHTML || span?.textContent || text.replace(/\([a-z]\)\s*/i, "");
          }

          // Clean up injected percent/stat spans – use DOMParser (safe in all contexts)
          const cleanDoc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
          cleanDoc.querySelectorAll(".ans-percent, .option-stat, .correctness, .incorrectness").forEach(el => el.remove());
          html = cleanDoc.querySelector("div").innerHTML;

          // Fix protocol-relative image srcs inside option html
          html = html.replace(/src="\/\//g, 'src="https://');

          options.push({ label, html, isCorrect });
        });
        let solutionHtml = "";
        const solNode = doc.querySelector('[ng-bind-html*="getSolutionDesc"]');
        if (solNode) {
          solutionHtml = cleanTestbookSpecifics(solNode.innerHTML);
          solutionHtml = solutionHtml.replace(/src="\/\//g, 'src="https://');
          solNode.querySelectorAll("img").forEach((img) => {
            if (img.src) images.push(img.src);
          });
        }
        if (options.length > 0) {
          // Fallback for Testbook: if correctness classes aren't present, check solution text
          const hasCorrect = options.some(o => !!o.isCorrect);
          if (!hasCorrect && solutionHtml) {
            const solText = solutionHtml.replace(/<[^>]*>?/gm, ' ');
            // Match patterns like "Correct answer is 'Parameter'" or "Correct answer is Option 1"
            const match = solText.match(/correct answer is '?\s*([^']+?)'?\./i) || solText.match(/correct answer is ([A-D])/i) || solText.match(/correct answer is Option\s*(\d+)/i);
            if (match) {
              const val = match[1].toLowerCase();
              if (val === 'a' || val === 'b' || val === 'c' || val === 'd') {
                const idx = val.charCodeAt(0) - 97;
                if (options[idx]) options[idx].isCorrect = true;
              } else if (!isNaN(parseInt(val))) {
                const idx = parseInt(val) - 1;
                if (options[idx]) options[idx].isCorrect = true;
              } else {
                const bestMatch = options.find(o => o.html.toLowerCase().includes(val) || val.includes(o.html.toLowerCase()));
                if (bestMatch) bestMatch.isCorrect = true;
              }
            }
          }
          questionHtml = questionHtml.replace(/src="\/\//g, 'src="https://');
          questions.push({ id: 1, testTitle: "", questionHtml: stripLeadingNumber(questionHtml), options, images, solutionHtml });
        }
      }
    }
    if (questions.length === 0) {
      const qoptions = doc.querySelector(".qoptions");
      const optDivs = qoptions?.querySelectorAll(".opt");
      if (qoptions && optDivs && optDivs.length > 0) {
        const qblock = doc.querySelector(".qblock");
        let questionHtml = "";
        const images = [];
        // Capture passage text for RC / Cloze Test questions
        const passageEl = doc.querySelector(".paneqcol.panetxt");
        if (passageEl) {
          questionHtml += '<div class="ob-passage" style="margin-bottom:10px;font-size:12px;line-height:1.6;">' + cleanOliveboardSpecifics(passageEl.innerHTML) + '</div>';
          passageEl.querySelectorAll("img").forEach((img) => {
            if (img.src) images.push(img.src);
          });
        }
        if (qblock) {
          const eqt = qblock.querySelector(".eqt");
          if (eqt) {
            questionHtml += cleanOliveboardSpecifics(eqt.innerHTML);
          } else {
            const pTags = qblock.querySelectorAll("p");
            if (pTags.length > 0) {
              pTags.forEach((p) => {
                questionHtml += p.outerHTML;
              });
            } else {
              questionHtml += cleanOliveboardSpecifics(qblock.innerHTML);
            }
          }
          qblock.querySelectorAll("img").forEach((img) => {
            if (img.src) images.push(img.src);
          });
        }
        const options = [];
        optDivs.forEach((opt) => {
          const leftEl = opt.querySelector(".left");
          const rightEl = opt.querySelector(".rightopt");
          const label = leftEl?.textContent?.trim() || "";
          const html = rightEl?.innerHTML || "";
          const isCorrect = opt.classList.contains("correct") ? true : void 0;
          options.push({ label, html, isCorrect });
        });
        let solutionHtml = "";
        const solTxt = doc.querySelector(".solutiontxt");
        if (solTxt) {
          solutionHtml = solTxt.innerHTML;
          solTxt.querySelectorAll("img").forEach((img) => {
            if (img.src) images.push(img.src);
          });
        }
        if (options.length > 0) {
          questions.push({ id: 1, testTitle: "", questionHtml: stripLeadingNumber(questionHtml), options, images, solutionHtml });
        }
      }
    }
    if (questions.length === 0) {
      const solQuestion = doc.querySelector(".sol-questions");
      const solOptions = doc.querySelectorAll(".sol-aption");
      if (solQuestion && solOptions.length > 0) {
        let questionHtml = cleanPinnacleSpecifics(solQuestion.innerHTML);
        const images = [];
        solQuestion.querySelectorAll("img").forEach((img) => {
          if (img.src) images.push(img.src);
        });
        const labels = ["a", "b", "c", "d", "e", "f"];
        const options = [];
        solOptions.forEach((opt, idx) => {
          const labelText = labels[idx] || String(idx + 1);
          const labelEl = opt.querySelector("label");
          const innerDiv = labelEl?.querySelector("div") || labelEl?.querySelector("span");
          let html = cleanPinnacleSpecifics(innerDiv?.innerHTML || labelEl?.innerHTML || opt.textContent || "");
          const isCorrectCls = labelEl?.classList.contains("c-option") || labelEl?.classList.contains("correct-yes");
          const isCorrectStyle = labelEl?.getAttribute("style")?.includes("rgb(39, 174, 96)") || labelEl?.getAttribute("style")?.includes("#27ae60");
          const isCorrect = isCorrectCls || isCorrectStyle ? true : void 0;
          options.push({ label: labelText, html, isCorrect });
        });
        let solutionHtml = "";
        const ansSol = doc.querySelector(".ans-solution");
        if (ansSol) {
          solutionHtml = cleanPinnacleSpecifics(ansSol.innerHTML);
          ansSol.querySelectorAll("img").forEach((img) => {
            if (img.src) images.push(img.src);
          });
        }
        if (options.length > 0) {
          questions.push({ id: 1, testTitle: "", questionHtml: stripLeadingNumber(questionHtml), options, images, solutionHtml });
        }
      }
    }
    // --- Testranking / pt-borders Support ---
    if (questions.length === 0) {
      const p1Candidates = Array.from(doc.querySelectorAll(".p-1"));
      // Real questions always have a <p> child with substantial text; UI buttons don't
      const p1 = p1Candidates.find(el => {
        const p = el.querySelector('p');
        return p && p.textContent.trim().length > 40;
      }) || p1Candidates[0];
      const ptTables = doc.querySelectorAll("table.table-pt");
      if (p1 && ptTables.length > 0) {
        let questionHtml = p1.innerHTML;
        const images = [];
        p1.querySelectorAll("img").forEach((img) => {
          if (img.src) images.push(img.src);
        });

        const labels = ["a", "b", "c", "d", "e", "f"];
        const options = [];
        // Filter for leaf option tables
        const realOptionTables = Array.from(ptTables).filter(
          (t) => (t.querySelector(".q-opt-pt") || t.querySelector("label[for^='opt-']")) && t.querySelectorAll("table.table-pt").length === 0
        );

        realOptionTables.forEach((table, idx) => {
          const isCorrect = table.classList.contains("opt-correct-pt") || table.closest(".opt-correct-pt") ? true : void 0;
          const qNo = table.querySelector(".q-no");
          const label = qNo?.textContent?.trim() || labels[idx] || String(idx + 1);
          const optDiv = table.querySelector(".q-opt-pt p") || table.querySelector("label p") || table.querySelector(".q-opt-pt") || table.querySelector("label");
          const html = optDiv?.innerHTML || optDiv?.textContent || "";
          options.push({ label, html, isCorrect });
        });

        let solutionHtml = "";
        const solSec = doc.querySelector(".solution-sec");
        if (solSec) {
          const clone = solSec.cloneNode(true);
          const header = clone.querySelector(".f-20");
          if (header) header.remove();
          solutionHtml = clone.innerHTML;
          clone.querySelectorAll("img").forEach((img) => {
            if (img.src) images.push(img.src);
          });
        }

        if (options.length > 0) {
          questions.push({ id: 1, testTitle: "Testranking", questionHtml: stripLeadingNumber(questionHtml), options, images, solutionHtml });
        }
      }
    }
    if (questions.length === 0) {
      const obQuestion = doc.querySelector(".qblock.qos-col .eqt");
      if (obQuestion) {
        const fixImageUrl = (url) => {
          if (!url) return "";
          if (url.startsWith("data:")) return url;
          // If it contains oliveimg but not the correct domain, rewrite it
          if (url.includes("oliveimg/")) {
            const parts = url.split("oliveimg/");
            return "https://u1.oliveboard.in/exams/solution/oliveimg/" + parts[parts.length - 1];
          }
          if (!url.startsWith("http")) return "https://u1.oliveboard.in/exams/solution/" + url;
          return url;
        };

        let questionHtml = "";
        const images = [];

        // Capture passage text for RC / Cloze Test questions
        const passageEl = doc.querySelector(".paneqcol.panetxt");
        if (passageEl) {
          passageEl.querySelectorAll("img").forEach((img) => {
            const src = fixImageUrl(img.getAttribute("src") || img.src);
            img.setAttribute("src", src);
            if (src) images.push(src);
          });
          questionHtml += '<div class="ob-passage" style="margin-bottom:10px;">' + cleanOliveboardSpecifics(passageEl.innerHTML) + '</div>';
        }

        obQuestion.querySelectorAll("img").forEach((img) => {
          const src = fixImageUrl(img.getAttribute("src") || img.src);
          img.setAttribute("src", src);
          if (src) images.push(src);
        });
        questionHtml += cleanOliveboardSpecifics(obQuestion.innerHTML);

        const options = [];
        const optNodes = doc.querySelectorAll(".qoptions .opt");
        optNodes.forEach((optNode) => {
          const label = optNode.querySelector(".left")?.textContent?.trim() || "";
          const rightOpt = optNode.querySelector(".rightopt .eqt");

          if (rightOpt) {
            rightOpt.querySelectorAll("img").forEach((img) => {
              const src = fixImageUrl(img.getAttribute("src") || img.src);
              img.setAttribute("src", src);
              if (src) images.push(src);
            });
          }

          const html = rightOpt?.innerHTML || "";
          const isCorrect = optNode.classList.contains("correct") ? true : void 0;
          options.push({ label, html, isCorrect });
        });

        let solutionHtml = "";
        const solSec = doc.querySelector(".sblock .solutiontxt");
        if (solSec) {
          solSec.querySelectorAll("img").forEach((img) => {
            const src = fixImageUrl(img.getAttribute("src") || img.src);
            img.setAttribute("src", src);
            if (src) images.push(src);
          });
          solutionHtml = solSec.innerHTML;
        }

        if (options.length > 0) {
          questions.push({ id: 1, testTitle: "", questionHtml: stripLeadingNumber(questionHtml), options, images, solutionHtml });
        }
      }
    }
    if (questions.length === 0) {
      const optionSection = doc.querySelector(".sol-option-section");
      if (optionSection) {
        const solOptions = optionSection.querySelectorAll(".sol-aption");
        let questionHtml = "";
        const images = [];
        const body = doc.querySelector("div") || doc.body;
        const allDivs = body.children;
        for (let i = 0; i < allDivs.length; i++) {
          const el = allDivs[i];
          if (!el.classList?.contains("sol-option-section")) {
            questionHtml += el.innerHTML || "";
            el.querySelectorAll("img").forEach((img) => {
              if (img.src) images.push(img.src);
            });
          }
        }
        const labels = ["a", "b", "c", "d", "e", "f"];
        const options = [];
        solOptions.forEach((opt, idx) => {
          const labelText = labels[idx] || String(idx + 1);
          const labelEl = opt.querySelector("label");
          const innerDiv = labelEl?.querySelector("div") || labelEl?.querySelector("span");
          const html = innerDiv?.innerHTML || labelEl?.innerHTML || opt.textContent || "";
          const isCorrectCls = labelEl?.classList.contains("c-option") || labelEl?.classList.contains("correct-yes");
          const isCorrectStyle = labelEl?.getAttribute("style")?.includes("rgb(39, 174, 96)") || labelEl?.getAttribute("style")?.includes("#27ae60");
          const isCorrect = isCorrectCls || isCorrectStyle ? true : void 0;
          options.push({ label: labelText, html, isCorrect });
        });
        if (options.length > 0) {
          questions.push({ id: 1, testTitle: "", questionHtml: stripLeadingNumber(questionHtml), options, images });
        }
      }
    }
    if (questions.length === 0) {
      const qWrap = doc.querySelector(".question-wrap");
      const optLabels = doc.querySelectorAll("label.custom_radio_btn");
      if (qWrap && optLabels.length > 0) {
        let questionHtml = qWrap.querySelector("h3")?.innerHTML || "";
        const images = [];
        qWrap.querySelectorAll("img").forEach((img) => {
          if (img.src) images.push(img.src);
        });
        const options = [];
        const labels = ["a", "b", "c", "d", "e", "f"];
        optLabels.forEach((labelEl, idx) => {
          const optTextSpan = labelEl.querySelector(".option-text");
          const html = optTextSpan?.innerHTML || labelEl.textContent.trim();
          const isCorrect = labelEl.classList.contains("correct-option");
          const label = labels[idx] || String(idx + 1);
          options.push({ label, html, isCorrect });
        });
        let solutionHtml = "";
        const solDiv = doc.querySelector('[class*="reattempt_solution_view"]');
        if (solDiv) {
          solutionHtml = solDiv.innerHTML;
          solDiv.querySelectorAll("img").forEach((img) => {
            if (img.src) images.push(img.src);
          });
        }
        if (options.length > 0) {
          questions.push({ id: 1, testTitle: "", questionHtml: stripLeadingNumber(questionHtml), options, images, solutionHtml });
        }
      }
    }
    if (questions.length === 0) {
      const body = doc.querySelector("div") || doc.body;
      const fullHtml = body.innerHTML || "";
      const textContent = body.textContent?.trim() || "";
      if (textContent.length > 10) {
        const hrParts = fullHtml.split(/<hr[^>]*>/i).filter((part) => {
          const tmp = document.createElement("div");
          tmp.innerHTML = part;
          return (tmp.textContent?.trim().length || 0) > 5;
        });
        if (hrParts.length > 1) {
          hrParts.forEach((part, idx) => {
            const images = [];
            const tmp = document.createElement("div");
            tmp.innerHTML = part;
            tmp.querySelectorAll("img").forEach((img) => {
              if (img.src) images.push(img.src);
            });
            questions.push({ id: idx + 1, testTitle: "", questionHtml: stripLeadingNumber(part.trim()), options: [], images });
          });
        } else {
          const numberPattern = /(?:^|\n)\s*(\d+)\.\s/;
          const paragraphs = body.querySelectorAll("p");
          if (paragraphs.length > 1) {
            const numbered = [];
            let currentHtml = "";
            let currentImages = [];
            const allChildren = body.querySelectorAll("*");
            paragraphs.forEach((p) => {
              const text = p.textContent?.trim() || "";
              const match = text.match(/^(\d+)\.\s/);
              if (match && numbered.length > 0 || match && currentHtml) {
                if (currentHtml) {
                  numbered.push({ num: numbered.length + 1, html: currentHtml, images: [...currentImages] });
                  currentImages = [];
                }
                currentHtml = p.outerHTML;
              } else {
                currentHtml += p.outerHTML;
              }
              p.querySelectorAll("img").forEach((img) => {
                if (img.src) currentImages.push(img.src);
              });
            });
            if (currentHtml) {
              numbered.push({ num: numbered.length + 1, html: currentHtml, images: currentImages });
            }
            if (numbered.length > 0) {
              numbered.forEach((item, idx) => {
                questions.push({ id: idx + 1, testTitle: "", questionHtml: stripLeadingNumber(item.html), options: [], images: item.images });
              });
            }
          }
          if (questions.length === 0) {
            const images = [];
            body.querySelectorAll("img").forEach((img) => {
              if (img.src) images.push(img.src);
            });
            questions.push({ id: 1, testTitle: "", questionHtml: stripLeadingNumber(fullHtml), options: [], images });
          }
        }
      }
    }
    return questions;
  }
  var PRINT_STYLES = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
        
        body {
            background-color: #f3f4f6;
            font-family: 'Inter', sans-serif;
            color: #000000;
            font-size: 12px;
        }

        /* Force consistent font across all captured content, but protect KaTeX math */
        .page-container, .page-container *:not(.katex):not(.katex *), .sol-content, .sol-content *:not(.katex):not(.katex *) {
            font-family: 'Inter', sans-serif !important;
            font-size: inherit !important;
        }

        .katex, .math-tex, mjx-container {
            font-size: 14.5px !important;
            vertical-align: middle;
            padding: 3px 0;
            display: inline-block;
            font-weight: normal !important;
            line-height: normal !important;
        }

        /* KaTeX requires content-box for correct sqrt/overline/fraction rendering.
           Tailwind preflight sets border-box globally which breaks these, 
           and sets border-color to gray, hiding fraction/root bars. */
        .katex, .katex * {
            box-sizing: content-box !important;
            border-color: currentColor !important;
        }

        .page-container {
            width: 210mm;
            min-height: 297mm;
            padding: 5mm; /* drastically reduced page margin */
            margin: 2rem auto;
            background: white;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
        }

        .question-num {
            font-weight: 600;
            display: inline-block;
            margin-right: 0.25rem;
        }

        .option-item {
            display: flex;
            align-items: flex-start;
            gap: 0.25rem;
            font-weight: 500;
        }

        .opt-label {
            font-weight: 600;
            flex-shrink: 0;
            white-space: nowrap;
        }

        .opt-content {
            flex-grow: 1;
            margin: 0;
        }

        /* Prevent images from taking up entire page */
        img {
            max-width: 90% !important;
            height: auto !important;
            object-fit: contain !important;
        }

        .opt-content img {
            max-height: 120px !important;
            max-width: 100% !important;
            display: block !important;
            margin: 2px auto !important;
            object-fit: contain !important;
        }

        .leading-snug img, .sol-content img {
            max-height: 250px !important;
            max-width: 100% !important;
            margin: 2px !important;
            object-fit: contain !important;
        }

        /* When a question has 4+ images, shrink them and flow inline */
        .multi-img img {
            max-height: 130px !important;
            max-width: 45% !important;
            display: inline-block !important;
            vertical-align: top !important;
            margin: 4px !important;
        }

        /* Specific fix for small icons (like Testbook's Key Points/Additional Info) */
        img[src*="creative_elements"], 
        img[width="26px"], 
        img[height="26px"],
        .leading-snug img[src*="creative_elements"],
        .sol-content img[src*="creative_elements"] {
            display: inline-block !important;
            width: 17px !important;
            height: 17px !important;
            max-width: 17px !important;
            max-height: 17px !important;
            margin: 0 4px 0 0 !important;
            vertical-align: middle !important;
        }

        /* Fix for large headers in solution */
        span[style*="font-size: 21px"],
        span[style*="font-size:21px"] {
            font-size: 15px !important;
            font-weight: 600 !important;
        }

        /* Fix the Testbook flex header container */
        .leading-snug span[style*="display: flex"],
        .sol-content span[style*="display: flex"] {
            display: inline-flex !important;
            width: auto !important;
            gap: 4px !important;
            justify-content: flex-start !important;
            margin: 4px 0 !important;
        }

        .answer-key-box {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid #e5e7eb;
            padding: 0.25rem 0.5rem;
            border-radius: 0.375rem;
            margin-right: 0.25rem;
            margin-bottom: 0.25rem;
            font-weight: 600;
            font-size: 0.9rem;
        }

        .divider {
            border: 0;
            border-top: 1px dashed #bbb;
            margin: 0.5rem 0;
        }

        .space-y-2 > :not([hidden]) ~ :not([hidden]) {
            --tw-space-y-reverse: 0;
            margin-top: calc(0.5rem * calc(1 - var(--tw-space-y-reverse)));
            margin-bottom: calc(0.5rem * var(--tw-space-y-reverse));
        }
        
        .sol-content p, .sol-content ul, .sol-content ol { margin-bottom: 0.3rem; }
        .sol-content li { margin-bottom: 0.2rem; }

        @media print {
            body { background: white; margin: 0; padding: 0; }
            .page-container { box-shadow: none; margin: 0; width: 100%; padding: 3mm; }
            .no-print { display: none; }
            img { max-width: 90% !important; height: auto !important; max-height: 250px !important; object-fit: contain !important; }
            .opt-content img { max-height: 120px !important; max-width: 100% !important; object-fit: contain !important; }
            .sol-content img { max-height: 250px !important; max-width: 90% !important; object-fit: contain !important; }
            .leading-snug img { max-height: 250px !important; max-width: 100% !important; object-fit: contain !important; }
            .multi-img img { max-height: 130px !important; max-width: 45% !important; display: inline-block !important; vertical-align: top !important; margin: 4px !important; }
        }
  `;
  /**
   * Extract the ob-passage div from questionHtml, returning { passage, questionOnly }.
   * If no passage exists, passage is '' and questionOnly is the original html.
   */
  function extractPassage(questionHtml) {
    const match = questionHtml.match(/^(<div class="ob-passage"[\s\S]*?<\/div>)([\s\S]*)$/);
    if (match) return { passage: match[1], questionOnly: match[2] };
    return { passage: '', questionOnly: questionHtml };
  }

  function extractAlphaWords(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || '').split(/[^a-zA-Z]+/).filter(w => w.length > 0).map(w => w.toLowerCase());
  }


  function renderQuestion(q, qIdx, displayQuestionHtml) {
    const labels = ['a', 'b', 'c', 'd', 'e', 'f'];

    let isLong = false;
    for (const opt of q.options) {
      let cleanText = opt.html.replace(/<[^>]*>?/gm, ' ').replace(/\\\(/g, '').replace(/\\\)/g, '').replace(/\s+/g, ' ').trim();
      let wordCount = cleanText.split(/\s+/).filter(w => w.length > 0).length;
      if (wordCount > 2) { isLong = true; break; }
    }

    let optsHtml = '';
    if (q.options.length > 0) {
      const containerStyle = isLong
        ? 'display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.4rem;'
        : 'display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem 0.6rem; margin-top: 0.4rem;';
      optsHtml = `<div style="${containerStyle}">
        ${q.options.map((opt, i) => `
          <div class="option-item" style="align-items: flex-start; gap: 0.25rem; border: 1px solid #e5e7eb; border-radius: 4px; padding: 3px; min-height: 20px;">
            <span class="opt-label" style="font-weight:600; font-size:12px; color: #000000;">${labels[i] || String.fromCharCode(97 + i)})</span>
            <div class="opt-content" style="max-width: 100%; font-size: 12px; line-height: 1.6;">
              ${cleanTestbookSpecifics(opt.html).replace(/<img/g, '<img style="max-height:120px !important; max-width:100% !important; display:block; margin:2px auto;"')}
            </div>
          </div>`).join('')}
      </div>`;
    }

    let questionContent = displayQuestionHtml !== undefined ? displayQuestionHtml : q.questionHtml;
    
    try {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = questionContent;
      const imgs = tempDiv.querySelectorAll('img');
      
      if (imgs.length >= 4) {
        const targetImgs = Array.from(imgs).slice(-4);
        const blocks = [];
        
        targetImgs.forEach(img => {
           let container = img.parentElement;
           let bestContainer = img;
           
           while (container && container !== tempDiv) {
              const clone = container.cloneNode(true);
              clone.querySelectorAll('img').forEach(i => i.remove());
              const textLen = clone.textContent.trim().length;
              
              if (textLen < 40 && container.querySelectorAll('img').length === 1) {
                 bestContainer = container;
                 container = container.parentElement;
              } else {
                 break;
              }
           }
           
           if (!blocks.includes(bestContainer)) {
              blocks.push(bestContainer);
           }
        });

        if (blocks.length === 4) {
           const labels = [];
           const prevsToRemove = [];
           
           blocks.forEach((b, idx) => {
              let label = '';
              let prev = b.previousElementSibling;
              
              if (prev && !prev.querySelector('img') && prev.textContent.trim().length < 15) {
                 const text = prev.textContent.trim();
                 if (text.length > 0) {
                     label = text;
                     prevsToRemove.push(prev);
                 }
              }
              
              if (!label) {
                 const bText = b.textContent.trim();
                 if (bText.length > 0 && bText.length < 15) {
                    label = bText;
                 }
              }
              
              if (!label) {
                 const fallback = ['(a)', '(b)', '(c)', '(d)'];
                 label = fallback[idx] || '';
              }
              labels.push(label);
           });
           
           // Remove the isolated label elements so they don't clutter the page
           prevsToRemove.forEach(p => p.remove());

           const grid = document.createElement('div');
           grid.style.display = 'grid';
           grid.style.gridTemplateColumns = '1fr 1fr';
           grid.style.gap = '8px';
           grid.style.marginTop = '12px';
           grid.style.width = '100%';
           
           blocks[0].parentNode.insertBefore(grid, blocks[0]);
           
           blocks.forEach((b, idx) => {
              const wrapper = document.createElement('div');
              wrapper.style.margin = '0';
              wrapper.style.padding = '8px';
              wrapper.style.border = '1px solid #e5e7eb';
              wrapper.style.borderRadius = '4px';
              wrapper.style.display = 'flex';
              wrapper.style.flexDirection = 'column';
              wrapper.style.alignItems = 'center';
              wrapper.style.justifyContent = 'center';
              wrapper.style.background = '#fafafa';
              wrapper.style.position = 'relative'; 
              
              const labelEl = document.createElement('div');
              labelEl.textContent = labels[idx];
              labelEl.style.position = 'absolute';
              labelEl.style.top = '4px';
              labelEl.style.left = '6px';
              labelEl.style.fontWeight = '600';
              labelEl.style.fontSize = '12px';
              labelEl.style.color = '#000';
              labelEl.style.background = 'rgba(255,255,255,0.7)';
              labelEl.style.padding = '0 2px';
              labelEl.style.borderRadius = '2px';
              
              const img = b.tagName === 'IMG' ? b : b.querySelector('img');
              if (img) {
                 img.style.setProperty('max-height', '130px', 'important');
                 img.style.setProperty('max-width', '100%', 'important');
                 img.style.setProperty('display', 'block', 'important');
                 img.style.setProperty('margin', '0 auto', 'important');
                 
                 wrapper.appendChild(img);
                 wrapper.appendChild(labelEl);
                 b.remove(); 
              }
              grid.appendChild(wrapper);
           });
        } else {
           targetImgs.forEach(img => {
              img.style.setProperty('max-height', '130px', 'important');
              img.style.setProperty('max-width', '45%', 'important');
              img.style.setProperty('display', 'inline-block', 'important');
              img.style.setProperty('margin', '4px', 'important');
           });
        }
      }
      questionContent = tempDiv.innerHTML;
    } catch(e) {}

    return `<div style="break-inside: avoid; page-break-inside: avoid; margin-bottom: 0.75rem; font-size: 12px;">
      <div style="display: flex; align-items: flex-start; gap: 0.25rem;">
        <span class="question-num" style="flex-shrink: 0; font-weight: 600; font-size: 13px;">${qIdx + 1}.</span>
        <div class="leading-snug" style="flex-grow: 1; margin: 0; font-weight: 600; line-height: 1.6; font-size: 13px;">${cleanTestbookSpecifics(questionContent)}</div>
      </div>
      <div style="padding-left: 0.75rem;">
        ${optsHtml}
      </div>
    </div>`;
  }

  function renderQuestionsDeduped(questions) {
    const PASSAGE_STYLE = 'margin-bottom:10px;font-size:12px;line-height:1.6;font-weight:400;';
    const OMITTED_HTML = '<div style="color:#64748b;font-style:italic;margin-bottom:8px;font-size:11px;background:#f1f5f9;padding:4px 8px;border-radius:4px;display:inline-block;">[Passage omitted — see Q%REF%]</div>';

    function getTextWords(html) {
      const div = document.createElement('div');
      div.innerHTML = html;
      return (div.textContent || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 1);
    }
    
    // Find the longest common contiguous word-subsequence between two word arrays
    function longestCommonWordRun(w1, w2) {
      let maxLen = 0, endIdx1 = 0;
      for (let start1 = 0; start1 < w1.length; start1++) {
        for (let start2 = 0; start2 < w2.length; start2++) {
          if (w1[start1] !== w2[start2]) continue;
          let len = 0;
          while (start1 + len < w1.length && start2 + len < w2.length && w1[start1 + len] === w2[start2 + len]) {
            len++;
          }
          if (len > maxLen) { maxLen = len; endIdx1 = start1 + len; }
        }
      }
      return { words: w1.slice(endIdx1 - maxLen, endIdx1), startIdx: endIdx1 - maxLen, length: maxLen };
    }

    function stripPassageFromHtml(html, passageWords) {
      const div = document.createElement('div');
      div.innerHTML = html;
      const fullText = (div.textContent || '').toLowerCase();
      const fullWords = fullText.split(/[^a-z]+/).filter(w => w.length > 1);

      let passageStartWordIdx = -1;
      outer: for (let i = 0; i <= fullWords.length - passageWords.length; i++) {
        for (let j = 0; j < passageWords.length; j++) {
          if (fullWords[i + j] !== passageWords[j]) continue outer;
        }
        passageStartWordIdx = i;
        break;
      }
      if (passageStartWordIdx === -1) return html;

      let passageEndWordIdx = passageStartWordIdx + passageWords.length;

      // Expand to include preamble BEFORE the passage
      const preambleWords = new Set(['read', 'passage', 'direction', 'directions', 'following',
        'comprehension', 'answer', 'questions', 'given', 'carefully', 'below']);
      const wordsBefore = fullWords.slice(0, passageStartWordIdx);
      if (wordsBefore.length > 0 && wordsBefore.length < 40) {
        if (wordsBefore.some(w => preambleWords.has(w))) {
          passageStartWordIdx = 0;
        }
      }

      const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT, null, false);
      let wordCount = 0;
      let startNode = null, startOffset = 0;
      let endNode = null, endOffset = 0;
      let node;

      while ((node = walker.nextNode())) {
        const text = node.nodeValue;
        const matches = [...text.matchAll(/[a-zA-Z]{2,}/g)];
        for (const m of matches) {
          if (wordCount === passageStartWordIdx && !startNode) {
            startNode = node;
            startOffset = m.index;
            while (startOffset > 0 && /[\s\.,;:!?\-]/.test(text[startOffset - 1])) {
              startOffset--;
            }
          }
          wordCount++;
          if (wordCount === passageEndWordIdx) {
            endNode = node;
            endOffset = m.index + m[0].length;
            while (endOffset < text.length && /[\s\.,;:!?\-]/.test(text[endOffset])) {
              endOffset++;
            }
          }
        }
      }

      if (!startNode || !endNode) return html;

      if (startNode === endNode) {
        startNode.nodeValue = startNode.nodeValue.substring(0, startOffset) + startNode.nodeValue.substring(endOffset);
      } else {
        startNode.nodeValue = startNode.nodeValue.substring(0, startOffset);
        endNode.nodeValue = endNode.nodeValue.substring(endOffset);

        const allNodesToRemove = [];
        const w2 = document.createTreeWalker(div, NodeFilter.SHOW_ALL, null, false);
        let n2, inRange = false;
        while ((n2 = w2.nextNode())) {
          if (n2 === startNode) { inRange = true; continue; }
          if (n2 === endNode) { inRange = false; continue; }
          if (inRange) allNodesToRemove.push(n2);
        }
        for (const tn of allNodesToRemove) {
          if (tn.contains && tn.contains(endNode)) continue;
          if (tn.nodeType === Node.TEXT_NODE) tn.nodeValue = '';
          else if (tn.nodeType === Node.ELEMENT_NODE) tn.remove();
        }
      }

      const allEls = Array.from(div.querySelectorAll('*')).reverse();
      for (const el of allEls) {
        if (el.tagName !== 'IMG' && el.tagName !== 'BR' && el.textContent.trim() === '' && !el.querySelector('img')) {
          el.remove();
        }
      }

      return div.innerHTML;
    }

    function findDenseBlock(html) {
      if (!html) return null;
      const div = document.createElement('div');
      div.innerHTML = html;
      const segments = html.split(/<\s*(?:br|p|div|hr|h[1-6]|ul|ol|li|table|tr)[\s>/]/i);
      let longestSeg = '';
      for (const seg of segments) {
        const text = seg.replace(/<[^>]*>?/gm, '').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > longestSeg.length) longestSeg = text;
      }
      if (longestSeg.length >= 100) {
        const words = longestSeg.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 1);
        return { text: longestSeg, words, length: longestSeg.length };
      }
      const fullText = (div.textContent || '').replace(/\s+/g, ' ').trim();
      if (fullText.length >= 200) {
        const words = fullText.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 1);
        if (words.length >= 30) {
          return { text: fullText, words, length: fullText.length };
        }
      }
      return null;
    }

    function getPlainText(html) {
      const d = document.createElement('div');
      d.innerHTML = html;
      return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }

    const tagged = questions.map(q => {
      const match = q.questionHtml.match(/^(<div class="ob-passage"[\s\S]*?<\/div>)([\s\S]*)$/);
      const isOb = !!match;
      const questionOnly = isOb ? match[2] : q.questionHtml;
      const words = getTextWords(questionOnly);
      const denseBlock = isOb ? null : findDenseBlock(questionOnly);
      const plainText = isOb ? '' : getPlainText(questionOnly);

      const hasPassageKeyword = /read\s+the\s+following\s+passage/i.test(plainText) ||
                                /passage\s+and\s+answer/i.test(plainText);

      const isCloze = /cloze\s*test/i.test(plainText) ||
                      /passage.*words.*(?:deleted|omitted)/i.test(plainText) ||
                      /fill\s+in\s+(?:the\s+)?blank/i.test(plainText);

      return {
        q, isOb,
        passage: isOb ? match[1] : '',
        questionOnly, words, denseBlock, plainText,
        hasPassageKeyword, isCloze,
        displayHtml: q.questionHtml,
        passageGroup: -1
      };
    });

    let groupId = 0;
    for (let i = 0; i < tagged.length; i++) {
      if (tagged[i].isOb) continue;
      if (tagged[i].passageGroup >= 0) continue;

      if (tagged[i].hasPassageKeyword || tagged[i].isCloze) {
        const members = [i];
        for (let j = i + 1; j < Math.min(i + 15, tagged.length); j++) {
          if (tagged[j].isOb) continue;
          const lcr = longestCommonWordRun(tagged[i].words, tagged[j].words);
          if (lcr.length >= 30) {
            members.push(j);
          } else { 
            break;
          }
        }
        if (members.length >= 2) {
          for (const m of members) { tagged[m].passageGroup = groupId; }
          groupId++;
          continue;
        }
      }

      const members = [i];
      for (let j = i + 1; j < Math.min(i + 15, tagged.length); j++) {
        if (tagged[j].isOb) continue;
        const lcr = longestCommonWordRun(tagged[i].words, tagged[j].words);
        if (lcr.length >= 50) {
          members.push(j);
        }
      }
      
      if (members.length >= 2) {
        for (const m of members) { tagged[m].passageGroup = groupId; }
        groupId++;
      }
    }

    function getClozeInstruction(html) {
      const div = document.createElement('div');
      div.innerHTML = html;
      const blocks = Array.from(div.querySelectorAll('p, div, span, b, strong')).reverse();
      for (const block of blocks) {
        const text = (block.textContent || '').trim();
        if (text.length > 15 && text.length < 150 && /\d+/.test(text) && /blank|option|fill/i.test(text)) {
          return text;
        }
      }
      const text = div.textContent || '';
      const matches = [...text.matchAll(/([^.!?\n]*?(?:blank|option|fill)[^.!?\n]*?\d+[^.!?\n]*)/gi)];
      if (matches.length > 0) {
        return matches[matches.length - 1][0].trim();
      }
      return '';
    }

    const groupFirstIdx = {};
    const groupPassageWords = {};

    for (let i = 0; i < tagged.length; i++) {
      const gid = tagged[i].passageGroup;
      if (gid < 0 || tagged[i].isOb) continue;

      if (!(gid in groupFirstIdx)) {
        groupFirstIdx[gid] = i;
        tagged[i].displayHtml = tagged[i].questionOnly;
      } else {
        if (!(gid in groupPassageWords)) {
          const firstQ = tagged[groupFirstIdx[gid]];
          const lcr = longestCommonWordRun(firstQ.words, tagged[i].words);
          groupPassageWords[gid] = lcr.length >= 15 ? lcr.words : null;
        }
        const pw = groupPassageWords[gid];
        if (pw && pw.length > 0) {
          let strippedHtml = stripPassageFromHtml(tagged[i].questionOnly, pw);
          
          if (tagged[i].isCloze) {
            const instruction = getClozeInstruction(tagged[i].questionOnly);
            if (instruction && !strippedHtml.includes(instruction)) {
              strippedHtml = `<div style="font-weight: 600; margin: 0; padding: 0; line-height: 1.5;">${instruction}</div>`;
            }
          }
          
          tagged[i].displayHtml = strippedHtml;
        } else {
          tagged[i].displayHtml = tagged[i].questionOnly;
        }
      }
    }

    let currentObPassage = null;
    for (let i = 0; i < tagged.length; i++) {
      if (!tagged[i].isOb) { currentObPassage = null; continue; }
      if (currentObPassage && tagged[i].passage === currentObPassage) {
        tagged[i].displayHtml = tagged[i].questionOnly;
      } else {
        currentObPassage = tagged[i].passage;
        tagged[i].displayHtml = `<div class="ob-passage" style="${PASSAGE_STYLE}">${tagged[i].passage}</div>` + tagged[i].questionOnly;
      }
    }

    return tagged.map((t, i) => renderQuestion(t.q, i, t.displayHtml)).join('');
  }
  function renderAnswerKey(questions) {
    if (!questions.some((q) => q.options.some((o) => o.isCorrect))) return "";
    let html = `<div class="mb-4" style="break-inside: avoid; page-break-inside: avoid;">
      <h2 class="text-base font-semibold mb-2 uppercase tracking-wider border-b border-gray-400 inline-block">Answer Key</h2>
      <div class="flex flex-wrap gap-1">`;
    questions.forEach((q, idx) => {
      const correctOpt = q.options.find((o) => o.isCorrect);
      if (correctOpt) {
        html += `<div class="answer-key-box" style="color: #000000;">
          <span style="color: #000000; margin-right: 0.25rem;">${idx + 1}:</span>
          <span style="color: #000000; font-weight: 600;">${correctOpt.label || ""}</span>
        </div>`;
      }
    });
    html += `</div></div>`;
    return html;
  }
  function renderSolutions(questions) {
    const withSols = questions.filter((q) => q.solutionHtml);
    if (withSols.length === 0) return "";
    let html = `<div class="mt-4">
      <h2 class="text-base font-semibold mb-4 uppercase tracking-wider border-b border-gray-400 inline-block">Solutions</h2>
      <div style="column-count: 2; column-gap: 6mm; column-rule: 1.5px solid #cbd5e1; width: 100%; orphans: 2; widows: 2;">`;
    withSols.forEach((q, idx) => {
      const globalIdx = questions.indexOf(q);
      html += `<div style="margin-bottom: 0.75rem; color: #000000;">
        <p class="font-semibold mb-1" style="color: #000000;">Sol ${globalIdx + 1}.</p>
        <div class="sol-content ml-1 leading-snug" style="color: #000000;">${cleanTestbookSpecifics(q.solutionHtml)}</div>
      </div>`;
    });
    html += `</div></div>`;
    return html;
  }
  function generateDownloadHtml(questions, sectionTitle, options = {}) {
    const title = sectionTitle || "Questions";
    const includeSolutions = options.includeSolutions !== false;

    const questionsHtml = renderQuestionsDeduped(questions);
    const answerKey = includeSolutions ? renderAnswerKey(questions) : "";
    const solutions = includeSolutions ? renderSolutions(questions) : "";
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="referrer" content="no-referrer" />
    <title>${title} Questions - Section Wise</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
    <script>
      function sanitizeTex(tex) {
        if (!tex) return tex;
        tex = tex.replace(/\\u00A0/g, '');
        tex = tex.replace(/_\\{\\s*\\}/g, '');
        tex = tex.replace(/\\^\\{\\s*\\}/g, '');
        let prev;
        do {
          prev = tex;
          tex = tex.replace(/(_\\{[^}]*\\})_\\{[^}]*\\}/g, '$1');
          tex = tex.replace(/(\\^\\{[^}]*\\})\\^\\{[^}]*\\}/g, '$1');
        } while (tex !== prev);
        return tex.trim();
      }

      function normalizeLatex(tex) {
        if (!tex) return tex;
        return tex
          .replace(/\u00d7/g, '\\\\times ')
          .replace(/\u00f7/g, '\\\\div ')
          .replace(/\u2212/g, '-')
          .replace(/\u2264/g, '\\\\leq ')
          .replace(/\u2265/g, '\\\\geq ')
          .replace(/\u2260/g, '\\\\neq ')
          .replace(/\u2248/g, '\\\\approx ')
          .replace(/\u221e/g, '\\\\infty ')
          .replace(/\u03c0/g, '\\\\pi ')
          .replace(/\u221a/g, '\\\\sqrt')
          .replace(/\u03b1/g, '\\\\alpha ')
          .replace(/\u03b2/g, '\\\\beta ')
          .replace(/\u03b3/g, '\\\\gamma ')
          .replace(/\u03b8/g, '\\\\theta ')
          .replace(/\u2211/g, '\\\\sum ')
          .replace(/\u222b/g, '\\\\int ')
          .replace(/\\\\frac/g, '\\\\dfrac');
      }

      function wrapBareLatex(element) {
        var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
        var node, nodesToProcess = [];
        while (node = walker.nextNode()) {
          var parent = node.parentNode;
          if (parent && (parent.closest('.math-tex') || parent.closest('.katex') || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) continue;
          if (node.textContent.indexOf('\\\\frac{') !== -1 || node.textContent.indexOf('\\\\dfrac{') !== -1 || node.textContent.indexOf('\\\\sqrt{') !== -1 || node.textContent.indexOf('\\\\overline{') !== -1) {
            nodesToProcess.push(node);
          }
        }
        nodesToProcess.forEach(function(textNode) {
          var text = textNode.textContent;
          var pattern = /(\\\\d?frac\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}|\\\\sqrt\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}|\\\\overline\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\})/g;
          var parts = text.split(pattern);
          var matches = text.match(pattern);
          if (!matches || matches.length === 0) return;
          var result = '', mi = 0;
          for (var pi = 0; pi < parts.length; pi++) {
            result += parts[pi];
            if (mi < matches.length) { result += '\\\\(' + matches[mi] + '\\\\)'; mi++; }
          }
          textNode.textContent = result;
        });
      }

      function renderMath() {
        if (!window.katex || typeof renderMathInElement === 'undefined') { setTimeout(renderMath, 200); return; }
        document.querySelectorAll('.math-tex').forEach(function(span) {
            if (span.querySelector('.katex')) return;
            var tex = span.textContent.trim();
            if (!tex) return;
            if (tex.startsWith('$$') && tex.endsWith('$$')) tex = tex.slice(2, -2);
            else if (tex.startsWith('$') && tex.endsWith('$')) tex = tex.slice(1, -1);
            else if (tex.length > 4 && tex.charAt(0) === '\\\\' && tex.charAt(1) === '(' && tex.endsWith('\\\\)')) tex = tex.slice(2, -2);
            
            tex = sanitizeTex(tex);
            tex = normalizeLatex(tex);
            if (!tex) return;
            
            try { katex.render(tex, span, {throwOnError: false, displayMode: false}); } catch(e) {}
        });
        wrapBareLatex(document.body);
        renderMathInElement(document.body, { throwOnError: false, delimiters: [{left: '$$', right: '$$', display: true}, {left: '\\\\[', right: '\\\\]', display: true}, {left: '$', right: '$', display: false}, {left: '\\\\(', right: '\\\\)', display: false}] });
      }
      window.onload = renderMath;
    </script>
    <style>${PRINT_STYLES}</style>
</head>
<body class="p-4 md:p-8">

    <div class="no-print text-center mb-8">
        <button onclick="window.print()" class="bg-blue-600 text-white px-6 py-2 rounded-lg shadow hover:bg-blue-700 transition">
            Download / Print PDF
        </button>
    </div>

    <div class="page-container" style="font-size: 11px;">
        <!-- 2-Column layout with center dividing line -->
        <div style="column-count: 2; column-gap: 6mm; column-rule: 1.5px solid #cbd5e1; width: 100%; orphans: 2; widows: 2;">
            ${questionsHtml}
        </div>

        <div class="divider"></div>

        ${answerKey}
        ${solutions}
    </div>

    <script>
    document.addEventListener('DOMContentLoaded', function() {
      document.querySelectorAll('img').forEach(function(img) {
        let w = img.getAttribute('width');
        let h = img.getAttribute('height');
        if (w && !isNaN(parseInt(w))) img.setAttribute('width', Math.max(1, parseInt(w) - 3));
        if (h && !isNaN(parseInt(h))) img.setAttribute('height', Math.max(1, parseInt(h) - 3));
        
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        if (img.closest('.opt-content')) {
          img.style.maxHeight = '100px';
          img.style.display = 'block';
          img.style.margin = 'auto';
        } else {
          img.style.maxHeight = '150px';
          img.style.display = 'block';
          img.style.margin = '4px auto';
        }
      });
    });
    </script>

</body>
</html>`;
  }
  function generateAllSectionsHtml(sections) {
    let sectionsHtml = "";
    for (const [subject, questions] of Object.entries(sections)) {
      if (questions.length === 0) continue;
      sectionsHtml += `
        <!-- High density 2-column list -->
        <div style="column-count: 2; column-gap: 6mm; column-rule: 1.5px solid #cbd5e1; width: 100%; orphans: 2; widows: 2; margin-bottom: 2rem;">
            ${renderQuestionsDeduped(questions)}
        </div>
        ${questions.some((q) => q.options.some((o) => o.isCorrect)) || questions.some((q) => q.solutionHtml) ? '<div class="divider"></div>' : ''}
        ${renderAnswerKey(questions)}
        ${renderSolutions(questions)}
      `;
    }
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>All Questions - Section Wise</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
    <script>
      function sanitizeTex(tex) {
        if (!tex) return tex;
        tex = tex.replace(/\\u00A0/g, '');
        tex = tex.replace(/_\\{\\s*\\}/g, '');
        tex = tex.replace(/\\^\\{\\s*\\}/g, '');
        let prev;
        do {
          prev = tex;
          tex = tex.replace(/(_\\{[^}]*\\})_\\{[^}]*\\}/g, '$1');
          tex = tex.replace(/(\\^\\{[^}]*\\})\\^\\{[^}]*\\}/g, '$1');
        } while (tex !== prev);
        return tex.trim();
      }

      function normalizeLatex(tex) {
        if (!tex) return tex;
        return tex
          .replace(/\u00d7/g, '\\\\times ')
          .replace(/\u00f7/g, '\\\\div ')
          .replace(/\u2212/g, '-')
          .replace(/\u2264/g, '\\\\leq ')
          .replace(/\u2265/g, '\\\\geq ')
          .replace(/\u2260/g, '\\\\neq ')
          .replace(/\u2248/g, '\\\\approx ')
          .replace(/\u221e/g, '\\\\infty ')
          .replace(/\u03c0/g, '\\\\pi ')
          .replace(/\u221a/g, '\\\\sqrt')
          .replace(/\u03b1/g, '\\\\alpha ')
          .replace(/\u03b2/g, '\\\\beta ')
          .replace(/\u03b3/g, '\\\\gamma ')
          .replace(/\u03b8/g, '\\\\theta ')
          .replace(/\u2211/g, '\\\\sum ')
          .replace(/\u222b/g, '\\\\int ')
          .replace(/\\\\frac/g, '\\\\dfrac');
      }

      function wrapBareLatex(element) {
        var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
        var node, nodesToProcess = [];
        while (node = walker.nextNode()) {
          var parent = node.parentNode;
          if (parent && (parent.closest('.math-tex') || parent.closest('.katex') || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) continue;
          if (node.textContent.indexOf('\\\\frac{') !== -1 || node.textContent.indexOf('\\\\dfrac{') !== -1 || node.textContent.indexOf('\\\\sqrt{') !== -1 || node.textContent.indexOf('\\\\overline{') !== -1) {
            nodesToProcess.push(node);
          }
        }
        nodesToProcess.forEach(function(textNode) {
          var text = textNode.textContent;
          var pattern = /(\\\\d?frac\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}|\\\\sqrt\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}|\\\\overline\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\})/g;
          var parts = text.split(pattern);
          var matches = text.match(pattern);
          if (!matches || matches.length === 0) return;
          var result = '', mi = 0;
          for (var pi = 0; pi < parts.length; pi++) {
            result += parts[pi];
            if (mi < matches.length) { result += '\\\\(' + matches[mi] + '\\\\)'; mi++; }
          }
          textNode.textContent = result;
        });
      }

      function renderMath() {
        if (!window.katex || typeof renderMathInElement === 'undefined') { setTimeout(renderMath, 200); return; }
        document.querySelectorAll('.math-tex').forEach(function(span) {
            if (span.querySelector('.katex')) return;
            var tex = span.textContent.trim();
            if (!tex) return;
            if (tex.startsWith('$$') && tex.endsWith('$$')) tex = tex.slice(2, -2);
            else if (tex.startsWith('$') && tex.endsWith('$')) tex = tex.slice(1, -1);
            else if (tex.length > 4 && tex.charAt(0) === '\\\\' && tex.charAt(1) === '(' && tex.endsWith('\\\\)')) tex = tex.slice(2, -2);

            tex = sanitizeTex(tex);
            tex = normalizeLatex(tex);
            if (!tex) return;

            try { katex.render(tex, span, {throwOnError: false, displayMode: false}); } catch(e) {}
        });
        wrapBareLatex(document.body);
        renderMathInElement(document.body, { throwOnError: false, delimiters: [{left: '$$', right: '$$', display: true}, {left: '\\\\[', right: '\\\\]', display: true}, {left: '$', right: '$', display: false}, {left: '\\\\(', right: '\\\\)', display: false}] });
      }
      window.onload = renderMath;
    </script>
    <style>${PRINT_STYLES}</style>
</head>
<body class="p-4 md:p-8">

    <div class="no-print text-center mb-8">
        <button onclick="window.print()" class="bg-blue-600 text-white px-6 py-2 rounded-lg shadow hover:bg-blue-700 transition">
            Download / Print PDF
        </button>
    </div>

    <div class="page-container" style="font-size: 11px;">
        ${sectionsHtml}
    </div>

</body>
</html>`;
  }
  function generatePptHtml(questions, sectionTitle) {
    const title = sectionTitle || "Questions";
    
    let slidesHtml = '';
    questions.forEach((q, idx) => {
      let optsHtml = '';
      const labels = ['(a)', '(b)', '(c)', '(d)', '(e)', '(f)'];
      if (q.options && q.options.length > 0) {
        optsHtml = `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 50px; font-size: 32px; font-weight: bold; width: 100%;">
          ${q.options.map((opt, i) => `
            <div class="option-row" style="display: flex; align-items: flex-start; gap: 15px;">
              <span style="font-weight: bold; min-width: 50px;">${labels[i] || ''}</span>
              <div class="option-content" style="flex: 1;">${cleanTestbookSpecifics(opt.html || '')}</div>
            </div>
          `).join('')}
        </div>`;
      }
      
      let questionHtml = q.questionHtml || '';
      
      slidesHtml += `
        <div class="slide">
          <div class="left-pane"></div>
          <div class="right-pane">
            <div class="question-row" style="display: flex; gap: 20px; font-size: 36px; font-weight: bold; margin-bottom: 20px; align-items: flex-start;">
              <span>${idx + 1}.</span>
              <div class="question-content" style="flex: 1; line-height: 1.5;">${cleanTestbookSpecifics(questionHtml)}</div>
            </div>
            ${optsHtml}
          </div>
        </div>
      `;
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=1920, initial-scale=1.0">
    <title>${title} - PPT</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
    <script>
      function sanitizeTex(tex) {
        if (!tex) return tex;
        tex = tex.replace(/\\u00A0/g, '');
        tex = tex.replace(/_\\{\\s*\\}/g, '');
        tex = tex.replace(/\\^\\{\\s*\\}/g, '');
        let prev;
        do {
          prev = tex;
          tex = tex.replace(/(_\\{[^}]*\\})_\\{[^}]*\\}/g, '$1');
          tex = tex.replace(/(\\^\\{[^}]*\\})\\^\\{[^}]*\\}/g, '$1');
        } while (tex !== prev);
        return tex.trim();
      }
      function normalizeLatex(tex) {
        if (!tex) return tex;
        return tex
          .replace(/\u00d7/g, '\\\\times ')
          .replace(/\u00f7/g, '\\\\div ')
          .replace(/\u2212/g, '-')
          .replace(/\u2264/g, '\\\\leq ')
          .replace(/\u2265/g, '\\\\geq ')
          .replace(/\u2260/g, '\\\\neq ')
          .replace(/\u2248/g, '\\\\approx ')
          .replace(/\u221e/g, '\\\\infty ')
          .replace(/\u03c0/g, '\\\\pi ')
          .replace(/\u221a/g, '\\\\sqrt')
          .replace(/\\\\frac/g, '\\\\dfrac');
      }
      function wrapBareLatex(element) {
        var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
        var node, nodesToProcess = [];
        while (node = walker.nextNode()) {
          var parent = node.parentNode;
          if (parent && (parent.closest('.math-tex') || parent.closest('.katex') || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) continue;
          if (node.textContent.indexOf('\\\\frac{') !== -1 || node.textContent.indexOf('\\\\dfrac{') !== -1 || node.textContent.indexOf('\\\\sqrt{') !== -1 || node.textContent.indexOf('\\\\overline{') !== -1) {
            nodesToProcess.push(node);
          }
        }
        nodesToProcess.forEach(function(textNode) {
          var text = textNode.textContent;
          var pattern = /(\\\\d?frac\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}|\\\\sqrt\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}|\\\\overline\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\})/g;
          var parts = text.split(pattern);
          var matches = text.match(pattern);
          if (!matches || matches.length === 0) return;
          var result = '', mi = 0;
          for (var pi = 0; pi < parts.length; pi++) {
            result += parts[pi];
            if (mi < matches.length) { result += '\\\\(' + matches[mi] + '\\\\)'; mi++; }
          }
          textNode.textContent = result;
        });
      }
      function renderMath() {
        if (!window.katex || typeof renderMathInElement === 'undefined') { setTimeout(renderMath, 200); return; }
        document.querySelectorAll('.math-tex').forEach(function(span) {
            if (span.querySelector('.katex')) return;
            var tex = span.textContent.trim();
            if (!tex) return;
            if (tex.startsWith('$$') && tex.endsWith('$$')) tex = tex.slice(2, -2);
            else if (tex.startsWith('$') && tex.endsWith('$')) tex = tex.slice(1, -1);
            else if (tex.length > 4 && tex.charAt(0) === '\\\\' && tex.charAt(1) === '(' && tex.endsWith('\\\\)')) tex = tex.slice(2, -2);
            tex = sanitizeTex(tex);
            tex = normalizeLatex(tex);
            if (!tex) return;
            try { katex.render(tex, span, {throwOnError: false, displayMode: false}); } catch(e) {}
        });
        wrapBareLatex(document.body);
        renderMathInElement(document.body, { throwOnError: false, delimiters: [{left: '$$', right: '$$', display: true}, {left: '\\\\[', right: '\\\\]', display: true}, {left: '$', right: '$', display: false}, {left: '\\\\(', right: '\\\\)', display: false}] });
      }
      window.onload = renderMath;
    </script>
    <style>
      @page {
        size: 1920px 1080px;
        margin: 0;
      }
      body {
        margin: 0;
        padding: 0;
        background: #f0f0f0;
        font-family: Arial, sans-serif;
      }
      .slide {
        width: 1920px;
        height: 1080px;
        background: white;
        display: flex;
        box-sizing: border-box;
        page-break-after: always;
        overflow: hidden;
      }
      .left-pane {
        width: 50%;
        height: 100%;
        box-sizing: border-box;
      }
      .right-pane {
        width: 50%;
        height: 100%;
        padding: 60px 80px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
      }
      img {
        max-width: 100%;
        height: auto;
        object-fit: contain;
        zoom: 1.35;
        margin-top: 10px;
        margin-bottom: 10px;
      }
      .katex { font-size: 1.1em; }
      
      /* Fix alignment for numbers and content */
      .question-content p, .option-content p {
        margin-top: 0;
        margin-bottom: 0.4em;
      }
      .question-content p:last-child, .option-content p:last-child {
        margin-bottom: 0;
      }
      
      /* Table styling */
      table {
        border-collapse: collapse;
        margin: 20px 0;
        font-size: 0.95em;
        width: 100%;
        max-width: 800px;
      }
      table, th, td {
        border: 2px solid #000;
      }
      th, td {
        padding: 12px 20px;
        text-align: center;
        min-width: 80px;
      }
      
      @media print {
        body { background: white; }
        .slide { page-break-after: always; }
      }
    </style>
</head>
<body>
    ${slidesHtml}
</body>
</html>`;
  }
  return __toCommonJS(parseQuestions_exports);
})();
