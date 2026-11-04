/**
 * dsh-local-sd — host half.
 *
 * Registers tools that drive a LOCAL Stable Diffusion backend:
 *
 *   generate_image_local  — one prompt, one image
 *   generate_image_batch  — N prompts, N images (sequential)
 *   sd_backend_status     — probe the backend, list checkpoints/samplers
 *   sd_backend_control    — start / stop the backend on demand
 *
 * Backend: any A1111-compatible `/sdapi/v1/txt2img` endpoint. That covers
 * SD WebUI Forge (default port 7860), A1111 (7860), and KoboldCpp (`--sdmodel`,
 * default port 5001).
 *
 * Why this exists: the shipped `generate_image` (dsh-agnes-multimodal) is a
 * hosted API with a content filter. A local sdapi backend has no filter at
 * all — the prompt goes straight into the sampler. This plugin is the bridge
 * that lets the model call that backend from inside DSH.
 *
 * LIFECYCLE — the backend is heavy (several GB of VRAM), so it is started
 * lazily on the first generation and shut down again after a period of
 * inactivity. Nothing runs while you are not drawing.
 *
 *   first generate call  → probe; if dead and autoStart.enabled → spawn
 *                          autoStart.command, poll until /sdapi/v1/options
 *                          answers (up to startupTimeoutMs)
 *   every generate call  → reset the idle timer
 *   idle timer expires   → kill the process tree WE started (never one the
 *                          user started by hand) and release the VRAM
 *
 * Config file: $DSH_HOME/local-sd.json  (written automatically on first run)
 *   {
 *     "endpoint": "http://127.0.0.1:7860",
 *     "fallbackEndpoints": ["http://127.0.0.1:5001"],
 *     "autoStart": {
 *       "enabled": true,
 *       "command": "D:\\AI\\forge\\webui_forge_cu124_torch24\\run.bat",
 *       "workdir": "D:\\AI\\forge\\webui_forge_cu124_torch24",
 *       "startupTimeoutMs": 240000,
 *       "idleShutdownMs": 300000
 *     },
 *     "defaults": { "steps": 25, "cfg": 7, "sampler": "euler_a",
 *                   "width": 512, "height": 768, "negative": "..." }
 *   }
 *
 * The file is re-read on every call, so edits take effect without a restart.
 * A UTF-8 BOM in that file is tolerated (stripped before parsing) — earlier
 * builds silently fell back to the default port because of it.
 */

