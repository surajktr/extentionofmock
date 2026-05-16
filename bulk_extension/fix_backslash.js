const fs = require('fs');

// Fix content.js - line 74: replace \\\\( with \\(
let content = fs.readFileSync('content.js', 'utf8');
// The file has 4 backslashes before ( : \\\\(  -> need 2 backslashes: \\(
content = content.replace(
  "createTextNode('\\\\\\\\(' + latex + '\\\\\\\\)')",
  "createTextNode('\\\\(' + latex + '\\\\)')"
);
fs.writeFileSync('content.js', content);
console.log('Fixed content.js');

// Verify
const line74 = fs.readFileSync('content.js', 'utf8').split('\n')[73];
console.log('content.js line 74:', JSON.stringify(line74));

// Fix parser.js - line 79: replace \\\\( with \\(
let parser = fs.readFileSync('parser.js', 'utf8');
parser = parser.replace(
  'cleanSpan.textContent = "\\\\\\\\(" + latex + "\\\\\\\\)"',
  'cleanSpan.textContent = "\\\\(" + latex + "\\\\)"'
);
fs.writeFileSync('parser.js', parser);
console.log('Fixed parser.js');

const line79 = fs.readFileSync('parser.js', 'utf8').split('\n')[78];
console.log('parser.js line 79:', JSON.stringify(line79));
