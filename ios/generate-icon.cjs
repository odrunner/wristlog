const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

// Register Arial Bold for a proper W
registerFont('/System/Library/Fonts/Supplemental/Arial Bold.ttf', { family: 'ArialB', weight: 'bold' });

const SIZE = 1024;
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');

// Background gradient (dark)
const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
grad.addColorStop(0, '#1a1a1e');
grad.addColorStop(1, '#0d0d0f');

// Draw rounded rect background
const radius = 224;
ctx.beginPath();
ctx.moveTo(radius, 0);
ctx.lineTo(SIZE - radius, 0);
ctx.quadraticCurveTo(SIZE, 0, SIZE, radius);
ctx.lineTo(SIZE, SIZE - radius);
ctx.quadraticCurveTo(SIZE, SIZE, SIZE - radius, SIZE);
ctx.lineTo(radius, SIZE);
ctx.quadraticCurveTo(0, SIZE, 0, SIZE - radius);
ctx.lineTo(0, radius);
ctx.quadraticCurveTo(0, 0, radius, 0);
ctx.closePath();
ctx.fillStyle = grad;
ctx.fill();

const gold = '#C8A55A';

// ── Rotation arrow (open arc, matching app logo) ──
const cx = 512;
const cy = 370;
const r = 160;

ctx.save();
ctx.strokeStyle = gold;
ctx.lineWidth = 26;
ctx.lineCap = 'round';

// Open arc with gap at top
const gapHalfAngle = 0.48;
const arcStart = -Math.PI / 2 + gapHalfAngle;
const arcEnd = -Math.PI / 2 - gapHalfAngle + 2 * Math.PI;

ctx.beginPath();
ctx.arc(cx, cy, r, arcStart, arcEnd, false);
ctx.stroke();

// Arrowhead at the END of the arc (top-left area)
const tipAngle = arcEnd;
const tipX = cx + r * Math.cos(tipAngle);
const tipY = cy + r * Math.sin(tipAngle);
const tangentAngle = tipAngle + Math.PI / 2;

ctx.fillStyle = gold;
ctx.beginPath();
const aLen = 46;
const aWidth = 26;

const ax = tipX + aLen * 0.5 * Math.cos(tangentAngle);
const ay = tipY + aLen * 0.5 * Math.sin(tangentAngle);
const bx1 = tipX - aLen * 0.5 * Math.cos(tangentAngle) + aWidth * Math.cos(tangentAngle + Math.PI/2);
const by1 = tipY - aLen * 0.5 * Math.sin(tangentAngle) + aWidth * Math.sin(tangentAngle + Math.PI/2);
const bx2 = tipX - aLen * 0.5 * Math.cos(tangentAngle) - aWidth * Math.cos(tangentAngle + Math.PI/2);
const by2 = tipY - aLen * 0.5 * Math.sin(tangentAngle) - aWidth * Math.sin(tangentAngle + Math.PI/2);

ctx.moveTo(ax, ay);
ctx.lineTo(bx1, by1);
ctx.lineTo(bx2, by2);
ctx.closePath();
ctx.fill();

// Center dot
ctx.beginPath();
ctx.arc(cx, cy, 32, 0, Math.PI * 2);
ctx.fillStyle = gold;
ctx.fill();
ctx.restore();

// ── "W" — proper font rendering ──
ctx.fillStyle = gold;
ctx.font = 'bold 300px ArialB';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('W', 512, 720);

// Save as PNG
const buffer = canvas.toBuffer('image/png');
const outPath = path.join(__dirname, 'AppIcon-1024.png');
fs.writeFileSync(outPath, buffer);
console.log('Icon saved to', outPath);