import { homedir, tmpdir } from "node:os";
import { mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { openSync, closeSync, readFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname, basename, relative, isAbsolute, resolve as resolvePath } from "node:path";

/** Does this path exist and is it a regular file? */
async function isFile(path) {
	try {
		const st = await stat(path);
		return st.isFile();
	} catch {
		return false;
	}
}

export const name = "dsh-local-sd";
// `webServer` carries the settings-page API; `connection` is the 0.2.x fence
// service that decides whether a request may reach those routes. Same triple
// the shipped dsh-agnes-multimodal declares for its config API.
export const inject = ["tools", "webServer", "connection"];

/** Test seam: lets the standalone tests drive the pure helpers directly. */
export const internals = { recommendFor, detectGpu, resolveLauncher, detectForgeDirs, listDirectory, resolveOutputLocation };

/**
 * Build stamp for the settings page. Bump on every user-visible change.
 *
 * The host process is NOT hot-reloaded: reinstalling the plugin only swaps the
 * files on disk, and the running host keeps the code it loaded at startup.
 * A stale host answers old routes (or 400s for new ones), which looks
 * indistinguishable from a broken feature. Showing this value in the page makes
 * "you need to restart DSH" a visible fact instead of a guess.
 */
const PLUGIN_BUILD = "0.5.0";

/** Forge and A1111 both listen here. */
const DEFAULT_ENDPOINT = "http://127.0.0.1:7860";

/** Tried in order when the configured endpoint is not answering. */
const FALLBACK_ENDPOINTS = [
	"http://127.0.0.1:7860",
	"http://127.0.0.1:5001",
	"http://127.0.0.1:7861",
	"http://127.0.0.1:8080",
];

const DEFAULT_NEGATIVE =
	"lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, " +
	"fewer digits, cropped, worst quality, low quality, normal quality, " +
	"jpeg artifacts, signature, watermark, username, blurry, artist name";

const FALLBACK_DEFAULTS = {
	steps: 25,
	cfg: 7,
	sampler: "euler_a",
	width: 512,
	height: 768,
	negative: DEFAULT_NEGATIVE,
};

/** 4 minutes to boot a cold Forge on a spinning disk is already generous. */
const DEFAULT_STARTUP_TIMEOUT_MS = 240_000;

/** 5 idle minutes then the VRAM goes back to the system. */
const DEFAULT_IDLE_SHUTDOWN_MS = 300_000;

/** A1111/Forge sampler_name is human-readable; accept snake_case aliases too. */
const SAMPLER_ALIASES = {
	euler_a: "Euler a",
	euler: "Euler",
	lms: "LMS",
	heun: "Heun",
	dpm2: "DPM2",
	dpm2_a: "DPM2 a",
	dpmpp_2s_a: "DPM++ 2S a",
	dpmpp_2m: "DPM++ 2M",
	dpmpp_sde: "DPM++ SDE",
	dpmpp_2m_sde: "DPM++ 2M SDE",
	dpmpp_2m_sde_gpu: "DPM++ 2M SDE",
	dpmpp_3m_sde: "DPM++ 3M SDE",
	dpmpp_3m_sde_gpu: "DPM++ 3M SDE",
	ddim: "DDIM",
	unipc: "UniPC",
	restart: "Restart",
};

function normalizeSampler(value) {
	if (typeof value !== "string" || value.length === 0) return FALLBACK_DEFAULTS.sampler;
	const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
	if (SAMPLER_ALIASES[key] !== undefined) return SAMPLER_ALIASES[key];
	// Already a display name (contains a space or uppercase) — pass through.
	return value;
}

function dshHome() {
	return process.env.DSH_HOME && process.env.DSH_HOME.length > 0
		? process.env.DSH_HOME
		: join(homedir(), ".dsh");
}

function configPath() {
	return join(dshHome(), "local-sd.json");
}

const DEFAULT_CONFIG_TEMPLATE = {
	forgeDir: "",
	// Where PNGs land. "" -> "<workspace>/generated". A relative path is joined
	// to the workspace root; an absolute one is used as-is (handy when the
	// workspace root the host reports is not the folder you actually look at).
	outputDir: "",
	endpoint: DEFAULT_ENDPOINT,
	fallbackEndpoints: FALLBACK_ENDPOINTS.slice(1),
	autoStart: {
		enabled: true,
		command: "",
		workdir: "",
		startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
		idleShutdownMs: DEFAULT_IDLE_SHUTDOWN_MS,
	},
	defaults: { ...FALLBACK_DEFAULTS },
};

/* ------------------------------------------------------------------ */
/* Forge directory → launch command                                    */
/* ------------------------------------------------------------------ */

/**
 * Launcher file names, per platform, in preference order.
 *
 * Forge's portable build ships `run.bat` at the ROOT of the extracted
 * directory (the one that `cd`s into `system/`). A1111 ships `webui.bat` on
 * Windows and `webui.sh` on POSIX. Picking the first that exists means the
 * user only has to point at the folder.
 */
const LAUNCHER_CANDIDATES = {
	win32: ["run.bat", "webui.bat", "webui-user.bat", "start.bat"],
	posix: ["webui.sh", "run.sh", "webui-user.sh"],
};

/** Directories that commonly hold a Forge / A1111 install, per platform. */
const PROBE_ROOTS = {
	win32: [
		"D:\\AI\\forge",
		"D:\\forge",
		"C:\\AI\\forge",
		"C:\\forge",
		"D:\\stable-diffusion-webui",
		"C:\\stable-diffusion-webui",
		"D:\\AI",
	],
	posix: [
		join(homedir(), "stable-diffusion-webui"),
		join(homedir(), "stable-diffusion-webui-forge"),
		"/opt/stable-diffusion-webui",
	],
};

/** Is this a directory we can read? */
async function isDir(path) {
	try {
		const st = await stat(path);
		return st.isDirectory();
	} catch {
		return false;
	}
}

/* ------------------------------------------------------------------ */
/* GPU / VRAM detection                                                */
/* ------------------------------------------------------------------ */

/**
 * Ask nvidia-smi for the GPU name and total VRAM.
 *
 * Three sources exist on Windows and they are NOT equally trustworthy:
 *
 *   - `nvidia-smi` — exact, and the only one that also names the card.
 *   - Registry `HardwareInformation.qwMemorySize` — 64-bit, exact, but
 *     NVIDIA/AMD only and needs the driver key walk.
 *   - WMI `Win32_VideoController.AdapterRAM` — a 32-BIT field. It wraps at
 *     4 GB, so a 8 GB or 12 GB card reports 0 or a nonsense small number.
 *     That is the trap: it looks authoritative and is silently wrong exactly
 *     for the cards people are most likely to be asking about.
 *
 * So: nvidia-smi, then registry, and WMI only as a last resort with the
 * result explicitly flagged as possibly truncated.
 */
async function detectGpu() {
	const tried = [];
	if (process.platform === "win32" || process.platform === "linux") {
		const smi = await readNvidiaSmi();
		tried.push({ source: "nvidia-smi", ok: smi !== null, detail: smi !== null ? smi.name : "no usable output" });
		if (smi !== null) return { gpu: smi, tried };
	}
	const reg = await readRegistryVram();
	tried.push({ source: "registry", ok: reg !== null, detail: reg !== null ? reg.name : "no usable output" });
	if (reg !== null) return { gpu: reg, tried };
	const wmi = await readWmiVram();
	tried.push({ source: "wmi", ok: wmi !== null, detail: wmi !== null ? wmi.name : "no usable output" });
	if (wmi !== null) return { gpu: wmi, tried };
	return { gpu: null, tried };
}

/**
 * Run one command and capture its stdout, or null on any failure.
 *
 * WHY A TEMP FILE INSTEAD OF A PIPE: DSH confines spawned processes so that a
 * child cannot open a named pipe. `spawn(..., { stdio: "pipe" })` therefore
 * fails with EPERM the moment the parent tries to read — which is exactly what
 * happened here: every probe silently returned null and the settings page said
 * "no GPU detected" on a machine with a perfectly good nvidia-smi. Writing
 * stdout to a real file and reading it back is allowed under the same sandbox
 * and behaves identically otherwise.
 *
 * The file is created with a unique name, removed on every exit path, and the
 * whole call is bounded by `timeoutMs` so a hung driver query cannot wedge the
 * settings page.
 */
function runCapture(command, args, timeoutMs) {
	return new Promise((resolve) => {
		const outPath = join(
			tmpdir(),
			"dsh-localsd-" + process.pid + "-" + Date.now().toString(36) + "-" +
				Math.random().toString(36).slice(2, 8) + ".txt",
		);

		let fd;
		try {
			fd = openSync(outPath, "w");
		} catch {
			resolve(null);
			return;
		}

		let done = false;
		let timer = null;

		const cleanup = () => {
			try { closeSync(fd); } catch { /* already closed */ }
			try { unlinkSync(outPath); } catch { /* already gone */ }
		};

		const finish = (value) => {
			if (done) return;
			done = true;
			if (timer !== null) clearTimeout(timer);
			try { child.kill(); } catch { /* already gone */ }
			cleanup();
			resolve(value);
		};

		let child;
		try {
			child = spawn(command, args, {
				// stdout goes to the file; nothing else is captured.
				stdio: ["ignore", fd, "ignore"],
				windowsHide: true,
			});
		} catch {
			done = true;
			cleanup();
			resolve(null);
			return;
		}

		timer = setTimeout(() => finish(null), timeoutMs);
		if (typeof timer.unref === "function") timer.unref();

		child.on("error", () => finish(null));
		child.on("close", (code) => {
			if (done) return;
			let out = "";
			try {
				out = readFileSync(outPath, "utf8");
			} catch {
				finish(null);
				return;
			}
			finish(code === 0 ? out : null);
		});
	});
}

/** `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` */
async function readNvidiaSmi() {
	const out = await runCapture(
		"nvidia-smi",
		["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
		4000,
	);
	if (out === null) return null;
	// One line per GPU; take the first (the one CUDA will use by default).
	const line = out.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0);
	if (line === undefined) return null;
	const parts = line.split(",").map((s) => s.trim());
	const name = parts[0] ?? "";
	const mib = Number(parts[1]);
	if (name.length === 0 || !Number.isFinite(mib) || mib <= 0) return null;
	return { name, vramMb: Math.round(mib), source: "nvidia-smi", exact: true };
}

/**
 * Registry walk for `HardwareInformation.qwMemorySize` (bytes, 64-bit).
 * Only on Windows, only for the display-adapter class key.
 */
async function readRegistryVram() {
	if (process.platform !== "win32") return null;
	// PowerShell is always present on Windows and handles the registry walk
	// without a native module.
	const script =
		"$b='HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';" +
		"Get-ChildItem $b -EA 0 | ForEach-Object { $p=Get-ItemProperty $_.PSPath -EA 0;" +
		" if ($p.'HardwareInformation.qwMemorySize' -and $p.DriverDesc) {" +
		" [pscustomobject]@{n=$p.DriverDesc;b=$p.'HardwareInformation.qwMemorySize'} } } |" +
		" Sort-Object b -Descending | Select-Object -First 1 | ConvertTo-Json -Compress";
	const out = await runCapture(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
		8000,
	);
	if (out === null) return null;
	const text = out.trim();
	if (text.length === 0) return null;
	try {
		const parsed = JSON.parse(text);
		const name = String(parsed.n ?? "").trim();
		const bytes = Number(parsed.b);
		if (name.length === 0 || !Number.isFinite(bytes) || bytes <= 0) return null;
		// Virtual display adapters (ToDesk, Oray, Parsec) report 0 or tiny
		// values and would otherwise win the "largest" sort by being present.
		if (/virtual|idd|remote|basic display|parsec|todesk|oray/i.test(name)) return null;
		return {
			name,
			vramMb: Math.round(bytes / (1024 * 1024)),
			source: "registry",
			exact: true,
		};
	} catch {
		return null;
	}
}

/** Last resort: WMI AdapterRAM (32-bit, truncates above 4 GB). */
async function readWmiVram() {
	if (process.platform !== "win32") return null;
	const script =
		"Get-CimInstance Win32_VideoController -EA 0 |" +
		" Where-Object { $_.AdapterRAM -gt 0 -and $_.Name -notmatch 'virtual|idd|remote|basic display|parsec|todesk|oray' } |" +
		" Sort-Object AdapterRAM -Descending | Select-Object -First 1 |" +
		" Select-Object Name,AdapterRAM | ConvertTo-Json -Compress";
	const out = await runCapture(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
		8000,
	);
	if (out === null) return null;
	const text = out.trim();
	if (text.length === 0) return null;
	try {
		const parsed = JSON.parse(text);
		const name = String(parsed.Name ?? "").trim();
		const bytes = Number(parsed.AdapterRAM);
		if (name.length === 0 || !Number.isFinite(bytes) || bytes <= 0) return null;
		return {
			name,
			vramMb: Math.round(bytes / (1024 * 1024)),
			source: "wmi",
			// AdapterRAM is a 32-bit field: anything at or above ~4 GB is a
			// wrapped value and must not be trusted as-is.
			exact: bytes < 3_900_000_000,
		};
	} catch {
		return null;
	}
}

/**
 * Turn a VRAM size into concrete advice.
 *
 * The tiers are drawn from what actually fits, not from a formula:
 *
 *   <= 4 GB  SD1.5 at 512×768 only. SDXL needs --lowvram and will crawl.
 *   6-7 GB   SD1.5 up to 768×1024; SDXL 1024×1024 works but is slow.
 *   8-11 GB  SDXL comfortable; SD1.5 can go 832×1216 for portraits.
 *   >= 12 GB SDXL 1024×1024 with room for a batch, or SD1.5 at 1024².
 *
 * `launchArgs` is the `--medvram` / `--lowvram` choice, which matters more
 * than the resolution: the wrong one is what actually causes an OOM.
 */
function recommendFor(vramMb) {
	const gb = vramMb / 1024;
	if (!Number.isFinite(gb) || gb <= 0) {
		return {
			tier: "unknown",
			label: "未知",
			width: 512,
			height: 768,
			steps: 25,
			cfg: 7,
			launchArgs: "--medvram --xformers --no-half-vae --api",
			note: "没识别到显卡，按最保守的配置来。",
		};
	}
	if (gb < 5) {
		return {
			tier: "4gb",
			label: "4 GB 级",
			width: 512,
			height: 768,
			steps: 25,
			cfg: 7,
			launchArgs: "--medvram --xformers --no-half-vae --api",
			note: "只建议跑 SD1.5。SDXL 会爆显存，非要跑就换 --lowvram 并把尺寸压到 768×768。",
		};
	}
	if (gb < 8) {
		return {
			tier: "6gb",
			label: "6~7 GB",
			width: 512,
			height: 768,
			steps: 25,
			cfg: 7,
			launchArgs: "--medvram --xformers --no-half-vae --api",
			note: "SD1.5 可以上 768×1024；SDXL 能跑 1024×1024 但慢，建议加 --lowvram。",
		};
	}
	if (gb < 12) {
		return {
			tier: "8gb",
			label: "8~11 GB",
			width: 832,
			height: 1216,
			steps: 28,
			cfg: 7,
			launchArgs: "--xformers --no-half-vae --api",
			note: "SDXL 1024×1024 很舒服；SD1.5 竖图可以上 832×1216。",
		};
	}
	if (gb < 16) {
		return {
			tier: "12gb",
			label: "12~15 GB",
			width: 1024,
			height: 1024,
			steps: 30,
			cfg: 7,
			launchArgs: "--xformers --no-half-vae --api",
			note: "SDXL 1024×1024 可以批量出；SD1.5 能跑 1024×1536。",
		};
	}
	return {
		tier: "16gb+",
		label: "16 GB 以上",
		width: 1024,
		height: 1536,
		steps: 30,
		cfg: 7,
		launchArgs: "--xformers --no-half-vae --api",
		note: "随便跑。SDXL 批量、SD1.5 高分辨率都没问题。",
	};
}

/**
 * Resolve a user-supplied Forge directory into a concrete launch command.
 *
 * Accepts the folder, or the launcher itself (a friend who pastes
 * `...\run.bat` should not be told they did it wrong). Returns
 * `{ command, workdir, launcher }` — `command` is "" when nothing usable was
 * found, which the settings page reports instead of failing at draw time.
 */
async function resolveLauncher(forgeDir) {
	// Always hand back ABSOLUTE paths. A relative one (say the user typed
	// `run.bat`) resolves against whatever cwd the launcher process happens to
	// have, and `cd /d` into it then fails with a syntax error instead of a
	// useful "not found".
	const raw = typeof forgeDir === "string" ? forgeDir.trim().replace(/^"(.*)"$/, "$1") : "";
	// Empty check BEFORE resolving: resolvePath("") happily returns the current
	// working directory, which would make an unset setting look configured.
	if (raw.length === 0) return { command: "", workdir: "", launcher: "" };
	const dir = resolvePath(raw);

	// The user pointed at the launcher file itself.
	if (/\.(bat|cmd|sh)$/i.test(dir)) {
		if (!(await isFile(dir))) return { command: "", workdir: "", launcher: "" };
		return { command: dir, workdir: dirname(dir), launcher: basename(dir) };
	}

	if (!(await isDir(dir))) return { command: "", workdir: "", launcher: "" };

	const names = LAUNCHER_CANDIDATES[process.platform === "win32" ? "win32" : "posix"];
	for (const name of names) {
		const candidate = join(dir, name);
		if (await isFile(candidate)) {
			return { command: candidate, workdir: dir, launcher: name };
		}
	}
	return { command: "", workdir: "", launcher: "" };
}

/**
 * Best-effort scan for an existing install, so the first run needs no typing.
 * Bounded: one level below each probe root, and only directories whose name
 * looks like a WebUI checkout.
 */
async function detectForgeDirs() {
	const roots = PROBE_ROOTS[process.platform === "win32" ? "win32" : "posix"];
	const found = [];
	const seen = new Set();

	const consider = async (dir) => {
		if (seen.has(dir)) return;
		seen.add(dir);
		const resolved = await resolveLauncher(dir);
		if (resolved.command.length > 0) {
			found.push({ dir, launcher: resolved.launcher, command: resolved.command });
		}
	};

	for (const root of roots) {
		await consider(root);
		if (found.length > 0) continue;
		let entries;
		try {
			entries = await readdir(root, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (!/forge|webui|stable-?diffusion|sd-?webui/i.test(entry.name)) continue;
			await consider(join(root, entry.name));
			if (found.length >= 5) break;
		}
		if (found.length >= 5) break;
	}
	return found;
}

/** Write the template once, so the file is discoverable and editable. */
async function ensureConfig() {
	const path = configPath();
	try {
		await readFile(path, "utf8");
		return;
	} catch {
		// Missing — fall through and create it.
	}
	try {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(DEFAULT_CONFIG_TEMPLATE, null, 2) + "\n", "utf8");
	} catch {
		// Read-only home or a sandbox denial: defaults still work in memory.
	}
}

async function readConfig() {
	await ensureConfig();
	try {
		let raw = await readFile(configPath(), "utf8");
		// Strip a UTF-8 BOM: JSON.parse rejects it, and silently falling back
		// to the default endpoint is the exact bug this guard prevents.
		if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
		const parsed = JSON.parse(raw);
		return parsed !== null && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/** Merge one patch into the config file and write it back. */
async function writeConfig(patch) {
	const current = await readConfig();
	const next = { ...current };
	for (const [key, value] of Object.entries(patch)) {
		if (value === null || value === undefined) continue;
		if (key === "autoStart" || key === "defaults") {
			next[key] = { ...(current[key] ?? {}), ...value };
		} else {
			next[key] = value;
		}
	}
	const path = configPath();
	await mkdir(dirname(path), { recursive: true });
	// No BOM — see readConfig.
	await writeFile(path, JSON.stringify(next, null, 2) + "\n", "utf8");
	return next;
}

async function resolveSettings() {
	const cfg = await readConfig();
	const configured =
		typeof cfg.endpoint === "string" && cfg.endpoint.length > 0
			? cfg.endpoint.replace(/\/+$/, "")
			: DEFAULT_ENDPOINT;

	const fallbacks = Array.isArray(cfg.fallbackEndpoints)
		? cfg.fallbackEndpoints
				.filter((e) => typeof e === "string" && e.length > 0)
				.map((e) => e.replace(/\/+$/, ""))
		: FALLBACK_ENDPOINTS.slice(1);

	const autoRaw = cfg.autoStart !== null && typeof cfg.autoStart === "object" ? cfg.autoStart : {};
	const numOr = (v, fallback) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback);
	const strOr = (v, fallback) => (typeof v === "string" && v.length > 0 ? v : fallback);
	// `idleShutdownMs: 0` means "never shut down", so 0 is a VALID value here —
	// `numOr` would treat it as missing and quietly restore the 5-minute default.
	const idleOr = (v, fallback) =>
		typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;

	const raw = cfg.defaults !== null && typeof cfg.defaults === "object" ? cfg.defaults : {};

	// `forgeDir` is the friendly knob (one folder path); `autoStart.command`
	// is the escape hatch for anything unusual. The explicit command wins.
	const forgeDir = strOr(cfg.forgeDir, "");
	const explicitCommand = strOr(autoRaw.command, "");
	// Absolute again: the escape hatch is often typed by hand, and a relative
	// command breaks the Windows `cd /d` prefix exactly like a relative
	// forgeDir does.
	let command = explicitCommand.length > 0 ? resolvePath(explicitCommand) : "";
	let workdir = strOr(autoRaw.workdir, "");
	if (workdir.length > 0) workdir = resolvePath(workdir);
	if (command.length === 0 && forgeDir.length > 0) {
		const resolved = await resolveLauncher(forgeDir);
		command = resolved.command;
		if (workdir.length === 0) workdir = resolved.workdir;
	}

	return {
		forgeDir,
		outputDir: strOr(cfg.outputDir, ""),
		endpoint: configured,
		candidates: [configured, ...fallbacks.filter((e) => e !== configured)],
		autoStart: {
			enabled: autoRaw.enabled === true,
			command,
			workdir,
			startupTimeoutMs: numOr(autoRaw.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS),
			idleShutdownMs: idleOr(autoRaw.idleShutdownMs, DEFAULT_IDLE_SHUTDOWN_MS),
		},
		steps: numOr(raw.steps, FALLBACK_DEFAULTS.steps),
		cfg: numOr(raw.cfg, FALLBACK_DEFAULTS.cfg),
		sampler: normalizeSampler(strOr(raw.sampler, FALLBACK_DEFAULTS.sampler)),
		width: numOr(raw.width, FALLBACK_DEFAULTS.width),
		height: numOr(raw.height, FALLBACK_DEFAULTS.height),
		negative: strOr(raw.negative, FALLBACK_DEFAULTS.negative),
	};
}

/* ------------------------------------------------------------------ */
/* Backend lifecycle                                                   */
/* ------------------------------------------------------------------ */

/**
 * Process we spawned, and the timer that will kill it. Kept at module scope so
 * every tool call shares the same view. A backend the USER started by hand is
 * never in here — and therefore never killed.
 */
const lifecycle = {
	child: null,
	pid: null,
	endpoint: null,
	lastUsedAt: 0,
	idleTimer: null,
	starting: null, // Promise while a spawn+wait is in flight
};

/** Is this endpoint a live sdapi backend? */
async function probe(endpoint, signal) {
	try {
		const timeout = AbortSignal.timeout(2500);
		const combined = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout;
		const res = await fetch(endpoint + "/sdapi/v1/options", { method: "GET", signal: combined });
		return res.ok;
	} catch {
		return false;
	}
}

/** First endpoint from settings.candidates that answers, or null. */
async function findLiveEndpoint(settings, signal) {
	for (const endpoint of settings.candidates) {
		if (await probe(endpoint, signal)) return endpoint;
	}
	return null;
}

function clearIdleTimer() {
	if (lifecycle.idleTimer !== null) {
		clearTimeout(lifecycle.idleTimer);
		lifecycle.idleTimer = null;
	}
}

/** Kill the process tree we started. Never touches a user-started backend. */
function stopOwnedBackend() {
	clearIdleTimer();
	const pid = lifecycle.pid;
	lifecycle.child = null;
	lifecycle.pid = null;
	lifecycle.endpoint = null;
	if (pid === null) return false;
	try {
		if (process.platform === "win32") {
			// Forge's run.bat spawns python.exe; /T takes the whole tree.
			spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
				stdio: "ignore",
				windowsHide: true,
				detached: true,
			}).unref();
		} else {
			try {
				process.kill(-pid, "SIGTERM");
			} catch {
				process.kill(pid, "SIGTERM");
			}
		}
	} catch {
		// Already gone.
	}
	return true;
}

