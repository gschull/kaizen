const fs = require('fs');
const { execSync } = require('child_process');

// Check if sharp is available, if not we'll use a different approach
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.log('Sharp not installed, installing...');
  execSync('npm install sharp', { stdio: 'inherit' });
  sharp = require('sharp');
}

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const svgPath = './public/icons/icon.svg';
const outputDir = './public/icons';

async function generateIcons() {
  const svgBuffer = fs.readFileSync(svgPath);
  
  for (const size of sizes) {
    const outputPath = `${outputDir}/icon-${size}.png`;
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`Generated: ${outputPath}`);
  }
  
  console.log('All icons generated!');
}

generateIcons().catch(console.error);
