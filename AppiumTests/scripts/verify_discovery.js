"use strict";
const fs = require("fs");
const path = require("path");

const dir = path.resolve(__dirname, "../tests");
const files = fs.readdirSync(dir).filter(f => f.endsWith(".test.js"));

let totalIt = 0;
let totalDiscovered = 0;
let issues = [];

files.forEach(f => {
  const filePath = path.join(dir, f);
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // Count raw it( calls
  const rawItCalls = content.match(/^\s*it\(/gm) || [];
  totalIt += rawItCalls.length;

  // Simulate discoverTests logic
  let currentSuite = "Unknown Suite";
  let inCommentBlock = false;
  let discovered = 0;

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("/*")) inCommentBlock = true;
    if (inCommentBlock) {
      if (trimmed.endsWith("*/") || trimmed.includes("*/")) inCommentBlock = false;
      return;
    }
    if (trimmed.startsWith("//")) return;

    const descMatch = trimmed.match(/describe\s*\(\s*["'`](.*?)["'`]/);
    if (descMatch) currentSuite = descMatch[1];

    const itMatch = trimmed.match(/it\s*\(\s*["'`](.*?)["'`]/);
    if (itMatch) discovered++;
    else if (trimmed.startsWith("it(") || trimmed.startsWith("it (")) {
      issues.push(`${f}:${idx+1} — it() NOT matched by discoverTests regex: ${trimmed.substring(0,80)}`);
    }
  });

  totalDiscovered += discovered;
  console.log(`${f}: raw=${rawItCalls.length} discovered=${discovered} ${rawItCalls.length !== discovered ? "MISMATCH!" : "OK"}`);
});

console.log(`\nTotal raw it() calls : ${totalIt}`);
console.log(`Total discovered     : ${totalDiscovered}`);
console.log(`Match                : ${totalIt === totalDiscovered ? "YES" : "NO — MISMATCH"}`);

if (issues.length) {
  console.log("\nUnmatched it() calls:");
  issues.forEach(i => console.log(" ", i));
} else {
  console.log("\nNo unmatched it() calls.");
}

// Check for duplicate test names within a file (would cause reconciliation collision)
console.log("\n--- Duplicate test name check ---");
files.forEach(f => {
  const filePath = path.join(dir, f);
  const content = fs.readFileSync(filePath, "utf-8");
  const matches = [...content.matchAll(/it\s*\(\s*["'`](.*?)["'`]/g)].map(m => m[1]);
  const seen = new Set();
  matches.forEach(name => {
    if (seen.has(name)) console.log(`DUPLICATE in ${f}: "${name}"`);
    seen.add(name);
  });
});
console.log("Duplicate check complete.");