/** Arm (or re-arm) the idle timer that releases the backend's VRAM. */
function touch(settings) {
	lifecycle.lastUsedAt = Date.now();
	clearIdleTimer();
	if (lifecycle.pid === null) return; // Nothing we own to shut down.
	const idleMs = settings.autoStart.idleShutdownMs;
	// 0 = keep the backend warm forever. Without this guard `setTimeout(0)`
	// would fire on the next tick and kill the backend we just started.
	if (idleMs <= 0) return;
	lifecycle.idleTimer = setTimeout(() => {
		if (lifecycle.pid === null) return;
		const idleFor = Date.now() - lifecycle.lastUsedAt;
		if (idleFor < idleMs) {
			// A generation finished after the timer was armed — re-arm.
			touch(settings);
			return;
		}
		stopOwnedBackend();
	}, idleMs);
	// Do not hold the DSH process open just for this timer.
	if (typeof lifecycle.idleTimer.unref === "function") lifecycle.idleTimer.unref();
}

/**
 * Environment for the spawned backend.
 *
 * Two problems get inherited from the parent shell and both break Forge:
 *
 *  1. A proxy in HTTP_PROXY/HTTPS_PROXY. The backend only serves 127.0.0.1, so
 *     a proxy is never wanted, and httpx picks it up during import.
 *  2. A NO_PROXY entry like `[::1]`. httpx parses NO_PROXY with its own URL
 *     parser and raises `InvalidURL: Invalid port: ':1]'` on the bracketed IPv6
 *     form, which kills the whole import chain (gradio → httpx) before the API
 *     ever binds. Proxy clients inject exactly that string.
 *
 * So: drop the proxy variables, and rebuild NO_PROXY from only the entries
 * httpx can actually parse.
 */
