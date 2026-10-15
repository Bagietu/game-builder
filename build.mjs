import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const serve = process.argv.includes("--serve");
// CI sets APP_VERSION (1.<commit count>); local builds are "dev".
const version = process.env.APP_VERSION || "dev";
const builtAt = new Date().toISOString();

rmSync("dist", { recursive: true, force: true });
cpSync("public", "dist", { recursive: true });
mkdirSync("dist/vendor", { recursive: true });
cpSync("node_modules/phaser/dist/phaser.min.js", "dist/vendor/phaser.min.js");
writeFileSync("dist/version.json", JSON.stringify({ version, builtAt }));
buildPublishedGames();

// Each games/<slug>/game.html becomes an installable page at games/<slug>/.
// The game runs in a sandboxed iframe so it can't read this site's storage.
function buildPublishedGames() {
  if (!existsSync("games")) return;
  for (const slug of readdirSync("games")) {
    const src = `games/${slug}/game.html`;
    if (!existsSync(src)) continue;
    const html = readFileSync(src, "utf8");
    const title = (html.match(/<title>([^<]*)<\/title>/i)?.[1] || slug).trim();
    const out = `dist/games/${slug}`;
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/game.html`, html);
    writeFileSync(
      `${out}/manifest.webmanifest`,
      JSON.stringify({
        name: title,
        short_name: title.slice(0, 24),
        start_url: "./",
        scope: "./",
        display: "fullscreen",
        background_color: "#000000",
        theme_color: "#000000",
        icons: [
          { src: "../../icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "../../icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      }),
    );
    writeFileSync(`${out}/index.html`, gamePage(title));
  }
}

function gamePage(title) {
  const safe = title.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#000000">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>${safe}</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="../../icon-192.png">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{border:0;width:100%;height:100dvh;display:block}</style>
</head>
<body>
<iframe src="game.html" sandbox="allow-scripts" title="${safe}"></iframe>
</body>
</html>
`;
}

const options = {
  entryPoints: ["src/main.js"],
  outfile: "dist/app.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: !serve,
  sourcemap: serve,
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILT_AT__: JSON.stringify(builtAt),
  },
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: "dist", port: 8000 });
  console.log(`Game Builder running at http://localhost:${port}`);
} else {
  await esbuild.build(options);
  console.log("Built to dist/");
}
