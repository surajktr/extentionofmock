const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { CHTML } = require('mathjax-full/js/output/chtml.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX();
const chtml = new CHTML();
const html = mathjax.document('', { InputJax: tex, OutputJax: chtml });

const node = html.convert('\\sqrt[3]{x}', { display: false });
console.log(adaptor.outerHTML(node));