function sanitizedEnv() {
	const env = { ...process.env };
	for (const key of [
		"HTTP_PROXY",
		"HTTPS_PROXY",
		"ALL_PROXY",
		"http_proxy",
		"https_proxy",
		"all_proxy",
	]) {
		delete env[key];
	}

	const rawNoProxy = env.NO_PROXY ?? env.no_proxy ?? "";
	const safe = rawNoProxy
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		// httpx chokes on bracketed IPv6 and on bare `::1`; keep hostnames and
		// IPv4 only. localhost + 127.0.0.1 are the ones that actually matter.
		.filter((entry) => !entry.includes("[") && !entry.includes("]") && !entry.includes(":"));
	if (!safe.includes("127.0.0.1")) safe.push("127.0.0.1");
	if (!safe.includes("localhost")) safe.push("localhost");

	const noProxy = safe.join(",");
	env.NO_PROXY = noProxy;
	env.no_proxy = noProxy;
	return env;
}

/** Spawn the configured launch command and wait for sdapi to answer. */
async function spawnBackend(settings, signal) {
	const { command, workdir, startupTimeoutMs } = settings.autoStart;
	if (command.length === 0) {
		throw new Error(
			"No launch command resolved: autoStart.enabled is true but no Forge directory is configured. " +
				"Open 设置 → 本地绘图 and set 绘图程序目录 to your Stable Diffusion WebUI / Forge folder " +
				"(the one containing run.bat), or run `sd_backend_control` action=detect to scan for it.",
		);
	}

	// Forge's run.bat does `call environment.bat` — a RELATIVE path. Launching
	// it with the wrong working directory makes that fail silently, the bundled
	// Python 3.10 never lands on PATH, and the launcher then tries to build a
	// venv from whatever system Python it finds (3.14 → "Couldn't install
	// torch"). So: on Windows always `cd /d` into workdir first, and fall back
	// to the command's own directory when workdir was not configured.
	const isWin = process.platform === "win32";
	let spawnCommand = command;
	let spawnArgs = [];
	let spawnCwd = workdir.length > 0 ? workdir : undefined;
	// Windows only: Node's default argv quoting wraps the whole `/c` payload in
	// another pair of quotes, cmd.exe /s strips the outermost pair, and what is
	// left is a bare path — cmd answers "The filename, directory name, or volume
	// label syntax is incorrect" and exits 1 before the backend ever answers.
	// Verbatim hands the payload through untouched.
	let windowsVerbatimArguments = false;

	if (isWin) {
		const dir = spawnCwd ?? dirname(command);
		spawnCommand = "cmd.exe";
		spawnArgs = ["/d", "/s", "/c", `cd /d "${dir}" && "${command}"`];
		spawnCwd = dir;
		windowsVerbatimArguments = true;
	}

	const child = spawn(spawnCommand, spawnArgs, {
		cwd: spawnCwd,
		detached: true,
		stdio: "ignore",
		windowsHide: true,
		windowsVerbatimArguments,
		env: sanitizedEnv(),
	});
	child.unref();

	lifecycle.child = child;
	lifecycle.pid = child.pid ?? null;

	// If the launcher dies immediately, fail fast instead of waiting 4 minutes.
	let exitCode = null;
	child.once("exit", (code) => {
		exitCode = code ?? -1;
	});

	const deadline = Date.now() + startupTimeoutMs;
	while (Date.now() < deadline) {
		if (signal !== undefined && signal.aborted) {
			stopOwnedBackend();
			throw new Error("cancelled while starting the local SD backend");
		}
		if (exitCode !== null && exitCode !== 0) {
			stopOwnedBackend();
			throw new Error(
				"The local SD launcher exited with code " +
					exitCode +
					" before the API came up. Run " +
					command +
					" by hand to see its error output.",
			);
		}
		const live = await findLiveEndpoint(settings, signal);
		if (live !== null) {
			lifecycle.endpoint = live;
			return live;
		}
		await new Promise((r) => setTimeout(r, 2000));
	}

	stopOwnedBackend();
	throw new Error(
		"The local SD backend did not answer within " +
			Math.round(startupTimeoutMs / 1000) +
			"s of launching " +
			command +
			". First start is slow (dependencies, model load); raise 启动超时 in 设置 → 本地绘图 " +
			"if this is a cold boot on a slow disk.",
	);
}

/**
 * Make sure a backend is answering, starting one if allowed. Returns the
 * endpoint to use. Also re-arms the idle timer.
 */
async function ensureBackend(settings, signal) {
	const live = await findLiveEndpoint(settings, signal);
	if (live !== null) {
		lifecycle.endpoint = live;
		touch(settings);
		return live;
	}

	if (!settings.autoStart.enabled) {
		throw new Error(
			"No local Stable Diffusion backend answered at " +
				settings.candidates.join(", ") +
				", and auto-start is disabled.\n" +
				"Start one by hand (double-click Forge's outer run.bat, wait for " +
				"`Running on local URL: http://127.0.0.1:7860`), or enable 自动启动 in " +
				"设置 → 本地绘图.",
		);
	}

	// Collapse concurrent callers onto one spawn.
	if (lifecycle.starting === null) {
		lifecycle.starting = spawnBackend(settings, signal).finally(() => {
			lifecycle.starting = null;
		});
	}
	const endpoint = await lifecycle.starting;
	touch(settings);
	return endpoint;
}

/* ------------------------------------------------------------------ */
/* sdapi plumbing                                                      */
/* ------------------------------------------------------------------ */

/** Strip a `data:image/...;base64,` prefix and decode to a Buffer. */
function decodeB64(s) {
	if (typeof s !== "string" || s.length === 0) return null;
	const clean = s.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
	try {
		return Buffer.from(clean, "base64");
	} catch {
		return null;
	}
}

