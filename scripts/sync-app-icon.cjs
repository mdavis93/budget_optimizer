const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'public', 'icon_budget.svg');
const iconSize = 1024;

const svg = fs.readFileSync(svgPath, 'utf8');
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: iconSize },
});
const png = resvg.render().asPng();

const outputs = [
  path.join(root, 'build', 'icon.png'),
  path.join(root, 'public', 'icon.png'),
];

for (const outputPath of outputs) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, png);
}

console.log(`Synced app icon from ${path.relative(root, svgPath)} (${iconSize}px PNG)`);
