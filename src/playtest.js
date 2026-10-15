// Running games: swap in the app's own copy of Phaser, and robot-playtest a game for errors.
import { PHASER_URL, PHASER_TAG } from "./generate.js";

let phaserSource = null;

/**
 * The game ready to run: Phaser inlined (so it works offline, from a saved file or as an installed
 * app) and its Gemini art, if any, provided as window.GAME_ASSETS.
 */
export async function withPhaser(html, assets) {
  if (assets && Object.keys(assets).length) {
    const urls = Object.fromEntries(Object.entries(assets).map(([k, a]) => [k, a.url]));
    const script = `<script>window.GAME_ASSETS=${JSON.stringify(urls)};</script>`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + script) : script + html;
  }
  if (!html.includes(PHASER_URL)) return html;
  if (!phaserSource) {
    // Same file, served from this app (and cached by the service worker).
    const res = await fetch(new URL("vendor/phaser.min.js", document.baseURI));
    if (!res.ok) throw new Error("Couldn't load the game engine. Check your connection and try again.");
    phaserSource = (await res.text()).replace(/<\/script/gi, "<\\/script");
  }
  const inline = `<script>${phaserSource}</script>`;
  return html.includes(PHASER_TAG) ? html.split(PHASER_TAG).join(inline) : html.replace(
    new RegExp(`<script[^>]*src=["']${PHASER_URL.replace(/[.]/g, "\\.")}["'][^>]*>\\s*</script>`, "gi"),
    inline,
  );
}

// Injected first into the game under test: reports errors and pokes at the game like a player.
const PROBE = `<script>(function(){
var send=function(m){try{parent.postMessage({gbPlaytest:String(m).slice(0,400)},"*")}catch(e){}};
addEventListener("error",function(e){send((e.message||"Error")+(e.lineno?" (line "+e.lineno+")":""))});
addEventListener("unhandledrejection",function(e){var r=e.reason;send("Unhandled promise rejection: "+(r&&r.message||r))});
var ce=console.error;console.error=function(){send("console.error: "+Array.prototype.join.call(arguments," "));return ce.apply(console,arguments)};
addEventListener("load",function(){
  var n=0,keys=[" ","ArrowRight","ArrowLeft","ArrowUp","Enter","ArrowDown"];
  var tap=function(x,y){var el=document.elementFromPoint(x,y)||document.body;
    var o={bubbles:true,cancelable:true,clientX:x,clientY:y,pointerId:1,pointerType:"touch",isPrimary:true,button:0};
    ["pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(t){el.dispatchEvent(t.indexOf("pointer")==0?new PointerEvent(t,o):new MouseEvent(t,o))})};
  var key=function(k){["keydown","keyup"].forEach(function(t){var o={key:k,code:k==" "?"Space":k,bubbles:true};window.dispatchEvent(new KeyboardEvent(t,o));document.dispatchEvent(new KeyboardEvent(t,o))})};
  var iv=setInterval(function(){n++;var W=innerWidth,H=innerHeight;tap(W/2,H/2);tap(W*(0.2+Math.random()*0.6),H*(0.3+Math.random()*0.6));key(keys[n%keys.length]);if(n>25)clearInterval(iv)},350);
});
})();</script>`;

const IGNORED = [/^Script error\.?$/i, /ResizeObserver loop/i, /AudioContext/i, /play\(\) request/i];

/**
 * Run the game in `frame` for a few seconds while a robot taps and presses keys.
 * Resolves with the distinct errors it hit (empty when the game ran cleanly).
 */
export async function playtest(html, frame, { seconds = 9, signal, assets } = {}) {
  const ready = await withPhaser(html, assets);
  const probed = /<head[^>]*>/i.test(ready) ? ready.replace(/<head[^>]*>/i, (m) => m + PROBE) : PROBE + ready;
  const errors = new Set();
  const onMessage = (e) => {
    if (e.source !== frame.contentWindow || typeof e.data?.gbPlaytest !== "string") return;
    const msg = e.data.gbPlaytest;
    if (!IGNORED.some((re) => re.test(msg)) && errors.size < 12) errors.add(msg);
  };
  window.addEventListener("message", onMessage);
  try {
    frame.srcdoc = probed;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, seconds * 1000);
      signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
    });
  } finally {
    window.removeEventListener("message", onMessage);
    frame.srcdoc = "";
  }
  return [...errors];
}