function stamp() {
	const d = new Date();
	const p = (n, w = 2) => String(n).padStart(w, "0");
	return (
		d.getFullYear() +
		p(d.getMonth() + 1) +
		p(d.getDate()) +
		"-" +
		p(d.getHours()) +
		p(d.getMinutes()) +
		p(d.getSeconds()) +
		"-" +
		p(d.getMilliseconds(), 3)
	);
}

/** One txt2img call. Returns the raw API JSON. */
async function txt2img(endpoint, prompt, opts, signal) {
	const body = {
		prompt,
		negative_prompt: opts.negative,
		steps: opts.steps,
		cfg_scale: opts.cfg,
		width: opts.width,
		height: opts.height,
		sampler_name: opts.sampler,
		seed: opts.seed,
		batch_size: 1,
		n_iter: 1,
		save_images: false,
		send_images: true,
	};
	if (Array.isArray(opts.lora) && opts.lora.length > 0) {
		body.lora = opts.lora.map((entry) =>
			typeof entry === "string"
				? { name: entry, multiplier: 1.0 }
				: { name: String(entry.name ?? ""), multiplier: Number(entry.multiplier ?? 1.0) },
		);
	}

	const res = await fetch(endpoint + "/sdapi/v1/txt2img", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal,
	}).catch((err) => {
		if (err instanceof Error && err.name === "AbortError") throw err;
		const why = err instanceof Error ? err.message : String(err);
		throw new Error("local SD backend unreachable at " + endpoint + " (" + why + ")");
	});

	const text = await res.text();
	if (!res.ok) {
		throw new Error("sdapi " + res.status + " " + res.statusText + ": " + text.slice(0, 400));
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error("sdapi returned non-JSON: " + text.slice(0, 400));
	}
	return parsed;
}

/**
 * Where PNGs land, and what the tool result calls that place.
 *
 * Precedence:
 *   1. `settings.outputDir` from $DSH_HOME/local-sd.json (the settings page),
 *   2. `<workspace root>/generated`.
 *
 * A relative `outputDir` is joined to the workspace root so the settings page
 * can offer the short, readable form (`generated`, `pics/sd`). An absolute one
 * is honoured verbatim: that is the whole point of the knob, pointing it at the
 * folder you actually browse even when the session workspace is elsewhere.
 *
 * `display` is what goes into the tool result: workspace-relative when the
 * folder sits inside the workspace (so the Web Client can link it), absolute
 * otherwise (a relative path there would be a lie).
 */
function resolveOutputLocation(settings, ctx) {
	const policy = ctx !== undefined && typeof ctx.get === "function" ? ctx.get("sandboxPolicy") : undefined;
	const root =
		policy !== undefined && typeof policy.workspaceRoot === "string" && policy.workspaceRoot.length > 0
			? policy.workspaceRoot
			: process.cwd();

	const configured = settings !== undefined && typeof settings.outputDir === "string" ? settings.outputDir.trim() : "";
	const dir = configured.length === 0
		? join(root, "generated")
		: isAbsolute(configured)
			? configured
			: join(root, configured);

	// `relative` returns "" for the root itself and a ".."-prefixed path when
	// outside it; both mean "not addressable relative to the workspace".
	const rel = relative(root, dir);
	const inside = rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
	return { dir, display: inside ? rel : dir };
}

/**
 * Persist one PNG and turn it into an attachment ref so the Web Client renders
 * it. Returns { localPath, absPath, attachmentRef }.
 */
async function persist(ctx, bytes, index, signal, settings) {
	const fs = ctx.get("fs");
	const attachments = ctx.get("attachments");
	if (fs === undefined || attachments === undefined) {
		throw new Error("fs/attachments service not available");
	}

	const location = resolveOutputLocation(settings, ctx);
	const fileName = "sd-" + stamp() + "-" + index + ".png";
	const absPath = join(location.dir, fileName);
	const localPath = join(location.display, fileName);

	await mkdir(location.dir, { recursive: true });
	await writeFile(absPath, bytes);

	const target = await fs.resolve(absPath);
	const read = await fs.readBytes(target, signal, 33554432);
	const saved = await attachments.saveImage({
		data: read,
		mediaType: "image/png",
		name: fileName,
	});

	// The Web Client's image row silently DROPS a block whose attachment ref is
	// missing a positive `bytes` / `width` / `height` — no error, no broken
	// image, just the generic text card. A backend that returns an incomplete
	// ref therefore looks exactly like "the model never sent a picture". Fill
	// any gap from the bytes we already have so the row always renders.
	const ref = completeImageRef(saved, read);

	return { localPath, absPath, attachmentRef: ref };
}

/**
 * Read width/height out of a PNG's IHDR chunk (bytes 16..24).
 * Returns null for anything that is not a well-formed PNG.
 */
function pngSize(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.length < 24) return null;
	const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	if (width <= 0 || height <= 0) return null;
	return { width, height };
}

/**
 * Make sure an attachment ref carries every field the image row validates.
 * `saveImage` normally returns all of them; this is the belt to that braces.
 */
function completeImageRef(ref, bytes) {
	const out = ref !== null && typeof ref === "object" ? { ...ref } : {};
	if (typeof out.attachmentId !== "string" || out.attachmentId.length === 0) return ref;
	if (typeof out.mediaType !== "string" || out.mediaType.length === 0) out.mediaType = "image/png";
	if (typeof out.bytes !== "number" || !(out.bytes > 0)) out.bytes = bytes.length;
	const needSize =
		typeof out.width !== "number" || !(out.width > 0) || typeof out.height !== "number" || !(out.height > 0);
	if (needSize) {
		const size = pngSize(bytes);
		if (size !== null) {
			out.width = size.width;
			out.height = size.height;
		}
	}
	return out;
}

/** Shared output shape: text line per image + the image block itself. */
function makeOutput() {
	return {
		schema: {
			type: "object",
			additionalProperties: true,
			properties: {
				results: {
					type: "array",
					description: "Array of generated image results.",
					items: {
						type: "object",
						additionalProperties: true,
						properties: {
							prompt: { type: "string", description: "The prompt used." },
							localPath: {
								type: "string",
								description: "PNG path: workspace-relative when inside the workspace, absolute otherwise.",
							},
							absPath: { type: "string", description: "Absolute PNG path on disk." },
							attachmentRef: { type: "object", description: "Attachment ref for display." },
							seed: { type: "number", description: "Seed actually used, if reported." },
							error: { type: "string", description: "Failure reason, when this item failed." },
						},
					},
				},
				backend: { type: "string", description: "The sdapi endpoint that produced these." },
			},
		},
		// `offloaded: true` keeps the model context text-only while the Web
		// Client still renders the image — same mechanism the shipped
		// generate_image uses.
		render: (_args, value) => {
			const results = Array.isArray(value.results) ? value.results : [];
			const blocks = [];
			results.forEach((r, i) => {
				if (r.error) {
					blocks.push({
						type: "text",
						text:
							"[local-sd] Image " +
							(i + 1) +
							"/" +
							results.length +
							" FAILED: " +
							r.error +
							"\nPrompt: " +
							r.prompt,
					});
					return;
				}
				const head =
					"[local-sd] Image " +
					(i + 1) +
					"/" +
					results.length +
					" generated locally (no content filter).\nPrompt: " +
					r.prompt;
				const tail =
					(r.localPath ? "\nlocalPath: " + r.localPath : "") +
					(r.absPath && r.absPath !== r.localPath ? "\nabsPath: " + r.absPath : "") +
					(r.seed !== undefined ? "\nseed: " + r.seed : "");
				blocks.push({ type: "text", text: head + tail });
				if (r.attachmentRef) blocks.push({ type: "image", attachment: r.attachmentRef, offloaded: true });
			});
			// The image blocks above are `offloaded`, so the model's context only
			// ever sees placeholder text: it never learns that pictures are now on
			// screen, and a model reading only this result tends to answer with a
			// description instead of showing them. This closing line IS
			// model-visible, so it states the delivery requirement plainly.
			const shown = results.filter((r) => r && !r.error && r.attachmentRef).length;
			if (shown > 0) {
				blocks.push({
					type: "text",
					text:
						"[local-sd] " +
						shown +
						" image(s) are ALREADY displayed in the conversation above. " +
						"The user sees them right now: do not describe them as pending, do not ask " +
						"whether to show them, and do not claim you cannot display images. " +
						"Refer to them naturally and keep the reply short.",
				});
			}
			return blocks;
		},
	};
}

const SIZE_PRESETS = {
	"512x512": [512, 512],
	"512x768": [512, 768],
	"768x512": [768, 512],
	"640x640": [640, 640],
	"768x768": [768, 768],
	"832x1216": [832, 1216],
	"1216x832": [1216, 832],
	"1024x1024": [1024, 1024],
};

