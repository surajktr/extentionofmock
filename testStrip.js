const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const dom = new JSDOM(`<!DOCTYPE html><div></div>`);
global.document = dom.window.document;
global.NodeFilter = dom.window.NodeFilter;
global.Node = dom.window.Node;

const OMITTED_HTML = '<div class="omitted">[Passage omitted — see Q%REF%]</div>';

function stripPassageFromHtml(html, passageWords, refNum) {
  const div = document.createElement('div');
  div.innerHTML = html;
  const fullWords = (div.textContent || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length > 1);
  let passageStartWordIdx = -1;
  outer: for (let i = 0; i <= fullWords.length - passageWords.length; i++) {
    for (let j = 0; j < passageWords.length; j++) {
      if (fullWords[i + j] !== passageWords[j]) continue outer;
    }
    passageStartWordIdx = i;
    break;
  }
  if (passageStartWordIdx === -1) return html;
  
  const wordsBefore = fullWords.slice(0, passageStartWordIdx);
  if (wordsBefore.length > 0 && wordsBefore.length < 25) {
    const preambleWords = new Set(['read', 'passage', 'direction', 'directions', 'following', 'comprehension', 'answer', 'questions', 'given', 'carefully', 'below']);
    if (wordsBefore.some(w => preambleWords.has(w))) {
      passageStartWordIdx = 0;
    }
  }

  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT, null, false);
  let wordCount = 0, startNode = null, startOffset = 0, endNode = null, endOffset = 0, node;
  const passageEndWordIdx = passageStartWordIdx + passageWords.length + (passageStartWordIdx === 0 ? wordsBefore.length : 0);
  
  // Wait, if passageStartWordIdx becomes 0, passageEndWordIdx should be 0 + original wordsBefore.length + passageWords.length!
  // Let's refine passageEndWordIdx definition.

  return div.innerHTML;
}
