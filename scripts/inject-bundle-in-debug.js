const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../android/app/build.gradle');

if (!fs.existsSync(file)) {
  console.log('⚠️ android/app/build.gradle does not exist yet (prebuild might have skipped or failed)');
  process.exit(0);
}

let content = fs.readFileSync(file, 'utf8');
let modified = false;

// Remove legacy bundleInDebug if present
if (content.includes('bundleInDebug = true')) {
  content = content.replace(/\s*bundleInDebug\s*=\s*true/, '');
  modified = true;
}

// Inject debuggableVariants = [] if not present
if (content.includes('bundleCommand =') && !content.includes('debuggableVariants = []')) {
  content = content.replace('bundleCommand = "export:embed"', 'bundleCommand = "export:embed"\n    debuggableVariants = []');
  modified = true;
}

if (modified) {
  fs.writeFileSync(file, content, 'utf8');
  console.log('✓ Successfully configured build.gradle with debuggableVariants = []');
} else {
  console.log('⚠️ No modifications needed or build.gradle is already configured.');
}