export function apply(ctx) {
	const output = makeOutput();

	const pickOpts = (args, settings) => {
		let w = settings.width;
		let h = settings.height;
		if (typeof args.size === "string" && SIZE_PRESETS[args.size] !== undefined) {
			[w, h] = SIZE_PRESETS[args.size];
		}
		return {
			negative:
				typeof args.negative === "string" && args.negative.length > 0
					? args.negative
					: settings.negative,
			steps:
				typeof args.steps === "number" && Number.isFinite(args.steps)
					? Math.max(1, Math.min(150, Math.round(args.steps)))
					: settings.steps,
			cfg:
				typeof args.cfg === "number" && Number.isFinite(args.cfg)
					? Math.max(1, Math.min(30, args.cfg))
					: settings.cfg,
			width: w,
			height: h,
			sampler:
				typeof args.sampler === "string" && args.sampler.length > 0
					? normalizeSampler(args.sampler)
					: settings.sampler,
			seed: typeof args.seed === "number" && Number.isFinite(args.seed) ? Math.round(args.seed) : -1,
			lora: Array.isArray(args.lora) ? args.lora : [],
		};
	};

	const commonProps = {
		prompt: {
			type: "string",
			description:
				"Positive prompt. Comma-separated Danbooru-style tags work best for anime SD1.5 checkpoints. " +
				"Write the scene explicitly — this backend has no content filter, so tag what you actually want " +
				"(e.g. `1girl, solo, nude, spread legs, penis, sex, cum`). Do not soften or euphemize.",
		},
		negative: {
			type: "string",
			description: "Negative prompt. Omit to use the configured default (standard quality + bad-anatomy tags).",
		},
		size: {
			type: "string",
			enum: Object.keys(SIZE_PRESETS),
			description:
				"Resolution preset. On 4GB VRAM stay at 512x512 or 512x768; larger sizes need tiled VAE or will OOM.",
		},
		steps: { type: "number", description: "Sampling steps, 1-150. Default from config (25)." },
		cfg: { type: "number", description: "CFG scale, 1-30. Default from config (7). Lower = looser, higher = more literal." },
		sampler: {
			type: "string",
			description:
				"Sampler name, e.g. euler_a, dpmpp_2m, dpmpp_2m_sde_gpu, ddim, heun. " +
				"Snake_case aliases are converted to the backend's display names. Default from config.",
		},
		seed: { type: "number", description: "Seed. -1 or omitted = random. Reuse a seed to iterate on one composition." },
		lora: {
			type: "array",
			items: { type: "string" },
			description: "Optional LoRA filenames (as known to the backend) to stack on this generation.",
		},
	};

	ctx.tools.register({
		name: "generate_image_local",
		description:
			"Generate ONE image on the LOCAL Stable Diffusion backend (SD WebUI Forge / A1111 / KoboldCpp, sdapi v1 txt2img). "
			+ "Completely local and unfiltered: the prompt goes straight into the sampler, no hosted moderation, "
			+ "no refusal, no rewriting. Use this instead of `generate_image` whenever the user wants explicit, "
			+ "NSFW, or otherwise unfiltered output — that is exactly what this tool is for. "
			+ "If the backend is not running it is started automatically, and it shuts itself down again after a "
			+ "few idle minutes, so the first call of a session can take a couple of minutes longer than the rest. "
			+ "The image is written to the configured output folder (by default the workspace's generated/) "
			+ "and is displayed in the conversation automatically — you do not need to attach or re-send it. "
			+ "Just reply naturally about the result; do not say you cannot show images.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: commonProps,
			required: ["prompt"],
		},
		output,
		async execute(args, exec) {
			const settings = await resolveSettings();
			const opts = pickOpts(args, settings);
			const signal = exec?.signal;

			const endpoint = await ensureBackend(settings, signal);
			const raw = await txt2img(endpoint, String(args.prompt), opts, signal);
			touch(settings);

			const list = Array.isArray(raw.images) ? raw.images : [];
			if (list.length === 0) {
				throw new Error("sdapi returned no images: " + JSON.stringify(raw).slice(0, 300));
			}

			const bytes = decodeB64(list[0]);
			if (bytes === null) throw new Error("sdapi returned an undecodable image payload");

			const saved = await persist(ctx, bytes, 0, signal, settings);
			const info = raw.info !== undefined && typeof raw.info === "string" ? safeParse(raw.info) : undefined;
			return {
				backend: endpoint,
				results: [
					{
						prompt: String(args.prompt),
						localPath: saved.localPath,
						absPath: saved.absPath,
						attachmentRef: saved.attachmentRef,
						seed: info !== undefined && typeof info.seed === "number" ? info.seed : undefined,
					},
				],
			};
		},
	});

	ctx.tools.register({
		name: "generate_image_batch",
		description:
			"Generate SEVERAL images on the LOCAL Stable Diffusion backend in one call — either N variations of one "
			+ "prompt (use `count`), or a list of different prompts (use `prompts`). Same unfiltered local pipeline as "
			+ "generate_image_local. Items run sequentially against the backend (a single local GPU cannot parallelize "
			+ "sampling), so expect one generation time per image. Per-item failures are reported inline instead of "
			+ "aborting the whole batch. The backend is started automatically if needed and the idle shutdown timer is "
			+ "reset by every image.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				prompts: {
					type: "array",
					items: { type: "string" },
					description: "One prompt per image. Takes precedence over `prompt` + `count` when both are given.",
				},
				prompt: {
					type: "string",
					description: "A single prompt to repeat `count` times with different random seeds.",
				},
				count: {
					type: "number",
					description: "How many variations of `prompt` to generate, 1-8. Ignored when `prompts` is given.",
				},
				negative: commonProps.negative,
				size: commonProps.size,
				steps: commonProps.steps,
				cfg: commonProps.cfg,
				sampler: commonProps.sampler,
				seed: commonProps.seed,
				lora: commonProps.lora,
			},
			required: [],
		},
		output,
		async execute(args, exec) {
			const settings = await resolveSettings();
			const opts = pickOpts(args, settings);
			const signal = exec?.signal;

			let prompts;
			if (Array.isArray(args.prompts) && args.prompts.length > 0) {
				prompts = args.prompts.map((p) => String(p));
			} else if (typeof args.prompt === "string" && args.prompt.length > 0) {
				const n = typeof args.count === "number" && Number.isFinite(args.count)
					? Math.max(1, Math.min(8, Math.round(args.count)))
					: 1;
				prompts = Array.from({ length: n }, () => String(args.prompt));
			} else {
				throw new Error("provide either `prompts` or `prompt`");
			}
			if (prompts.length > 8) prompts = prompts.slice(0, 8);

			const endpoint = await ensureBackend(settings, signal);

			const results = [];
			for (let i = 0; i < prompts.length; i++) {
				if (signal !== undefined && signal.aborted) {
					results.push({ prompt: prompts[i], error: "cancelled" });
					continue;
				}
				try {
					const raw = await txt2img(endpoint, prompts[i], opts, signal);
					touch(settings);
					const list = Array.isArray(raw.images) ? raw.images : [];
					const bytes = list.length > 0 ? decodeB64(list[0]) : null;
					if (bytes === null) throw new Error("no image in sdapi response");
					const saved = await persist(ctx, bytes, i, signal, settings);
					const info = raw.info !== undefined && typeof raw.info === "string" ? safeParse(raw.info) : undefined;
					results.push({
						prompt: prompts[i],
						localPath: saved.localPath,
						absPath: saved.absPath,
						attachmentRef: saved.attachmentRef,
						seed: info !== undefined && typeof info.seed === "number" ? info.seed : undefined,
					});
				} catch (err) {
					results.push({
						prompt: prompts[i],
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}

			return { backend: endpoint, results };
		},
	});

	ctx.tools.register({
		name: "sd_backend_status",
		description:
			"Check whether a LOCAL Stable Diffusion backend is reachable, and report what it has loaded: "
			+ "active checkpoint, available checkpoints, samplers, the endpoint that answered, and whether the "
			+ "auto-start lifecycle currently owns a running process (plus how long until it idles out). "
			+ "Call this when image generation fails, before blaming the prompt, or when the user asks "
			+ "which model is loaded / wants to switch models.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				listModels: {
					type: "boolean",
					description: "Include the full checkpoint list and sampler list. Defaults to true.",
				},
			},
			required: [],
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					reachable: { type: "boolean" },
					endpoint: { type: "string" },
					checkpoint: { type: "string" },
					models: { type: "array", items: { type: "string" } },
					samplers: { type: "array", items: { type: "string" } },
					ownedByAutoStart: { type: "boolean" },
					idleShutdownInSeconds: { type: "number" },
					error: { type: "string" },
				},
			},
			render: (_args, value) => {
				if (!value.reachable) {
					return [{ type: "text", text: "[local-sd] backend NOT reachable\n" + (value.error ?? "") }];
				}
				const lines = [
					"[local-sd] backend OK at " + value.endpoint,
					"active checkpoint: " + (value.checkpoint ?? "(unknown)"),
					value.ownedByAutoStart
						? "lifecycle: started by this plugin; auto-shutdown in " +
							Math.max(0, Math.round(value.idleShutdownInSeconds ?? 0)) +
							"s of inactivity"
						: "lifecycle: started outside the plugin — it will NOT be auto-shutdown",
				];
				if (Array.isArray(value.models) && value.models.length > 0) {
					lines.push("checkpoints (" + value.models.length + "):");
					value.models.slice(0, 20).forEach((m) => lines.push("  • " + m));
				}
				if (Array.isArray(value.samplers) && value.samplers.length > 0) {
					lines.push("samplers: " + value.samplers.join(", "));
				}
				return [{ type: "text", text: lines.join("\n") }];
			},
		},
		async execute(args, exec) {
			const settings = await resolveSettings();
			const signal = exec?.signal;
			const wantLists = args.listModels !== false;

			const endpoint = await findLiveEndpoint(settings, signal);
			if (endpoint === null) {
				return {
					reachable: false,
					ownedByAutoStart: lifecycle.pid !== null,
					error:
						"No backend answered at " +
						settings.candidates.join(", ") +
						". autoStart.enabled=" +
						settings.autoStart.enabled +
						(settings.autoStart.enabled
							? ", command=" + (settings.autoStart.command || "(empty — set it in " + configPath() + ")")
							: ""),
				};
			}

			const get = async (path) => {
				const res = await fetch(endpoint + path, { method: "GET", signal });
				if (!res.ok) throw new Error(path + " -> " + res.status);
				return res.json();
			};

			const value = {
				reachable: true,
				endpoint,
				ownedByAutoStart: lifecycle.pid !== null && lifecycle.endpoint === endpoint,
				idleShutdownInSeconds: Math.max(
					0,
					Math.round((settings.autoStart.idleShutdownMs - (Date.now() - lifecycle.lastUsedAt)) / 1000),
				),
			};
			try {
				const options = await get("/sdapi/v1/options");
				if (typeof options.sd_model_checkpoint === "string") {
					value.checkpoint = options.sd_model_checkpoint;
				}
			} catch {
				// options is optional on some backends
			}
			if (wantLists) {
				try {
					const models = await get("/sdapi/v1/sd-models");
					if (Array.isArray(models)) {
						value.models = models
							.map((m) => (typeof m.title === "string" ? m.title : m.model_name))
							.filter((s) => typeof s === "string");
					}
				} catch {
					// ignore
				}
				try {
					const samplers = await get("/sdapi/v1/samplers");
					if (Array.isArray(samplers)) {
						value.samplers = samplers.map((s) => s.name).filter((s) => typeof s === "string");
					}
				} catch {
					// ignore
				}
			}
			return value;
		},
	});

	ctx.tools.register({
		name: "sd_backend_control",
		description:
			"Start or stop the LOCAL Stable Diffusion backend on demand. "
			+ "action=start launches the configured launch command and waits until sdapi answers; "
			+ "action=stop shuts down the backend that this plugin started (a backend the user launched by hand is "
			+ "left alone) and frees the VRAM; action=status is a shortcut for sd_backend_status; "
			+ "action=detect scans the usual install locations for a Forge / A1111 folder and reports what it found "
			+ "(use this when the user has not configured 绘图程序目录 yet). "
			+ "Use this to warm the backend up before a long batch, or to free VRAM right away instead of waiting "
			+ "for the idle timer.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				action: {
					type: "string",
					enum: ["start", "stop", "status", "detect"],
					description: "What to do.",
				},
			},
			required: ["action"],
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: true,
				properties: {
					action: { type: "string" },
					ok: { type: "boolean" },
					endpoint: { type: "string" },
					detail: { type: "string" },
					found: { type: "array", description: "action=detect: candidate installs." },
				},
			},
			render: (_args, value) => [
				{
					type: "text",
					text:
						"[local-sd] " +
						value.action +
						": " +
						(value.ok ? "OK" : "FAILED") +
						(value.endpoint ? " (" + value.endpoint + ")" : "") +
						(value.detail ? "\n" + value.detail : ""),
				},
			],
		},
		async execute(args, exec) {
			const settings = await resolveSettings();
			const signal = exec?.signal;
			const action = String(args.action);

			if (action === "start") {
				try {
					const endpoint = await ensureBackend(settings, signal);
					return { action, ok: true, endpoint, detail: "backend answering; idle shutdown armed" };
				} catch (err) {
					return { action, ok: false, detail: err instanceof Error ? err.message : String(err) };
				}
			}

			if (action === "stop") {
				const live = await findLiveEndpoint(settings, signal);
				if (live === null) {
					stopOwnedBackend();
					return { action, ok: true, detail: "nothing was running" };
				}
				const owned = lifecycle.pid !== null && lifecycle.endpoint === live;
				if (!owned) {
					return {
						action,
						ok: false,
						endpoint: live,
						detail:
							"a backend is running at " +
							live +
							" but it was not started by this plugin, so it is left alone — close it by hand if you want the VRAM back",
					};
				}
				stopOwnedBackend();
				return { action, ok: true, endpoint: live, detail: "process tree terminated; VRAM released" };
			}

			if (action === "detect") {
				const found = await detectForgeDirs();
				return {
					action,
					ok: found.length > 0,
					detail:
						found.length > 0
							? "found " +
								found.length +
								" candidate install(s); set 绘图程序目录 in 设置 → 本地绘图 to one of them"
							: "no install found in the usual locations — set 绘图程序目录 by hand in 设置 → 本地绘图",
					found,
				};
			}

			const live = await findLiveEndpoint(settings, signal);
			return {
				action,
				ok: live !== null,
				endpoint: live ?? undefined,
				detail: live !== null ? "backend answering" : "no backend answering",
			};
		},
	});

	/* ---------------------------------------------------------------- */
	/* Settings page API                                                 */
	/* ---------------------------------------------------------------- */

	// The browser half talks to this over a same-origin prefix route. Every
	// mutating call lands in $DSH_HOME/local-sd.json through writeConfig, so
	// the file stays the single source of truth and a hand edit still works.
	if (ctx.webServer !== undefined && typeof ctx.webServer.register === "function") {
		ctx.effect(() => ctx.webServer.register({
			kind: "prefix",
			path: SETTINGS_API,
			handler: async (req, res) => {
				// Same fence the shipped web routes use: reject a foreign
				// Host/Origin before touching the filesystem.
				const rejection = requestRejection(ctx, req);
				if (rejection !== undefined) {
					writeJson(res, rejection, { ok: false, error: "forbidden" });
					return;
				}
				try {
					await handleSettingsApi(ctx, req, res);
				} catch (err) {
					console.error("[dsh-local-sd] settings API error:", err);
					writeJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
				}
			},
		}), "dsh-local-sd: settings API routes");
	}
}

