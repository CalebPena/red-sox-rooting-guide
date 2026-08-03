import sharp from "sharp";

const source = "public/favicon.svg";
const icons = [
  ["public/apple-touch-icon.png", 180],
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["public/icon-maskable-512.png", 512],
];

await Promise.all(
  icons.map(([output, size]) =>
    sharp(source).resize(size, size).png().toFile(output),
  ),
);
