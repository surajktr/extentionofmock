const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><head><script>window.MathJax = {tex: {inlineMath: [["$", "$"]]}};</script><script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script></head><body>$\\left( \\frac{1}{2} \\right)$</body></html>');
  await page.waitForFunction('window.MathJax && window.MathJax.typesetPromise');
  await page.evaluate(async () => {
    await window.MathJax.typesetPromise();
  });
  const html = await page.evaluate(() => document.body.innerHTML);
  console.log(html);
  await browser.close();
})();
