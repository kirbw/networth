import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const buildDir = path.join(root, "build");
const buildCssDir = path.join(buildDir, "css");
const buildJsDir = path.join(buildDir, "js");

await mkdir(buildCssDir, { recursive: true });
await mkdir(buildJsDir, { recursive: true });

const cssFiles = [
  path.join(root, "assets/css/legacy.css"),
  path.join(root, "assets/css/app.css"),
];

const cssParts = await Promise.all(cssFiles.map((file) => readFile(file, "utf8")));
await writeFile(path.join(buildCssDir, "app.css"), cssParts.join("\n\n"), "utf8");

const jsFiles = [
  "charts.js",
  "legacy-app.js",
  "main.js",
  "page-meta.js",
  "shell.js",
  "theme.js",
];

await Promise.all(jsFiles.map((file) => copyFile(path.join(root, "assets/js", file), path.join(buildJsDir, file))));

await writeFile(
  path.join(buildDir, "manifest.json"),
  JSON.stringify({
    css: ["/build/css/app.css"],
    js: jsFiles.map((file) => `/build/js/${file}`),
    builtAt: new Date().toISOString(),
  }, null, 2),
  "utf8",
);