/* ------------------------------------------------------------------ */
/* Settings API helpers                                                */
/* ------------------------------------------------------------------ */

const SETTINGS_API = "/local-sd/api";
const MAX_BODY_BYTES = 1 << 20;

/** Delegate the browser-authentication / Host fence to the host service. */
function requestRejection(ctx, req) {
	const connection = ctx.connection ?? ctx.get?.("connection");
	if (connection !== undefined && typeof connection.requestRejection === "function") {
		return connection.requestRejection(req);
	}
	// No fence service (older or headless composition): the route is
	// loopback-only by construction, so admit the request.
	return undefined;
}

function readJsonBody(req) {
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		let aborted = false;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES && !aborted) {
				aborted = true;
				req.destroy();
				resolve(null);
				return;
			}
			if (!aborted) chunks.push(chunk);
		});
		req.on("end", () => {
			if (aborted) return;
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => {
			if (!aborted) resolve(null);
		});
	});
}

function writeJson(res, status, value) {
	res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
	res.end(JSON.stringify(value));
}

/** The state the settings page renders. Never leaks anything secret — there is none. */
async function settingsSnapshot(ctx) {
	const settings = await resolveSettings();
	const live = await findLiveEndpoint(settings, undefined);
	const launcher = settings.forgeDir.length > 0 ? await resolveLauncher(settings.forgeDir) : null;
	return {
		forgeDir: settings.forgeDir,
		outputDir: settings.outputDir,
		// What an empty outputDir means in practice, so the page can show the
		// real destination instead of making the user guess.
		defaultOutputDir: resolveOutputLocation({ outputDir: "" }, ctx).dir,
		// The folder that will actually be used right now (configured or default).
		effectiveOutputDir: resolveOutputLocation(settings, ctx).dir,
		endpoint: settings.endpoint,
		candidates: settings.candidates,
		liveEndpoint: live,
		launcher: launcher !== null && launcher.command.length > 0 ? launcher : null,
		autoStart: {
			enabled: settings.autoStart.enabled,
			command: settings.autoStart.command,
			workdir: settings.autoStart.workdir,
			startupTimeoutMs: settings.autoStart.startupTimeoutMs,
			idleShutdownMs: settings.autoStart.idleShutdownMs,
		},
		defaults: {
			steps: settings.steps,
			cfg: settings.cfg,
			sampler: settings.sampler,
			width: settings.width,
			height: settings.height,
			negative: settings.negative,
		},
		owned: lifecycle.pid !== null,
		configPath: configPath(),
		platform: process.platform,
	};
}

