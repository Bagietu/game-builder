import * as esbuild from "esbuild";
import { cpSync, rmSync } from "node:fs";

const serve = process.argv.includes("--serve");

rmSync("dist", { recursive: true, force: true });
cpSync("public", "dist", { recursive: true });

const options = {
  entryPoints: ["src/main.js"],
  outfile: "dist/app.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: !serve,
  sourcemap: serve,
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
