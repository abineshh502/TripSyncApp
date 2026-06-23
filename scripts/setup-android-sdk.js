const fs = require('fs');
const path = require('path');

const localPropertiesPath = path.join(__dirname, '../android/local.properties');

const possiblePaths = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  path.join(process.env.USERPROFILE || '', 'AppData/Local/Android/Sdk'),
  path.join(process.env.HOME || '', 'Library/Android/sdk'),
  path.join(process.env.HOME || '', 'Android/Sdk'),
  'C:/Users/konda/AppData/Local/Android/Sdk',
  'C:/Android/Sdk',
  '/usr/lib/android-sdk',
  '/Library/Android/sdk'
].filter(Boolean);

let foundPath = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    foundPath = p;
    break;
  }
}

if (foundPath) {
  const formattedPath = foundPath.replace(/\\/g, '/');
  fs.writeFileSync(localPropertiesPath, `sdk.dir=${formattedPath}\n`, 'utf8');
  console.log(`✓ Configured Android SDK location in local.properties: ${formattedPath}`);
} else {
  console.warn('⚠️ Warning: Android SDK location could not be auto-detected.');
}