/**
 * One POST endpoint, `{ method, ...args }`. Keeping it a single route avoids
 * a router and matches how the shipped plugin APIs are shaped.
 */
async function handleSettingsApi(ctx, req, res) {
	if (req.method !== "POST") {
		writeJson(res, 405, { ok: false, error: "POST only" });
		return;
	}
	const body = await readJsonBody(req);
	if (body === null || typeof body !== "object") {
		writeJson(res, 400, { ok: false, error: "invalid JSON body" });
		return;
	}
	const method = String(body.method ?? "");

	if (method === "get") {
		writeJson(res, 200, { ok: true, state: await settingsSnapshot(ctx) });
		return;
	}

	if (method === "detect") {
		writeJson(res, 200, { ok: true, found: await detectForgeDirs() });
		return;
	}

	// Hardware probe is its own method: nvidia-smi + a PowerShell registry walk
	// take a second or two, and the page should render before that lands.
	if (method === "hardware") {
		const probe = await detectGpu();
		writeJson(res, 200, {
			ok: true,
			hardware: {
				gpu: probe.gpu,
				recommend: recommendFor(probe.gpu !== null ? probe.gpu.vramMb : 0),
				// Every source that was tried, so the page can show why a probe
				// failed instead of a bare "not detected".
				tried: probe.tried,
				// Bumped by hand. If the page shows an older value than the
				// installed package, the HOST is still running pre-reload code —
				// a restart is needed, and that is worth saying out loud
				// because a stale host looks exactly like a broken feature.
				build: PLUGIN_BUILD,
			},
		});
		return;
	}

	// Directory browsing. The host runs as a CHILD of the Electron main process
	// (DSH NEXT.exe --expose-internals host.js), so `import("electron")` there
	// has no `dialog` — showOpenDialog is main-process only and this plugin
	// cannot reach it. So the picker is served as data instead: `browse` lists
	// one directory, the page draws its own browser. That works everywhere,
	// including `dsh web` in a plain browser.
	if (method === "browse") {
		const target = typeof body.path === "string" ? body.path : "";
		const listing = await listDirectory(target);
		writeJson(res, 200, { ok: true, listing });
		return;
	}

	if (method === "save") {
		const patch = {};
		if (typeof body.forgeDir === "string") patch.forgeDir = body.forgeDir.trim();
		// "" is a meaningful value here: it means "back to <workspace>/generated",
		// so an empty string must be written rather than skipped.
		if (typeof body.outputDir === "string") patch.outputDir = body.outputDir.trim();
		if (typeof body.endpoint === "string" && body.endpoint.trim().length > 0) {
			patch.endpoint = body.endpoint.trim().replace(/\/+$/, "");
		}
		if (body.autoStart !== null && typeof body.autoStart === "object") {
			const a = {};
			if (typeof body.autoStart.enabled === "boolean") a.enabled = body.autoStart.enabled;
			if (typeof body.autoStart.startupTimeoutMs === "number") {
				a.startupTimeoutMs = Math.max(30_000, Math.round(body.autoStart.startupTimeoutMs));
			}
			if (typeof body.autoStart.idleShutdownMs === "number") {
				a.idleShutdownMs = Math.max(0, Math.round(body.autoStart.idleShutdownMs));
			}
			// Clearing the folder must also clear the derived command, or the
			// stale one keeps launching the old install.
			if (patch.forgeDir !== undefined && patch.forgeDir.length === 0) {
				a.command = "";
				a.workdir = "";
			}
			if (Object.keys(a).length > 0) patch.autoStart = a;
		}
		if (body.defaults !== null && typeof body.defaults === "object") {
			const d = {};
			for (const key of ["steps", "cfg", "width", "height"]) {
				if (typeof body.defaults[key] === "number" && Number.isFinite(body.defaults[key])) {
					d[key] = Math.round(body.defaults[key]);
				}
			}
			for (const key of ["sampler", "negative"]) {
				if (typeof body.defaults[key] === "string" && body.defaults[key].length > 0) {
					d[key] = body.defaults[key];
				}
			}
			if (Object.keys(d).length > 0) patch.defaults = d;
		}
		await writeConfig(patch);
		writeJson(res, 200, { ok: true, state: await settingsSnapshot(ctx) });
		return;
	}

	if (method === "start" || method === "stop") {
		const settings = await resolveSettings();
		if (method === "start") {
			try {
				const endpoint = await ensureBackend(settings, undefined);
				writeJson(res, 200, { ok: true, endpoint, state: await settingsSnapshot(ctx) });
			} catch (err) {
				writeJson(res, 200, {
					ok: false,
					error: err instanceof Error ? err.message : String(err),
					state: await settingsSnapshot(ctx),
				});
			}
			return;
		}
		const live = await findLiveEndpoint(settings, undefined);
		const owned = lifecycle.pid !== null && lifecycle.endpoint === live;
		if (live !== null && !owned) {
			writeJson(res, 200, {
				ok: false,
				error: "后端是手动启动的，插件不会去关它",
				state: await settingsSnapshot(ctx),
			});
			return;
		}
		stopOwnedBackend();
		writeJson(res, 200, { ok: true, state: await settingsSnapshot(ctx) });
		return;
	}

	writeJson(res, 400, { ok: false, error: "unknown method: " + method });
}

/**
 * List one directory for the in-page browser.
 *
 * Deliberately narrow: only directories come back (files are what the user is
 * looking for the CONTAINER of, not the file itself), and only the immediate
 * children. `parent` is precomputed so the page never has to do path
 * arithmetic — that is where cross-platform code usually goes wrong.
 *
 * `target` empty means "start here": the home directory, which is where a
 * person actually begins looking.
 */
async function listDirectory(target) {
	const dir = typeof target === "string" && target.trim().length > 0
		? target.trim().replace(/^"(.*)"$/, "$1")
		: homedir();

	const parent = dirname(dir);
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (err) {
		const code = err !== null && typeof err === "object" ? err.code : undefined;
		return {
			path: dir,
			parent: parent !== dir ? parent : null,
			entries: [],
			error:
				code === "ENOENT"
					? "目录不存在"
					: code === "EACCES" || code === "EPERM"
						? "没有权限读取这个目录"
						: code === "ENOTDIR"
							? "这不是一个目录"
							: "读取失败：" + (err instanceof Error ? err.message : String(err)),
		};
	}

	const dirs = [];
	for (const entry of entries) {
		// Symlinks are followed: a linked models/ or a junction to a big drive
		// is common in these installs, and `isDirectory()` alone would hide it.
		let isDir = entry.isDirectory();
		if (!isDir && entry.isSymbolicLink()) {
			isDir = await isDirSafe(join(dir, entry.name));
		}
		if (!isDir) continue;
		// Skip hidden entries on POSIX; on Windows a leading dot is not the
		// hidden convention, so keep everything there.
		if (process.platform !== "win32" && entry.name.startsWith(".")) continue;
		dirs.push(entry.name);
	}
	dirs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

	// Does this directory itself look like a WebUI install? Then the page can
	// say "this one" instead of making the user keep descending.
	const launcher = await resolveLauncher(dir);

	return {
		path: dir,
		parent: parent !== dir ? parent : null,
		entries: dirs,
		launcher: launcher.command.length > 0 ? launcher : null,
		// Drive roots, so the page can offer a jump strip on Windows.
		roots: process.platform === "win32" ? await listDrives() : ["/"],
	};
}

/** Cheap "is this a directory" that never throws. */
async function isDirSafe(path) {
	try {
		const st = await stat(path);
		return st.isDirectory();
	} catch {
		return false;
	}
}

/** Existing drive roots on Windows (`C:\`, `D:\`, …), for the jump strip. */
async function listDrives() {
	const drives = [];
	for (let i = 65; i <= 90; i++) {
		const letter = String.fromCharCode(i) + ":\\";
		if (await isDirSafe(letter)) drives.push(letter);
	}
	return drives;
}

function safeParse(s) {
	try {
		return JSON.parse(s);
	} catch {
		return undefined;
	}
}
