const text = "[25% of (50% of 30% of 150)]/[40% of 2250] = ?";
const match = text.match(/^\s*(?:Q\.?\s*)?\d+[\s]*[\.\)\:\-\#\/]+\s*/);
console.log("Match:", match);
