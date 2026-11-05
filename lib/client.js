// dsh-local-sd — browser half (client plugin bundle).
//
// Loaded by dsh-client-modules at /plugins/dsh-local-sd/client.js and executed
// through the vendored cordis Loader's lazy-CJS module table
// (window.__ModuleLoader__.load). The factory body is plain CJS with require()
// resolved against the shell's module table. The `id` below MUST equal the
// package name, or the shell reports "loaded without registering".
//
// This bundle carries one thing: 设置 → 本地绘图 (a `settings.section` page).
// It exists because the whole point of the plugin is "install it and it works",
// and that means the Forge directory must be pickable with a button instead of
// hand-editing $DSH_HOME/local-sd.json.
//
// All state lives in the host half. The page is a thin form over
// POST /local-sd/api — { method: "get" | "save" | "detect" | "browse" |
// "start" | "stop" } — so the JSON file stays the single source of truth and a
// hand edit still takes effect.

window.__ModuleLoader__.load({
	id: "dsh-local-sd",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");
		var h = React.createElement;

		exports.inject = ["slots"];
		exports.apply = function apply(ctx) {
			var API_URL = "/local-sd/api";
			// Text used to locate the settings-nav cell when painting the plugin
			// glyph: the shell's navIcon map is keyed by section id and offers no
			// icon field to register.
			var NAV_LABEL = "本地绘图";

			/* ── stylesheet ─────────────────────────────────────────────── */
			ctx.effect(function() {
				var style = document.createElement("style");
				style.textContent = `
.lsd-root{display:flex;flex-direction:column;gap:16px;padding:4px 2px 28px;font-size:13px;color:var(--dsw-alias-label-primary,inherit)}
/* The settings page is itself a scrolling column: sections keep their natural
   height, and the page scrolls, rather than every block being compressed. */
.lsd-root > *{flex:none}
.lsd-head{display:flex;flex-direction:column;gap:5px}
.lsd-title{margin:0;font-size:16px;font-weight:600}
.lsd-desc{margin:0;font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.9))}
.lsd-card{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));border-radius:12px;padding:14px 16px;background:rgba(128,128,128,.06);display:flex;flex-direction:column;gap:12px}
/* A card is a column flexbox inside the settings scroll area: let it keep its
   content height instead of being squeezed when the page runs out of room. */
.lsd-card > *{flex:none}
.lsd-card-head{display:flex;align-items:center;gap:9px}
.lsd-dot{width:8px;height:8px;border-radius:50%;background:rgba(128,128,128,.6);flex:none}
.lsd-dot.on{background:var(--dsw-alias-state-success-primary,#2ea043)}
.lsd-dot.warn{background:var(--dsw-alias-state-warning-primary,#d29922)}
.lsd-card-title{font-size:14px;font-weight:600}
.lsd-field{display:flex;flex-direction:column;gap:6px}
.lsd-label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary,inherit)}
.lsd-hint{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.9))}
.lsd-row{display:flex;gap:8px;align-items:center}
.lsd-input{flex:1;min-width:0;box-sizing:border-box;padding:7px 10px;font-size:12px;font-family:inherit;
  color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-base,transparent);
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.32));border-radius:8px;outline:none}
.lsd-input:focus{border-color:var(--dsw-alias-brand-primary,#4a9eff)}
.lsd-input.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.lsd-btn{flex:none;padding:7px 13px;font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap;
  color:var(--dsw-alias-label-primary,inherit);background:rgba(128,128,128,.14);
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.32));border-radius:8px}
.lsd-btn:hover:not(:disabled){background:rgba(128,128,128,.24)}
.lsd-btn:disabled{opacity:.5;cursor:default}
.lsd-btn.primary{color:#fff;background:var(--dsw-alias-brand-primary,#4a9eff);border-color:transparent}
.lsd-btn.primary:hover:not(:disabled){filter:brightness(1.08)}
.lsd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px}
.lsd-stat{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));border-radius:10px;
  padding:9px 12px;background:var(--dsw-alias-bg-base,transparent);display:flex;flex-direction:column;gap:2px;min-width:0}
.lsd-stat-k{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.9))}
.lsd-stat-v{font-size:12px;font-weight:500;word-break:break-all}
.lsd-toggle{display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;user-select:none}
.lsd-toggle input{width:15px;height:15px;cursor:pointer;accent-color:var(--dsw-alias-brand-primary,#4a9eff)}
.lsd-msg{font-size:12px;line-height:1.6;padding:8px 11px;border-radius:8px;white-space:pre-wrap;word-break:break-word}
.lsd-msg.ok{color:var(--dsw-alias-state-success-primary,#2ea043);background:rgba(46,160,67,.1)}
.lsd-msg.err{color:var(--dsw-alias-state-error-primary,#f85149);background:rgba(248,81,73,.1)}
.lsd-msg.info{color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));background:rgba(128,128,128,.1)}
.lsd-found{display:flex;flex-direction:column;gap:6px;max-height:200px;overflow:auto}
/* Same trap as the browser list: a scrolling column flexbox shrinks its rows
   to nothing once they overflow. Keep every row at its natural height. */
.lsd-found > *{flex:none}
.lsd-found-item{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:7px 10px;
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));border-radius:8px;font-size:11px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.lsd-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding-top:2px}
.lsd-footer{font-size:11px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.75));word-break:break-all}
/* ── in-page directory browser ──────────────────────────────────────── */
.lsd-browser{display:flex;flex-direction:column;gap:9px;padding:11px;border-radius:10px;flex:none;
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));background:rgba(128,128,128,.07)}
.lsd-browser-head{display:flex;gap:7px;align-items:center}
.lsd-browser-path{flex:1;min-width:0}
.lsd-drives{display:flex;gap:5px;flex-wrap:wrap}
.lsd-drive{flex:none;padding:3px 9px;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  cursor:pointer;color:var(--dsw-alias-label-primary,inherit);background:rgba(128,128,128,.14);
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.3));border-radius:6px}
.lsd-drive:hover:not(:disabled){background:rgba(128,128,128,.26)}
.lsd-drive:disabled{opacity:.5;cursor:default}
.lsd-browser-list{display:flex;flex-direction:column;gap:2px;max-height:230px;overflow:auto;
  border-radius:8px;background:var(--dsw-alias-bg-base,rgba(0,0,0,.1));padding:4px}
/* The list is a column flexbox with a max-height: without flex:none every row
   shrinks to a sliver once the entries overflow, and all the labels stack on
   top of each other. Rows must keep their intrinsic height and let the list
   scroll instead. */
.lsd-browser-list > *{flex:none}
.lsd-entry{text-align:left;padding:5px 9px;font-size:12px;font-family:inherit;cursor:pointer;
  color:var(--dsw-alias-label-primary,inherit);background:transparent;border:none;border-radius:5px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lsd-entry:hover:not(:disabled){background:rgba(128,128,128,.22)}
.lsd-entry:disabled{opacity:.5;cursor:default}
.lsd-browser-foot{display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.lsd-browser-foot .lsd-actions{padding-top:0}
/* ── startup progress + live log ────────────────────────────────────── */
.lsd-prog{display:flex;flex-direction:column;gap:7px;padding:11px 13px;border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.26));background:var(--dsw-alias-bg-base,rgba(128,128,128,.05))}
.lsd-prog-head{display:flex;align-items:center;gap:8px;font-size:12px}
.lsd-prog-phase{flex:1;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lsd-prog-pct{flex:none;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95))}
.lsd-bar{position:relative;height:7px;border-radius:4px;overflow:hidden;background:rgba(128,128,128,.22)}
.lsd-bar-fill{position:absolute;inset:0 auto 0 0;border-radius:4px;
  background:var(--dsw-alias-brand-primary,#4a9eff);transition:width .45s ease}
.lsd-bar-fill.ok{background:var(--dsw-alias-state-success-primary,#2ea043)}
.lsd-bar-fill.err{background:var(--dsw-alias-state-error-primary,#f85149)}
/* Indeterminate: the launcher is alive but has not printed anything yet. */
.lsd-bar-fill.indet{width:35% !important;animation:lsd-slide 1.3s ease-in-out infinite}
@keyframes lsd-slide{0%{left:-35%}100%{left:100%}}
.lsd-log{margin:0;padding:9px 11px;border-radius:8px;max-height:260px;overflow:auto;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.55;
  white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-base,rgba(0,0,0,.18));
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));
  color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95))}
.lsd-log .err{color:var(--dsw-alias-state-error-primary,#f85149)}
.lsd-log .info{color:var(--dsw-alias-brand-primary,#4a9eff)}
.lsd-log-empty{font-size:11px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.8))}
/* ── hardware readout ───────────────────────────────────────────────── */
.lsd-hw{display:flex;flex-direction:column;gap:5px;padding:10px 12px;border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));background:var(--dsw-alias-bg-base,rgba(128,128,128,.05))}
.lsd-hw-row{display:flex;gap:9px;align-items:baseline;font-size:12px;flex-wrap:wrap}
.lsd-hw-k{flex:none;min-width:52px;font-size:11px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.9))}
.lsd-hw-v{font-weight:500;word-break:break-word}
.lsd-hw-v.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
/* ── generated-image card (tool.call.toolview) ──────────────────────── */
.lsd-card-wrap{display:flex;flex-direction:column;gap:8px;padding:2px 0}
.lsd-card-head{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;
  color:var(--dsw-alias-label-primary,inherit)}
.lsd-card-chip{font-size:10px;font-weight:500;padding:1px 7px;border-radius:999px;
  color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));background:rgba(128,128,128,.16)}
.lsd-card-hint{font-size:12px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.9))}
.lsd-card-err{font-size:12px;color:var(--dsw-alias-state-error-primary,#f85149);word-break:break-word}
.lsd-media{display:flex;flex-wrap:wrap;gap:8px}
.lsd-media.grid{max-width:320px}
.lsd-img-frame{display:flex;align-items:center;justify-content:center;overflow:hidden;padding:0;
  border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));
  background:rgba(128,128,128,.08);cursor:zoom-in;line-height:0}
.lsd-img-frame[data-single="0"]{width:96px;height:128px;flex:none}
.lsd-img-frame:hover{border-color:var(--dsw-alias-brand-primary,#4a9eff)}
.lsd-img-frame img{width:100%;height:100%;object-fit:cover;display:block}
.lsd-img-frame[data-single="1"] img{object-fit:contain}
.lsd-img-loading{font-size:10px;line-height:1.4;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.9))}
.lsd-img-err{display:inline-flex;align-items:center;padding:6px 10px;border-radius:8px;font-size:11px;
  color:var(--dsw-alias-state-error-primary,#f85149);background:rgba(248,81,73,.1)}
/* Lightbox. The shell gives a tool view no "open original" affordance, and a
   raw attachment URL is not a navigable page, so the card draws its own
   full-screen overlay. Clicking the backdrop (or the X) closes it. */
.lsd-lb{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.82);
  display:grid;place-items:center;cursor:zoom-out}
.lsd-lb-img{max-width:92vw;max-height:92vh;object-fit:contain;display:block;cursor:default;
  border-radius:4px;box-shadow:0 8px 40px rgba(0,0,0,.6)}
.lsd-lb-close{position:absolute;top:18px;right:22px;width:34px;height:34px;border-radius:50%;
  display:grid;place-items:center;font-size:18px;line-height:1;cursor:pointer;padding:0;
  color:#fff;background:rgba(255,255,255,.14);border:0}
.lsd-lb-close:hover{background:rgba(255,255,255,.26)}
`;
				document.head.appendChild(style);
				return function() { style.remove(); };
			});

			/** POST one command to the host settings API. */
			function callApi(payload) {
				return fetch(API_URL, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(payload)
				}).then(function(r) {
					return r.json().catch(function() {
						return { ok: false, error: "HTTP " + r.status };
					});
				}).catch(function(e) {
					return { ok: false, error: String(e && e.message || e) };
				});
			}

			function fmtMs(ms) {
				if (typeof ms !== "number" || !isFinite(ms)) return "—";
				if (ms <= 0) return "永不";
				if (ms < 60000) return Math.round(ms / 1000) + " 秒";
				return Math.round(ms / 60000) + " 分钟";
			}

			function fmtElapsed(ms) {
				if (typeof ms !== "number" || !isFinite(ms) || ms <= 0) return "0s";
				var s = Math.round(ms / 1000);
				if (s < 60) return s + "s";
				return Math.floor(s / 60) + "m " + (s % 60) + "s";
			}

			/**
			 * Startup progress + the launcher's real console output.
			 *
			 * The whole point is that the user never has to look at a console
			 * window: the bar says roughly where the boot is, and the log can be
			 * expanded to see exactly what the launcher printed — including the
			 * error when it dies, which used to require re-running it by hand.
			 */
			function StartupPanel(props) {
				var st = props.startup;
				var openS = React.useState(false);
				var open = openS[0];
				var setOpen = openS[1];
				var tailS = React.useRef(null);

				// Keep the newest line in view while it is streaming.
				React.useEffect(function() {
					if (open && tailS.current) tailS.current.scrollTop = tailS.current.scrollHeight;
				}, [open, st && st.lines ? st.lines.length : 0]);

				if (!st) return null;
				var starting = st.state === "starting";
				var failed = st.state === "failed";
				var ready = st.state === "ready";
				if (st.state === "idle" && (!st.lines || st.lines.length === 0)) return null;

				var pct = Math.round((st.progress || 0) * 100);
				var fillClass = "lsd-bar-fill" + (ready ? " ok" : failed ? " err" : "");
				// No output yet: show motion rather than a bar pinned at 2%.
				var indet = starting && (!st.lines || st.lines.length === 0);
				var label = failed ? "启动失败" : ready ? "已就绪" : st.state === "stopped" ? "已关闭" : (st.phase || "启动中");

				return h("div", { className: "lsd-prog" },
					h("div", { className: "lsd-prog-head" },
						h("span", { className: "lsd-prog-phase" }, label),
						st.elapsedMs > 0
							? h("span", { className: "lsd-prog-pct" }, fmtElapsed(st.elapsedMs))
							: null,
						starting ? h("span", { className: "lsd-prog-pct" }, pct + "%") : null
					),
					h("div", { className: "lsd-bar" },
						h("div", {
							className: fillClass + (indet ? " indet" : ""),
							style: indet ? undefined : { width: (ready ? 100 : pct) + "%" }
						})
					),
					failed && st.error
						? h("div", { className: "lsd-msg err" }, st.error)
						: null,
					h("div", { className: "lsd-actions" },
						h("button", {
							className: "lsd-btn", disabled: props.busy,
							onClick: function() { setOpen(!open); }
						}, open ? "收起命令行输出" : "查看命令行输出"),
						st.logFile
							? h("span", { className: "lsd-footer" }, "日志：" + st.logFile)
							: null
					),
					open
						? (st.lines && st.lines.length > 0
							? h("pre", { className: "lsd-log", ref: tailS },
								st.lines.map(function(line, i) {
									return h("div", {
										key: i,
										className: line.stream === "err" ? "err" : line.stream === "info" ? "info" : ""
									}, line.text);
								})
							)
							: h("div", { className: "lsd-log-empty" }, "还没有输出。绘图程序刚启动，稍等一下…"))
						: null
				);
			}

			/* ── the settings page ──────────────────────────────────────── */

			function SettingsPage() {
				var stateS = React.useState(null);
				var state = stateS[0];
				var setState = stateS[1];
				var phaseS = React.useState("loading");
				var phase = phaseS[0];
				var setPhase = phaseS[1];
				var msgS = React.useState(null);
				var msg = msgS[0];
				var setMsg = msgS[1];
				var foundS = React.useState(null);
				var found = foundS[0];
				var setFound = foundS[1];
				// In-page directory browser state. `browser` is null while closed,
				// otherwise the listing the host returned for the current path.
				var browserS = React.useState(null);
				var browser = browserS[0];
				var setBrowser = browserS[1];
				var busyS = React.useState(false);
				var busy = busyS[0];
				var setBusy = busyS[1];

				// Local form state, seeded from the host snapshot. Kept separate
				// so typing does not round-trip until 保存.
				var forgeDirS = React.useState("");
				var forgeDir = forgeDirS[0];
				var setForgeDir = forgeDirS[1];
				// Where PNGs land. Empty = <workspace>/generated.
				var outputDirS = React.useState("");
				var outputDir = outputDirS[0];
				var setOutputDir = outputDirS[1];
				// Host-resolved default for an empty outputDir, shown as a hint.
				var defaultOutputDirS = React.useState("");
				var defaultOutputDir = defaultOutputDirS[0];
				var setDefaultOutputDir = defaultOutputDirS[1];
				// Which field the in-page browser is filling: "forge" | "output".
				var browseTargetS = React.useState("forge");
				var browseTarget = browseTargetS[0];
				var setBrowseTarget = browseTargetS[1];
				var endpointS = React.useState("");
				var endpoint = endpointS[0];
				var setEndpoint = endpointS[1];
				var enabledS = React.useState(true);
				var enabled = enabledS[0];
				var setEnabled = enabledS[1];
				var noBrowserS = React.useState(true);
				var noBrowser = noBrowserS[0];
				var setNoBrowser = noBrowserS[1];
				var startupS = React.useState(240000);
				var startupMs = startupS[0];
				var setStartupMs = startupS[1];
				var idleS = React.useState(300000);
				var idleMs = idleS[0];
				var setIdleMs = idleS[1];
				var stepsS = React.useState(25);
				var steps = stepsS[0];
				var setSteps = stepsS[1];
				var cfgS = React.useState(7);
				var cfg = cfgS[0];
				var setCfg = cfgS[1];
				var wS = React.useState(512);
				var width = wS[0];
				var setWidth = wS[1];
				var hS = React.useState(768);
				var height = hS[0];
				var setHeight = hS[1];
				// Hardware snapshot: { gpu, recommend } once the probe lands.
				var hwS = React.useState(null);
				var hw = hwS[0];
				var setHw = hwS[1];
				var hwPhaseS = React.useState("idle");
				var hwPhase = hwPhaseS[0];
				var setHwPhase = hwPhaseS[1];
				// Startup progress + launcher output, polled while a boot runs.
				var startupS = React.useState(null);
				var startupState = startupS[0];
				var setStartupState = startupS[1];

				function adopt(s) {
					setState(s);
					if (!s) return;
					setForgeDir(s.forgeDir || "");
					setOutputDir(s.outputDir || "");
					setDefaultOutputDir(s.defaultOutputDir || "");
					setEndpoint(s.endpoint || "");
					setEnabled(!!(s.autoStart && s.autoStart.enabled));
					// Absent means "on" (see resolveSettings), so default to true
					// rather than false when the key is missing.
					setNoBrowser(!(s.autoStart && s.autoStart.noBrowser === false));
					setStartupMs((s.autoStart && s.autoStart.startupTimeoutMs) || 240000);
					setIdleMs((s.autoStart && s.autoStart.idleShutdownMs) || 0);
					setSteps((s.defaults && s.defaults.steps) || 25);
					setCfg((s.defaults && s.defaults.cfg) || 7);
					setWidth((s.defaults && s.defaults.width) || 512);
					setHeight((s.defaults && s.defaults.height) || 768);
				}

				React.useEffect(function() {
					var cancelled = false;
					callApi({ method: "get" }).then(function(res) {
						if (cancelled) return;
						if (res && res.ok) {
							adopt(res.state);
							if (res.state && res.state.startup) setStartupState(res.state.startup);
							setPhase("ready");
						} else {
							setPhase("error");
							setMsg({ kind: "err", text: "读取配置失败：" + String(res && res.error || "未知错误") });
						}
					});
					return function() { cancelled = true; };
				}, []);

				// Poll the startup state once a second. Only while something is
				// actually happening: a settled page should not keep a timer alive.
				React.useEffect(function() {
					var cancelled = false;
					var timer = null;
					var tick = function() {
						callApi({ method: "startup" }).then(function(res) {
							if (cancelled) return;
							if (res && res.ok && res.startup) {
								setStartupState(res.startup);
								var live = res.startup.state === "starting";
								timer = setTimeout(tick, live ? 1000 : 4000);
							} else {
								timer = setTimeout(tick, 8000);
							}
						});
					};
					timer = setTimeout(tick, 1200);
					return function() {
						cancelled = true;
						if (timer !== null) clearTimeout(timer);
					};
				}, []);

				/** Probe the GPU. Slow (nvidia-smi + registry walk), so it runs
				 *  after the page is already on screen. */
				function loadHardware() {
					setHwPhase("loading");
					callApi({ method: "hardware" }).then(function(res) {
						if (res && res.ok && res.hardware) {
							setHw(res.hardware);
							setHwPhase("ready");
						} else {
							setHwPhase("error");
						}
					});
				}

				React.useEffect(function() {
					var cancelled = false;
					setHwPhase("loading");
					callApi({ method: "hardware" }).then(function(res) {
						if (cancelled) return;
						if (res && res.ok && res.hardware) {
							setHw(res.hardware);
							setHwPhase("ready");
						} else {
							setHwPhase("error");
						}
					});
					return function() { cancelled = true; };
				}, []);

				/** Copy the recommended values into the form. Nothing is saved
				 *  until 保存 is pressed — this only fills the inputs. */
				function applyRecommend() {
					if (hw === null || !hw.recommend) return;
					var r = hw.recommend;
					setWidth(r.width);
					setHeight(r.height);
					setSteps(r.steps);
					setCfg(r.cfg);
					setMsg({ kind: "info", text: "已填入推荐值：" + r.width + "×" + r.height + " / " + r.steps + " 步 / CFG " + r.cfg + "，记得点保存" });
				}

				function save() {
					setBusy(true);
					setMsg(null);
					return callApi({
						method: "save",
						forgeDir: forgeDir,
						outputDir: outputDir,
						endpoint: endpoint,
						autoStart: {
							enabled: enabled,
							noBrowser: noBrowser,
							startupTimeoutMs: Number(startupMs) || 240000,
							idleShutdownMs: Number(idleMs) || 0
						},
						defaults: {
							steps: Number(steps) || 25,
							cfg: Number(cfg) || 7,
							width: Number(width) || 512,
							height: Number(height) || 768
						}
					}).then(function(res) {
						setBusy(false);
						if (res && res.ok) {
							adopt(res.state);
							var okLauncher = res.state && res.state.launcher;
							setMsg(okLauncher
								? { kind: "ok", text: "已保存。识别到启动文件：" + okLauncher.launcher }
								: { kind: "warn", text: "已保存，但那个目录里没找到 run.bat / webui.bat / webui.sh。" +
									"\n填 WebUI 解压后的根目录（Forge 是外层那个带 run.bat 的文件夹）。" });
						} else {
							setMsg({ kind: "err", text: "保存失败：" + String(res && res.error || "未知错误") });
						}
					});
				}

				// Open the in-page browser, starting at whatever is currently typed
				// (or the host's home directory when the box is empty). `target`
				// decides which field "选这个目录" fills.
				function browse(target) {
					setBusy(true);
					setMsg(null);
					setBrowseTarget(target);
					var start = target === "output" ? (outputDir || defaultOutputDir || "") : (forgeDir || "");
					callApi({ method: "browse", path: start }).then(function(res) {
						setBusy(false);
						if (res && res.ok && res.listing) {
							setBrowser(res.listing);
						} else {
							setMsg({ kind: "err", text: "打开目录失败：" + String(res && res.error || "未知错误") });
						}
					});
				}

				/** Load one directory into the open browser. */
				function openDir(path) {
					setBusy(true);
					callApi({ method: "browse", path: path }).then(function(res) {
						setBusy(false);
						if (res && res.ok && res.listing) {
							setBrowser(res.listing);
						} else {
							setMsg({ kind: "err", text: "打开目录失败：" + String(res && res.error || "未知错误") });
						}
					});
				}

				/** Commit the browser's current directory to the form field. */
				function useCurrentDir() {
					if (browser === null) return;
					if (browseTarget === "output") {
						setOutputDir(browser.path);
					} else {
						setForgeDir(browser.path);
					}
					setBrowser(null);
					setMsg({ kind: "info", text: "已选：" + browser.path + "，记得点保存" });
				}

				function detect() {
					setBusy(true);
					setMsg(null);
					callApi({ method: "detect" }).then(function(res) {
						setBusy(false);
						if (res && res.ok) {
							setFound(res.found || []);
							if (!res.found || res.found.length === 0) {
								setMsg({ kind: "warn", text: "常见位置没扫到。手动填目录吧，就是含 run.bat 的那个文件夹。" });
							}
						} else {
							setMsg({ kind: "err", text: "探测失败：" + String(res && res.error || "未知错误") });
						}
					});
				}

				function backend(action) {
					setBusy(true);
					setMsg(null);
					// A cold boot takes minutes. Show the panel immediately with a
					// pending state instead of leaving the page looking frozen while
					// the request is in flight — the poll picks up real progress.
					if (action === "start") {
						setStartupState({
							state: "starting", phase: "启动绘图程序", progress: 0.02,
							startedAt: Date.now(), endedAt: 0, error: "", lines: [], elapsedMs: 0
						});
					}
					callApi({ method: action }).then(function(res) {
						setBusy(false);
						if (res && res.state) {
							adopt(res.state);
							if (res.state.startup) setStartupState(res.state.startup);
						}
						if (res && res.ok) {
							setMsg({ kind: "ok", text: action === "start" ? "后端已就绪" : "后端已关闭，显存释放" });
						} else {
							setMsg({ kind: "err", text: String(res && res.error || "操作失败") });
						}
					});
				}

				if (phase === "loading") {
					return h("div", { className: "lsd-root" },
						h("div", { className: "lsd-desc" }, "读取配置中…")
					);
				}

				var live = state && state.liveEndpoint;
				var launcher = state && state.launcher;
				var dotClass = "lsd-dot" + (live ? " on" : (launcher ? " warn" : ""));

				return h("div", { className: "lsd-root" },
					h("div", { className: "lsd-head" },
						h("h2", { className: "lsd-title" }, "本地绘图"),
						h("p", { className: "lsd-desc" },
							"把本机的 Stable Diffusion WebUI / Forge 接到 DSH。提示词原样送进采样器，"
							+ "不经过任何云端服务、没有内容过滤。后端按需启动，闲置自动关闭。")
					),

					// ── status ───────────────────────────────────────────
					h("div", { className: "lsd-card" },
						h("div", { className: "lsd-card-head" },
							h("span", { className: dotClass }),
							h("span", { className: "lsd-card-title" },
								live ? "后端运行中" : (launcher ? "已配置，后端未启动" : "还没配置"))
						),
						h("div", { className: "lsd-grid" },
							h("div", { className: "lsd-stat" },
								h("span", { className: "lsd-stat-k" }, "接口地址"),
								h("span", { className: "lsd-stat-v" }, live || (state && state.endpoint) || "—")
							),
							h("div", { className: "lsd-stat" },
								h("span", { className: "lsd-stat-k" }, "启动文件"),
								h("span", { className: "lsd-stat-v" }, launcher ? launcher.launcher : "未识别")
							),
							h("div", { className: "lsd-stat" },
								h("span", { className: "lsd-stat-k" }, "进程归属"),
								h("span", { className: "lsd-stat-v" }, state && state.owned ? "插件启动" : "非插件启动")
							),
							h("div", { className: "lsd-stat" },
								h("span", { className: "lsd-stat-k" }, "闲置关闭"),
								h("span", { className: "lsd-stat-v" }, fmtMs(idleMs))
							)
						),
						h("div", { className: "lsd-actions" },
							h("button", {
								className: "lsd-btn", disabled: busy,
								onClick: function() { backend("start"); }
							}, "预热后端"),
							h("button", {
								className: "lsd-btn", disabled: busy || !(state && state.owned),
								onClick: function() { backend("stop"); }
							}, "释放显存"),
							h("button", {
								className: "lsd-btn", disabled: busy,
								onClick: function() { callApi({ method: "get" }).then(function(r) { if (r && r.ok) adopt(r.state); }); }
							}, "刷新")
						),
						// Progress + the launcher's real output, so the console
						// window never has to be looked at (or clicked into).
						h(StartupPanel, { startup: startupState, busy: busy })
					),

					// ── directories ──────────────────────────────────────
					h("div", { className: "lsd-card" },
						h("div", { className: "lsd-card-head" },
							h("span", { className: "lsd-card-title" }, "目录设置")
						),
						h("div", { className: "lsd-field" },
							h("label", { className: "lsd-label" }, "Stable Diffusion WebUI / Forge 根目录"),
							h("div", { className: "lsd-row" },
								h("input", {
									className: "lsd-input mono",
									value: forgeDir,
									placeholder: "例如 D:\\AI\\forge\\webui_forge_cu124_torch24",
									onChange: function(e) { setForgeDir(e.target.value); }
								}),
								h("button", { className: "lsd-btn", disabled: busy, onClick: function() { browse("forge"); } }, "浏览…"),
								h("button", { className: "lsd-btn", disabled: busy, onClick: detect }, "自动探测")
							),
							h("span", { className: "lsd-hint" },
								"填解压后带 run.bat 的那一层（Forge 是外层文件夹，不是 system 里面）。"
								+ "也接受直接填 run.bat 的完整路径。Linux / macOS 会自动找 webui.sh。")
						),

						h("div", { className: "lsd-field" },
							h("label", { className: "lsd-label" }, "图片存放目录"),
							h("div", { className: "lsd-row" },
								h("input", {
									className: "lsd-input mono",
									value: outputDir,
									placeholder: defaultOutputDir || "留空 = 工作区下的 generated",
									onChange: function(e) { setOutputDir(e.target.value); }
								}),
								h("button", { className: "lsd-btn", disabled: busy, onClick: function() { browse("output"); } }, "浏览…"),
								h("button", {
									className: "lsd-btn", disabled: busy || outputDir.length === 0,
									onClick: function() { setOutputDir(""); }
								}, "恢复默认")
							),
							h("span", { className: "lsd-hint" },
								"出图存哪儿。留空就用工作区的 generated 子目录；"
								+ "填相对路径（如 pics/sd）会接在工作区后面，填绝对路径（如 D:\\AI\\pics）则原样使用。"
								+ (defaultOutputDir ? "\n当前默认：" + defaultOutputDir : ""))
						),

						// ── in-page directory browser ────────────────────
						browser !== null
							? h("div", { className: "lsd-browser" },
								h("div", { className: "lsd-browser-head" },
									h("button", {
										className: "lsd-btn", disabled: busy || browser.parent === null,
										title: browser.parent === null ? "已经是根目录" : browser.parent,
										onClick: function() { if (browser.parent) openDir(browser.parent); }
									}, "↑ 上一层"),
									h("input", {
										className: "lsd-input mono lsd-browser-path",
										value: browser.path,
										onChange: function(e) { setBrowser(Object.assign({}, browser, { path: e.target.value })); },
										onKeyDown: function(e) { if (e.key === "Enter") openDir(e.target.value); }
									}),
									h("button", { className: "lsd-btn", disabled: busy, onClick: function() { openDir(browser.path); } }, "前往")
								),

								browser.roots && browser.roots.length > 1
									? h("div", { className: "lsd-drives" },
										browser.roots.map(function(drive) {
											return h("button", {
												className: "lsd-drive", key: drive, disabled: busy,
												onClick: function() { openDir(drive); }
											}, drive);
										})
									)
									: null,

								browser.error
									? h("div", { className: "lsd-msg err" }, browser.error)
									: null,

								h("div", { className: "lsd-browser-list" },
									browser.entries && browser.entries.length > 0
										? browser.entries.map(function(name) {
											var sep = browser.path.indexOf("\\") >= 0 ? "\\" : "/";
											var child = browser.path.replace(/[\\/]+$/, "") + sep + name;
											return h("button", {
												className: "lsd-entry", key: name, disabled: busy,
												onClick: function() { openDir(child); }
											}, "📁 " + name);
										})
										: h("div", { className: "lsd-hint" }, browser.error ? "" : "这个目录里没有子文件夹")
								),

								h("div", { className: "lsd-browser-foot" },
									browseTarget === "output"
										? h("span", { className: "lsd-hint" },
											"选一个放图的文件夹，没有的话在上层目录里新建一个再进来")
										: browser.launcher
											? h("span", { className: "lsd-msg ok" },
												"✓ 这个目录里有 " + browser.launcher.launcher + "，就是它了")
											: h("span", { className: "lsd-hint" },
												"这个目录里没有 run.bat / webui.bat / webui.sh，继续往下找或者换一层"),
									h("div", { className: "lsd-actions" },
										h("button", {
											className: "lsd-btn primary", disabled: busy,
											onClick: useCurrentDir
										}, "选这个目录"),
										h("button", {
											className: "lsd-btn", disabled: busy,
											onClick: function() { setBrowser(null); }
										}, "取消")
									)
								)
							)
							: null,

						found !== null && found.length > 0
							? h("div", { className: "lsd-found" },
								found.map(function(item, i) {
									return h("div", { className: "lsd-found-item", key: i },
										h("span", null, item.dir),
										h("button", {
											className: "lsd-btn",
											onClick: function() {
												setForgeDir(item.dir);
												setFound(null);
												setMsg({ kind: "info", text: "已选：" + item.dir + "，记得点保存" });
											}
										}, "用这个")
									);
								})
							)
							: null
					),

					// ── backend behaviour ────────────────────────────────
					h("div", { className: "lsd-card" },
						h("div", { className: "lsd-card-head" },
							h("span", { className: "lsd-card-title" }, "后端行为")
						),
						h("label", { className: "lsd-toggle" },
							h("input", {
								type: "checkbox", checked: enabled,
								onChange: function(e) { setEnabled(e.target.checked); }
							}),
							h("span", null, "后端没开时自动启动它")
						),
						h("label", { className: "lsd-toggle" },
							h("input", {
								type: "checkbox", checked: noBrowser,
								onChange: function(e) { setNoBrowser(e.target.checked); }
							}),
							h("span", null, "启动时不自动打开浏览器")
						),
						h("span", { className: "lsd-hint" },
							"勾上后，插件拉起 Forge 时不会弹出 http://127.0.0.1:7860 那个页面。"
							+ "出图完全不需要那个界面，只走 API。你自己手动双击 run.bat 启动的话不受影响。"),
						h("div", { className: "lsd-grid" },
							h("div", { className: "lsd-field" },
								h("label", { className: "lsd-label" }, "启动超时（毫秒）"),
								h("input", {
									className: "lsd-input", type: "number", min: 30000, step: 10000,
									value: startupMs,
									onChange: function(e) { setStartupMs(e.target.value); }
								}),
								h("span", { className: "lsd-hint" }, "冷启动要 2~3 分钟，别调太小")
							),
							h("div", { className: "lsd-field" },
								h("label", { className: "lsd-label" }, "闲置多久自动关闭（毫秒）"),
								h("input", {
									className: "lsd-input", type: "number", min: 0, step: 60000,
									value: idleMs,
									onChange: function(e) { setIdleMs(e.target.value); }
								}),
								h("span", { className: "lsd-hint" }, "填 0 = 永不自动关闭")
							),
							h("div", { className: "lsd-field" },
								h("label", { className: "lsd-label" }, "接口地址"),
								h("input", {
									className: "lsd-input mono", value: endpoint,
									onChange: function(e) { setEndpoint(e.target.value); }
								}),
								h("span", { className: "lsd-hint" }, "默认 7860，改过端口才需要动")
							)
						)
					),

					// ── defaults ─────────────────────────────────────────
					h("div", { className: "lsd-card" },
						h("div", { className: "lsd-card-head" },
							h("span", { className: "lsd-card-title" }, "默认出图参数")
						),

						// Hardware readout + one-click recommended values.
						hwPhase === "loading"
							? h("div", { className: "lsd-hint" }, "正在识别显卡…")
							: hwPhase === "error"
								? h("div", { className: "lsd-hint" },
									"没读到显卡信息，按最保守的参数来。可以点「重新识别」再试一次。"
									+ "\n如果一直是这样，多半是 DSH 没重启 —— 插件换了文件但宿主还跑着旧代码。")
								: hw !== null
									? h("div", { className: "lsd-hw" },
										h("div", { className: "lsd-hw-row" },
											h("span", { className: "lsd-hw-k" }, "显卡"),
											h("span", { className: "lsd-hw-v" },
												hw.gpu
													? hw.gpu.name + "　" + (hw.gpu.vramMb / 1024).toFixed(1).replace(/\.0$/, "") + " GB 显存"
													: "未识别"
											)
										),
										hw.gpu && !hw.gpu.exact
											? h("div", { className: "lsd-hint" },
												"（显存数值来自 WMI，8 GB 以上的卡可能显示不准，仅供参考）")
											: null,
										// When nothing was found, show what each probe
										// actually returned — a bare "not detected"
										// leaves no way to tell a driver problem from a
										// sandbox one.
										!hw.gpu && hw.tried && hw.tried.length > 0
											? h("div", { className: "lsd-hint" },
												"试过：" + hw.tried.map(function(t) {
													return t.source + (t.ok ? " ✓" : " ✗");
												}).join("　")
												+ "。全都没结果，就手动填参数吧。")
											: null,
										hw.build
											? h("div", { className: "lsd-footer" }, "插件构建 " + hw.build)
											: null,
										hw.recommend
											? h("div", { className: "lsd-hw-row" },
												h("span", { className: "lsd-hw-k" }, "推荐"),
												h("span", { className: "lsd-hw-v" },
													hw.recommend.width + "×" + hw.recommend.height
													+ "　" + hw.recommend.steps + " 步　CFG " + hw.recommend.cfg
												)
											)
											: null,
										hw.recommend && hw.recommend.note
											? h("div", { className: "lsd-hint" }, hw.recommend.note)
											: null,
										hw.recommend && hw.recommend.launchArgs
											? h("div", { className: "lsd-hw-row" },
												h("span", { className: "lsd-hw-k" }, "启动参数"),
												h("span", { className: "lsd-hw-v mono" }, hw.recommend.launchArgs)
											)
											: null
									)
									: null,

						hw !== null && hw.recommend
							? h("div", { className: "lsd-actions" },
								h("button", {
									className: "lsd-btn", disabled: busy,
									onClick: applyRecommend
								}, "套用推荐值"),
								h("button", {
									className: "lsd-btn", disabled: busy || hwPhase === "loading",
									onClick: loadHardware
								}, "重新识别")
							)
							: hwPhase !== "loading"
								? h("div", { className: "lsd-actions" },
									h("button", {
										className: "lsd-btn", disabled: busy || hwPhase === "loading",
										onClick: loadHardware
									}, "识别显卡")
								)
								: null,

						h("div", { className: "lsd-grid" },
							h("div", { className: "lsd-field" },
								h("label", { className: "lsd-label" }, "宽度"),
								h("input", {
									className: "lsd-input", type: "number", min: 64, step: 64, value: width,
									onChange: function(e) { setWidth(e.target.value); }
								})
							),
							h("div", { className: "lsd-field" },
								h("label", { className: "lsd-label" }, "高度"),
								h("input", {
									className: "lsd-input", type: "number", min: 64, step: 64, value: height,
									onChange: function(e) { setHeight(e.target.value); }
								})
							),
							h("div", { className: "lsd-field" },
								h("label", { className: "lsd-label" }, "步数"),
								h("input", {
									className: "lsd-input", type: "number", min: 1, max: 150, value: steps,
									onChange: function(e) { setSteps(e.target.value); }
								})
							),
							h("div", { className: "lsd-field" },
								h("label", { className: "lsd-label" }, "CFG"),
								h("input", {
									className: "lsd-input", type: "number", min: 1, max: 30, step: 0.5, value: cfg,
									onChange: function(e) { setCfg(e.target.value); }
								})
							)
						),
						h("span", { className: "lsd-hint" },
							hw !== null && hw.recommend
								? "按你现在的显卡，上面这组是能跑满又不容易爆显存的组合。手动改也行。"
								: "没识别到显卡时按最保守的来：SD1.5 用 512×768 基本不会爆。")
					),

					msg !== null
						? h("div", { className: "lsd-msg " + (msg.kind === "warn" ? "info" : msg.kind) }, msg.text)
						: null,

					h("div", { className: "lsd-actions" },
						h("button", {
							className: "lsd-btn primary", disabled: busy, onClick: save
						}, busy ? "处理中…" : "保存"),
						state
							? h("span", { className: "lsd-footer" }, "配置文件：" + state.configPath)
							: null
					)
				);
			}

			/* ── generated-image card ───────────────────────────────────── */

			// WHY THIS EXISTS AT ALL: the shell's own image row is hard-wired to
			// the `read_image` tool — `imageCardModel` bails with
			// `if (call?.name !== "read_image") return null`, so a plugin that
			// emits `{ type: "image", attachment }` blocks gets the GENERIC card,
			// which flattens them to the raw JSON text of the block. The picture
			// is on disk and the attachment is valid; it simply is not drawn.
			// Registering a keyed `tool.call.toolview` for our tool names is the
			// documented way to draw it.

			/** True for a positive integer dimension or byte count. */
			function positiveInt(v) {
				return typeof v === "number" && isFinite(v) && v > 0 && Math.floor(v) === v;
			}

			/**
			 * Collect the durable image references out of a settled tool result.
			 *
			 * The result CONTENT is the single source of truth, mirroring the
			 * shipped `imageReferences()` the built-in read_image view uses.
			 * Malformed entries are skipped rather than failing the whole card.
			 */
			function imageRefs(block) {
				if (!block || block.kind !== "tool-result" || block.isError) return [];
				var content = block.content;
				if (!Array.isArray(content)) return [];
				var out = [];
				for (var i = 0; i < content.length; i++) {
					var part = content[i];
					if (!part || typeof part !== "object" || part.type !== "image") continue;
					var a = part.attachment;
					if (!a || typeof a !== "object" || Array.isArray(a)) continue;
					if (typeof a.attachmentId !== "string" || a.attachmentId === "") continue;
					if (typeof a.mediaType !== "string" || a.mediaType.indexOf("image/") !== 0) continue;
					var ref = {
						attachmentId: a.attachmentId,
						mediaType: a.mediaType,
						bytes: positiveInt(a.bytes) ? a.bytes : 0,
						width: positiveInt(a.width) ? a.width : 0,
						height: positiveInt(a.height) ? a.height : 0
					};
					if (typeof a.name === "string" && a.name !== "") ref.name = a.name;
					out.push(ref);
				}
				return out;
			}

			/** The text blocks of a result, for the failure line. */
			function textOf(content) {
				if (!Array.isArray(content)) return "";
				var parts = [];
				for (var i = 0; i < content.length; i++) {
					var p = content[i];
					if (p && p.type === "text" && typeof p.text === "string") parts.push(p.text);
				}
				return parts.join("\n");
			}

			/** Largest box a single image occupies, in px. */
			var SINGLE_MAX_W = 240;
			var SINGLE_MAX_H = 320;

			/** Fit one image into the box without upscaling, keeping aspect. */
			function singleFit(dim) {
				if (!(dim.width > 0) || !(dim.height > 0)) {
					return { width: SINGLE_MAX_W, height: SINGLE_MAX_W };
				}
				var scale = Math.min(1, SINGLE_MAX_W / dim.width, SINGLE_MAX_H / dim.height);
				return {
					width: Math.max(1, Math.round(dim.width * scale)),
					height: Math.max(1, Math.round(dim.height * scale))
				};
			}

			/** One image, resolved through the shell's session-authorized loader. */
			function LocalSdImage(props) {
				var ref = props.image;
				var load = props.load;
				var single = props.single;
				var urlState = React.useState(function() {
					return typeof load.peek === "function" ? load.peek(ref) || null : null;
				});
				var url = urlState[0];
				var setUrl = urlState[1];
				var errState = React.useState(false);
				var failed = errState[0];
				var setFailed = errState[1];
				var openState = React.useState(false);
				var open = openState[0];
				var setOpen = openState[1];

				React.useEffect(function() {
					var live = true;
					setFailed(false);
					setUrl(typeof load.peek === "function" ? load.peek(ref) || null : null);
					Promise.resolve(load(ref)).then(function(next) {
						if (live) setUrl(next);
					}, function() {
						if (live) setFailed(true);
					});
					return function() { live = false; };
				}, [ref, load]);

				// Escape closes the overlay, matching how the shell treats its own
				// modal surfaces.
				React.useEffect(function() {
					if (!open) return undefined;
					function onKey(e) {
						if (e && (e.key === "Escape" || e.keyCode === 27)) setOpen(false);
					}
					document.addEventListener("keydown", onKey);
					return function() { document.removeEventListener("keydown", onKey); };
				}, [open]);

				if (failed) {
					return h("span", { className: "lsd-img-err", title: ref.name || "" }, "图片加载失败");
				}

				var fit = single ? singleFit({ width: ref.width, height: ref.height }) : null;

				// A raw attachment URL is a blob-ish endpoint, not a page: opening it
				// in a new tab shows nothing useful (or a download prompt). So the
				// thumbnail opens an in-place overlay instead.
				var frame = h("button", {
					type: "button",
					className: "lsd-img-frame",
					"data-single": single ? "1" : "0",
					style: fit === null ? null : { width: fit.width + "px", height: fit.height + "px" },
					title: url === null ? "加载中…" : "点击查看原图",
					onClick: function() { if (url !== null) setOpen(true); }
				}, url === null
					? h("span", { className: "lsd-img-loading" }, "加载中…")
					: h("img", { src: url, alt: ref.name || "生成的图片" })
				);

				if (!open || url === null) return frame;

				return h(React.Fragment, null,
					frame,
					h("div", {
						className: "lsd-lb",
						role: "dialog",
						"aria-modal": "true",
						onClick: function() { setOpen(false); }
					},
						h("button", {
							type: "button",
							className: "lsd-lb-close",
							title: "关闭",
							onClick: function(e) {
								if (e && e.stopPropagation) e.stopPropagation();
								setOpen(false);
							}
						}, "\u00d7"),
						h("img", {
							className: "lsd-lb-img",
							src: url,
							alt: ref.name || "生成的图片",
							onClick: function(e) { if (e && e.stopPropagation) e.stopPropagation(); }
						})
					)
				);
			}

			/**
			 * The card itself. Keyed tool views are dispatched with `phase` plus a
			 * stage-specific `block`, and only the `result` stage carries the tool
			 * result, so nothing may be decided from the block at mount time.
			 */
			function ImageCard(props) {
				var block = props.phase === "result" ? props.block : null;

				if (props.phase !== "result") {
					return h("div", { className: "lsd-card-wrap" },
						h("span", { className: "lsd-card-hint" }, "正在生成图片…")
					);
				}
				if (block && block.isError) {
					var errText = textOf(block.content).trim();
					return h("div", { className: "lsd-card-wrap" },
						h("span", { className: "lsd-card-err" },
							"图片生成失败" + (errText ? "：" + errText.slice(0, 300) : ""))
					);
				}
				var refs = imageRefs(block);
				if (refs.length === 0) {
					return h("div", { className: "lsd-card-wrap" },
						h("span", { className: "lsd-card-hint" }, "本次未生成可预览的图片")
					);
				}
				if (typeof props.loadImage !== "function") {
					return h("div", { className: "lsd-card-wrap" },
						h("span", { className: "lsd-card-hint" }, "图片加载器不可用")
					);
				}

				var single = refs.length === 1;
				return h("div", { className: "lsd-card-wrap" },
					h("div", { className: "lsd-card-head" },
						h("span", null, "本地绘图"),
						h("span", { className: "lsd-card-chip" }, refs.length + " 张")
					),
					h("div", { className: single ? "lsd-media single" : "lsd-media grid" },
						refs.map(function(ref, i) {
							return h(LocalSdImage, {
								key: ref.attachmentId + ":" + i,
								image: ref,
								load: props.loadImage,
								single: single
							});
						})
					)
				);
			}

			/* ── registration ───────────────────────────────────────────── */

			ctx.slots.inject("settings.section", function() {
				return ctx.slots.register({
					name: "settings.section",
					id: "local-sd",
					// After the shipped pages, next to the other plugin pages.
					order: 210,
					label: NAV_LABEL
				}, SettingsPage);
			});

			// `tool.call.toolview` is KEYED, so one registration covers exactly one
			// tool name. Both our tools emit the same block shape, so they share
			// the component.
			["generate_image_local", "generate_image_batch"].forEach(function(toolName) {
				ctx.slots.inject("tool.call.toolview", function() {
					return ctx.slots.register({
						name: "tool.call.toolview",
						key: toolName
					}, ImageCard);
				});
			});
		};
		return module.exports;
	}
});
