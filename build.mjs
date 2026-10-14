import * as esbuild from "esbuild";
import { cpSync, rmSync, writeFileSync } from "node:fs";

const serve = process.argv.includes("--serve");
// CI sets APP_VERSION (1.<commit count>); local builds are "dev".
const version = process.env.APP_VERSION || "dev";
const builtAt = new Date().toISOString();

rmSync("dist", { recursive: true, force: true });
cpSync("public", "dist", { recursive: true });
writeFileSync("dist/version.json", JSON.stringify({ version, builtAt }));

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
