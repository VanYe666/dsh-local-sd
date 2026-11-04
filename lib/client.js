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
/* ── hardware readout ───────────────────────────────────────────────── */
.lsd-hw{display:flex;flex-direction:column;gap:5px;padding:10px 12px;border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));background:var(--dsw-alias-bg-base,rgba(128,128,128,.05))}
.lsd-hw-row{display:flex;gap:9px;align-items:baseline;font-size:12px;flex-wrap:wrap}
.lsd-hw-k{flex:none;min-width:52px;font-size:11px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.9))}
.lsd-hw-v{font-weight:500;word-break:break-word}
.lsd-hw-v.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
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

				function adopt(s) {
					setState(s);
					if (!s) return;
					setForgeDir(s.forgeDir || "");
					setOutputDir(s.outputDir || "");
					setDefaultOutputDir(s.defaultOutputDir || "");
					setEndpoint(s.endpoint || "");
					setEnabled(!!(s.autoStart && s.autoStart.enabled));
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
							setPhase("ready");
						} else {
							setPhase("error");
							setMsg({ kind: "err", text: "读取配置失败：" + String(res && res.error || "未知错误") });
						}
					});
					return function() { cancelled = true; };
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
					callApi({ method: action }).then(function(res) {
						setBusy(false);
						if (res && res.state) adopt(res.state);
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
						)
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
		};
		return module.exports;
	}
});
