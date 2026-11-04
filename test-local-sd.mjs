import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { internals } from "./lib/index.js";

const { resolveLauncher } = internals;

let passed = 0;
async function test(name, fn) {
	try {
		await fn();
		passed += 1;
		console.log("  ok   " + name);
	} catch (err) {
		console.error("  FAIL " + name);
		throw err;
	}
}

const root = await mkdtemp(join(tmpdir(), "local-sd-test-"));
const forgeDir = join(root, "webui_forge_cu124_torch24");
await mkdir(join(forgeDir, "webui"), { recursive: true });
await writeFile(join(forgeDir, "run.bat"), "@echo off\r\n");
await writeFile(join(forgeDir, "webui", "webui.bat"), "@echo off\r\n");

try {
	await test("empty input resolves to nothing", async () => {
		const r = await resolveLauncher("");
		assert.equal(r.command, "");
	});

	await test("absolute directory finds run.bat", async () => {
		const r = await resolveLauncher(forgeDir);
		assert.equal(r.command, join(forgeDir, "run.bat"));
		assert.equal(r.workdir, forgeDir);
		assert.equal(r.launcher, "run.bat");
	});

	await test("trailing quote / whitespace tolerated", async () => {
		const r = await resolveLauncher('  "' + forgeDir + '"  ');
		assert.equal(r.command, join(forgeDir, "run.bat"));
	});

	await test("pointing at the launcher file itself works", async () => {
		const r = await resolveLauncher(join(forgeDir, "run.bat"));
		assert.equal(r.command, join(forgeDir, "run.bat"));
		assert.equal(r.workdir, forgeDir);
	});

	await test("relative directory is resolved to an absolute path", async () => {
		// The Windows launcher does `cd /d "<workdir>"`; a relative workdir there
		// makes cmd fail with a syntax error instead of a readable message.
		const cwd = process.cwd();
		process.chdir(root);
		try {
			const r = await resolveLauncher("webui_forge_cu124_torch24");
			assert.ok(r.command.startsWith(root), "command should be absolute, got " + r.command);
			assert.ok(r.workdir.startsWith(root), "workdir should be absolute, got " + r.workdir);
		} finally {
			process.chdir(cwd);
		}
	});

	await test("relative launcher file is resolved to an absolute path", async () => {
		const cwd = process.cwd();
		process.chdir(forgeDir);
		try {
			const r = await resolveLauncher("run.bat");
			assert.ok(r.command.startsWith(forgeDir), "command should be absolute, got " + r.command);
		} finally {
			process.chdir(cwd);
		}
	});

	await test("missing directory resolves to nothing", async () => {
		const r = await resolveLauncher(join(root, "does-not-exist"));
		assert.equal(r.command, "");
	});

	await test("directory without a launcher resolves to nothing", async () => {
		const empty = join(root, "empty");
		await mkdir(empty, { recursive: true });
		const r = await resolveLauncher(empty);
		assert.equal(r.command, "");
	});

	console.log("\n" + passed + " passed");
} finally {
	await rm(root, { recursive: true, force: true });
}
