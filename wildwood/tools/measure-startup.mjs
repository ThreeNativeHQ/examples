/**
 * Cold-start measurement: how long until the valley is playable, and what the player sees first.
 *
 * Runs N cold browser contexts (no cache, fresh profile each) against a dev server, headed with
 * WebGPU under the capture lock's private display, and records per run:
 *   - navigation → DOMContentLoaded, every `TN_*` console marker with its wall time,
 *     `window.__TN_STARTUP_READY__` (the engine's readiness global), and `TN_VALLEY_BUILT`;
 *   - transferred bytes, the ten largest resources, and the bytes that landed before the valley
 *     was built (the "critical" transfer) versus in total;
 *   - a coarse frame sample every 200 ms: mean RGB of a screenshot, so the first frame is
 *     classified as white/blank, authored loading view, or world.
 * Writes artifacts/startup/<label>.json plus a Markdown table to stdout.
 *
 *   tools/capture-lock.sh node tools/measure-startup.mjs --runs 5 --label baseline [--query "?lowtier"]
 */
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

// pngjs ships with the installed playtest package; this tool borrows it rather than adding a
// dependency the game itself never needs.
const { PNG } = createRequire(import.meta.resolve("@threenative/playtest"))(
	"pngjs",
);

const args = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const RUNS = Number(opt("runs", "3"));
const LABEL = opt("label", "run");
const QUERY = opt("query", "");
const PORT = Number(opt("port", "5279"));
const READY_TIMEOUT_MS = Number(opt("timeout", "60000"));
const VALIDATE = opt("validate", "");
const PROFILE = opt("profile", "phase0");
const SERVER = opt("server", "preview");
const DETAIL_TIMEOUT_MS = Number(opt("detail-timeout", "8000"));
const EXPECT_DETAIL_REJECTION = opt("expect-detail-rejection", "");
const EXPECT_VENDOR = opt("adapter-vendor", "");
const EXPECT_ARCHITECTURE = opt("adapter-architecture", "");
const BASE = `http://127.0.0.1:${PORT}/${QUERY}`;

if (!Number.isInteger(RUNS) || RUNS < 1)
	throw new Error(`--runs must be a positive integer, got ${RUNS}`);
if (!Number.isFinite(READY_TIMEOUT_MS) || READY_TIMEOUT_MS < 1) {
	throw new Error(
		`--timeout must be a positive millisecond value, got ${READY_TIMEOUT_MS}`,
	);
}
if (!Number.isFinite(DETAIL_TIMEOUT_MS) || DETAIL_TIMEOUT_MS < 1) {
	throw new Error(
		`--detail-timeout must be a positive millisecond value, got ${DETAIL_TIMEOUT_MS}`,
	);
}
if (PROFILE !== "phase0" && PROFILE !== "phase2") {
	throw new Error(`--profile must be phase0 or phase2, got ${PROFILE}`);
}
if (SERVER !== "dev" && SERVER !== "preview") {
	throw new Error(`--server must be dev or preview, got ${SERVER}`);
}

const WEBGPU_ARGS = [
	"--ozone-platform=x11",
	"--enable-unsafe-webgpu",
	"--disable-gpu-sandbox",
	"--ignore-gpu-blocklist",
	"--enable-features=Vulkan",
];

function startVite() {
	const child = spawn(
		"npx",
		[
			"vite",
			SERVER,
			"--host",
			"127.0.0.1",
			"--port",
			String(PORT),
			"--strictPort",
		],
		{ stdio: ["ignore", "pipe", "inherit"] },
	);
	child.stdout.on("data", () => undefined);
	return child;
}

async function waitForServer(url, ms) {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			/* not yet */
		}
		await sleep(250);
	}
	throw new Error(`dev server did not answer at ${url}`);
}

/** Mean RGB and the fraction of near-white pixels of a PNG buffer. */
function classify(png) {
	const img = PNG.sync.read(png);
	let r = 0;
	let g = 0;
	let b = 0;
	let white = 0;
	const n = img.width * img.height;
	for (let i = 0; i < n; i += 1) {
		const R = img.data[i * 4];
		const G = img.data[i * 4 + 1];
		const B = img.data[i * 4 + 2];
		r += R;
		g += G;
		b += B;
		if (R > 235 && G > 235 && B > 235) white += 1;
	}
	const mean = [r / n, g / n, b / n].map((v) => Math.round(v));
	return { mean, whiteRatio: Number((white / n).toFixed(3)) };
}

function formatAdapter(adapterInfo) {
	return `${adapterInfo.vendor} | ${adapterInfo.architecture} | ${adapterInfo.device} ${adapterInfo.description}`.trim();
}

function requireObservation(name, value) {
	if (value === undefined || value === null || value === "" || value === -1) {
		throw new Error(`required startup observation missing: ${name}`);
	}
	return value;
}

function validateRun(run) {
	if (
		!run.markers.some((marker) => marker.text.startsWith("TN_VALLEY_BUILT"))
	) {
		throw new Error(
			"required startup observation missing: TN_VALLEY_BUILT marker",
		);
	}
	requireObservation("first frame metadata", run.firstFrame);
	requireObservation("first frame capture path", run.firstFramePath);
	if (
		!run.adapterInfo ||
		!Object.values(run.adapterInfo).some((value) => value.length > 0)
	) {
		throw new Error(
			"required startup observation missing: WebGPU adapter info",
		);
	}
	if (PROFILE !== "phase2") return;
	if (
		!run.markers.some((marker) =>
			marker.text.startsWith("TN_LOADING_VIEW_READY"),
		)
	) {
		throw new Error(
			"required startup observation missing: TN_LOADING_VIEW_READY marker",
		);
	}
	if (run.firstFrame.whiteRatio >= 0.9) {
		throw new Error(
			`TN_STARTUP_WHITE_FRAME: first captured frame white ratio ${String(run.firstFrame.whiteRatio)}`,
		);
	}
	if (!Number.isFinite(run.criticalMb) || run.criticalMb < 0) {
		throw new Error("required startup observation missing: critical transfer bytes");
	}
	if (!Number.isFinite(run.totalMb) || run.totalMb <= 0) {
		throw new Error("required startup observation missing: total transfer bytes");
	}
	if (!Array.isArray(run.resourceCensus) || run.resourceCensus.length === 0) {
		throw new Error("required startup observation missing: complete resource census");
	}
	if (run.pendingResourceCount !== 0) {
		throw new Error(
			`TN_STARTUP_CENSUS_INCOMPLETE: ${String(run.pendingResourceCount)} responses did not finish`,
		);
	}
	if (!Number.isFinite(run.detailStartMs) || run.detailStartMs < 0) {
		throw new Error("required startup observation missing: detail start marker");
	}
	if (!Number.isFinite(run.detailTerminalMs) || run.detailTerminalMs < 0) {
		throw new Error("required startup observation missing: detail terminal marker");
	}
	if (!Number.isFinite(run.detailDurationMs) || run.detailDurationMs < 0) {
		throw new Error("required startup observation missing: detail duration");
	}
	if (!Array.isArray(run.postEntryLongTasks)) {
		throw new Error("required startup observation missing: post-entry long tasks");
	}
	const longest = run.postEntryLongTasks.reduce(
		(maximum, task) => Math.max(maximum, task.duration),
		0,
	);
	if (longest > 100) {
		throw new Error(
			`TN_STARTUP_LONG_TASK: ${String(longest)} ms after valley entry exceeds 100 ms`,
		);
	}
	if (run.criticalMb > 25) {
		throw new Error(
			`TN_STARTUP_CRITICAL_BYTES: ${String(run.criticalMb)} MB exceeds 25 MB`,
		);
	}
	if (run.detailDurationMs > DETAIL_TIMEOUT_MS) {
		// Fatal against the built bundle, reported against a dev server. `vite dev` hands every
		// GLB, OGG and HDR to the game one unbundled request at a time through a single
		// middleware chain, so it queues thirty-five large binaries where the built bundle
		// streams them: the same content measures 6.9 s on preview and past 25 s on dev. A
		// budget enforced there is measuring vite, and the number it prints names nothing a
		// game author can fix.
		if (SERVER === "dev") {
			process.stderr.write(
				`TN_STARTUP_DETAIL_ADVISORY: ${String(run.detailDurationMs)} ms exceeds ${String(DETAIL_TIMEOUT_MS)} ms, not enforced because --server dev serves assets one request at a time; re-run with --server preview to enforce it\n`,
			);
		} else {
			throw new Error(
				`TN_STARTUP_DETAIL_TIMEOUT: ${String(run.detailDurationMs)} ms exceeds ${String(DETAIL_TIMEOUT_MS)} ms`,
			);
		}
	}
	if (
		EXPECT_VENDOR !== "" &&
		run.adapterInfo.vendor.toLowerCase() !== EXPECT_VENDOR.toLowerCase()
	) {
		throw new Error(
			`TN_STARTUP_ADAPTER: expected vendor ${EXPECT_VENDOR}, got ${run.adapterInfo.vendor}`,
		);
	}
	if (
		EXPECT_ARCHITECTURE !== "" &&
		run.adapterInfo.architecture.toLowerCase() !==
			EXPECT_ARCHITECTURE.toLowerCase()
	) {
		throw new Error(
			`TN_STARTUP_ADAPTER: expected architecture ${EXPECT_ARCHITECTURE}, got ${run.adapterInfo.architecture}`,
		);
	}
	const detailTerminal = run.markers.find(
		(marker) =>
			marker.text.startsWith("TN_VALLEY_DETAIL_DONE") ||
			marker.text.startsWith("TN_VALLEY_DETAIL_REJECTED"),
	)?.text;
	requireObservation("detail terminal text", detailTerminal);
	if (
		EXPECT_DETAIL_REJECTION !== "" &&
		!detailTerminal.includes(`asset=${EXPECT_DETAIL_REJECTION}`)
	) {
		throw new Error(
			`TN_STARTUP_DETAIL_REJECTION: expected named asset ${EXPECT_DETAIL_REJECTION}, got ${detailTerminal}`,
		);
	}
	if (
		EXPECT_DETAIL_REJECTION === "" &&
		!detailTerminal.startsWith("TN_VALLEY_DETAIL_DONE")
	) {
		throw new Error(
			`TN_STARTUP_DETAIL_REJECTION: unexpected detail rejection ${detailTerminal}`,
		);
	}
}

function validationFixture() {
	return {
		markers: [
			{ t: 1, text: "TN_LOADING_VIEW_READY" },
			{ t: 100, text: "TN_VALLEY_BUILT" },
			{ t: 101, text: "TN_VALLEY_DETAIL_START" },
			{ t: 500, text: "TN_VALLEY_DETAIL_DONE" },
		],
		firstFrame: { t: 1, mean: [8, 18, 12], whiteRatio: 0 },
		firstFramePath: "artifacts/startup/fixture-run-1-first-frame.png",
		adapterInfo: {
			vendor: "test",
			architecture: "test",
			device: "test",
			description: "test",
		},
		criticalMb: 10,
		totalMb: 20,
		resourceCensus: [{ url: "/fixture", bytes: 20_000_000, doneAt: 500 }],
		pendingResourceCount: 0,
		detailStartMs: 101,
		detailTerminalMs: 500,
		detailDurationMs: 399,
		postEntryLongTasks: [],
	};
}

async function validateCleanupControl() {
	let contextClosed = false;
	let navigationRejected = false;
	const page = {
		on: () => undefined,
		screenshot: async () => {
			throw new Error("intentional screenshot failure");
		},
		goto: async () => {
			throw new Error("intentional navigation failure");
		},
	};
	const browser = {
		newContext: async () => ({
			newPage: async () => page,
			route: async () => undefined,
			newCDPSession: async () => ({
				on: () => undefined,
				send: async () => undefined,
			}),
			close: async () => {
				contextClosed = true;
			},
		}),
	};
	try {
		await oneRun(browser, 0);
	} catch (error) {
		if (error.message !== "intentional navigation failure") throw error;
		navigationRejected = true;
	}
	if (!navigationRejected)
		throw new Error("navigation failure did not reject the measurement");
	if (!contextClosed)
		throw new Error("navigation failure did not close its browser context");
	console.log("startup validation cleanup-navigation: passed");
}

async function runValidationControl(kind) {
	if (kind === "cleanup-navigation") {
		await validateCleanupControl();
		return;
	}
	const run = validationFixture();
	switch (kind) {
		case "valid":
			break;
		case "missing-valley":
			run.markers = [];
			break;
		case "missing-first-frame":
			run.firstFrame = undefined;
			run.firstFramePath = undefined;
			break;
		case "missing-adapter":
			run.adapterInfo = undefined;
			break;
		case "missing-bytes":
			run.resourceCensus = [];
			run.totalMb = undefined;
			break;
		case "missing-detail":
			run.markers = run.markers.filter(
				(marker) => !marker.text.startsWith("TN_VALLEY_DETAIL_"),
			);
			run.detailStartMs = undefined;
			run.detailTerminalMs = undefined;
			run.detailDurationMs = undefined;
			break;
		case "missing-long-tasks":
			run.postEntryLongTasks = undefined;
			break;
		case "white-frame":
			run.firstFrame = { t: 1, mean: [255, 255, 255], whiteRatio: 1 };
			break;
		case "over-long-task":
			run.postEntryLongTasks = [{ duration: 101, startTime: 200 }];
			break;
		default:
			throw new Error(`unknown --validate control: ${kind}`);
	}
	validateRun(run);
	console.log(`startup validation ${kind}: passed`);
}

async function waitForMarker(markers, predicate, timeoutMs, description) {
	const until = Date.now() + timeoutMs;
	while (Date.now() < until) {
		const marker = markers.find(predicate);
		if (marker !== undefined) return marker;
		await sleep(25);
	}
	throw new Error(`required startup observation missing: ${description}`);
}

async function oneRun(browser, index) {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 720 },
	});
	let sampling = false;
	let sampler;
	try {
		const page = await context.newPage();
		await page.addInitScript(() => {
			globalThis.__TN_STARTUP_LONG_TASKS__ = [];
			if (typeof PerformanceObserver === "undefined") return;
			try {
				const observer = new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) {
						globalThis.__TN_STARTUP_LONG_TASKS__.push({
							duration: entry.duration,
							startTime: entry.startTime,
						});
					}
				});
				observer.observe({ entryTypes: ["longtask"] });
			} catch {
				globalThis.__TN_STARTUP_LONG_TASKS__ = undefined;
			}
		});
		// Cold: no cache between runs, and the dev server's module graph is already warm, so what is
		// measured is the bytes and the work, not Vite's first transform.
		await context.route("**/*", (route) => route.continue());
		const cdp = await context.newCDPSession(page);
		await cdp.send("Network.enable");
		await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
		await cdp.send("Network.clearBrowserCache");

		const t0 = Date.now();
		const markers = [];
		const diagnostics = [];
		const resources = new Map();
		let bytes = 0;
		page.on("console", (message) => {
			const text = message.text();
			if (/^TN_[A-Z_]+/.test(text) || /^\[animals\]/.test(text)) {
				markers.push({ t: Date.now() - t0, text: text.slice(0, 120) });
			}
			if (["warning", "error"].includes(message.type())) {
				diagnostics.push({
					t: Date.now() - t0,
					type: "console",
					level: message.type(),
					text,
				});
			}
		});
		page.on("pageerror", (error) => {
			diagnostics.push({
				t: Date.now() - t0,
				type: "pageerror",
				text: error.stack ?? error.message,
			});
		});
		page.on("requestfailed", (request) => {
			diagnostics.push({
				t: Date.now() - t0,
				type: "requestfailed",
				url: request.url(),
				text: request.failure()?.errorText ?? "unknown request failure",
			});
		});
		page.on("response", (response) => {
			if (response.status() >= 400) {
				diagnostics.push({
					t: Date.now() - t0,
					type: "http",
					status: response.status(),
					url: response.url(),
					text: response.statusText(),
				});
			}
		});
		cdp.on("Network.responseReceived", (event) => {
			resources.set(event.requestId, {
				url: event.response.url,
				size: 0,
				t: Date.now() - t0,
			});
		});
		cdp.on("Network.loadingFinished", (event) => {
			const entry = resources.get(event.requestId);
			if (entry === undefined) return;
			entry.size = event.encodedDataLength;
			entry.done = Date.now() - t0;
			bytes += event.encodedDataLength;
		});

		const frames = [];
		let firstFramePng;
		const firstFramePath = `artifacts/startup/${LABEL}-run-${index + 1}-first-frame.png`;
		const startSampler = () => {
			sampling = true;
			sampler = (async () => {
			while (sampling) {
				try {
					const shot = await page.screenshot({ type: "png", scale: "css" });
					if (firstFramePng === undefined) firstFramePng = shot;
					frames.push({ t: Date.now() - t0, ...classify(shot) });
					// Phase 2 needs the first presented frame, not a continuous pixel workload. Repeated
					// WebGPU screenshots stall the page being measured and manufacture post-entry tasks.
					if (PROFILE === "phase2") sampling = false;
				} catch {
					/* page navigating */
				}
				await sleep(200);
			}
			})();
		};

		await page.goto(BASE, {
			waitUntil: "commit",
			timeout: READY_TIMEOUT_MS,
		});
		await waitForMarker(
			markers,
			(marker) => marker.text.startsWith("TN_LOADING_VIEW_READY"),
			READY_TIMEOUT_MS,
			"TN_LOADING_VIEW_READY marker",
		);
		startSampler();
		await page.waitForLoadState("domcontentloaded", { timeout: READY_TIMEOUT_MS });
		const dcl = Date.now() - t0;
		const valleyMarker = await waitForMarker(
			markers,
			(marker) => marker.text.startsWith("TN_VALLEY_BUILT"),
			READY_TIMEOUT_MS,
			"TN_VALLEY_BUILT marker",
		);
		const detailStartMarker = await waitForMarker(
			markers,
			(marker) => marker.text.startsWith("TN_VALLEY_DETAIL_START"),
			READY_TIMEOUT_MS,
			"TN_VALLEY_DETAIL_START marker",
		);
		const detailTerminalMarker = await waitForMarker(
			markers,
			(marker) =>
				marker.text.startsWith("TN_VALLEY_DETAIL_DONE") ||
				marker.text.startsWith("TN_VALLEY_DETAIL_REJECTED"),
			DETAIL_TIMEOUT_MS,
			"detail done or named rejection marker",
		);
		await page.waitForFunction(
			() => window.__TN_STARTUP_READY__ === true,
			undefined,
			{
				timeout: READY_TIMEOUT_MS,
				polling: 50,
			},
		);
		const readyAt = Date.now() - t0;
		// The detail terminal marker means all required sources resolved or the named rejection was
		// handled. One quiet half-second lets Network.loadingFinished close the complete byte census.
		await sleep(500);
		sampling = false;
		await sampler;

		requireObservation("first frame PNG", firstFramePng);
		await mkdir("artifacts/startup", { recursive: true });
		await writeFile(firstFramePath, firstFramePng);
		await access(firstFramePath);

		const adapterInfo = await page.evaluate(async () => {
			const a = await navigator.gpu?.requestAdapter();
			if (a === null || a === undefined) return undefined;
			const info = a.info ?? {};
			return {
				vendor: info.vendor ?? "",
				architecture: info.architecture ?? "",
				device: info.device ?? "",
				description: info.description ?? "",
			};
		});
		if (!adapterInfo)
			throw new Error("required startup observation missing: WebGPU adapter");
		const adapter = formatAdapter(adapterInfo);

		const valley =
			valleyMarker.t;
		const firstNonWhite = frames.find((f) => f.whiteRatio < 0.9)?.t ?? -1;
		const firstFrame = frames[0];
		const criticalBytes = [...resources.values()]
			.filter((r) => r.done !== undefined && valley >= 0 && r.done <= valley)
			.reduce((s, r) => s + r.size, 0);
		const resourceCensus = [...resources.values()]
			.filter((resource) => resource.done !== undefined)
			.map((resource) => ({
				bytes: resource.size,
				doneAt: resource.done,
				url: resource.url.replace(/^https?:\/\/[^/]+/, ""),
			}))
			.sort((a, b) => a.doneAt - b.doneAt || a.url.localeCompare(b.url));
		const pendingResourceCount = [...resources.values()].filter(
			(resource) => resource.done === undefined,
		).length;
		const observedLongTasks = await page.evaluate(
			() => globalThis.__TN_STARTUP_LONG_TASKS__,
		);
		const postEntryLongTasks = Array.isArray(observedLongTasks)
			? observedLongTasks.filter((task) => task.startTime >= valley)
			: undefined;
		const largest = [...resources.values()]
			.sort((a, b) => b.size - a.size)
			.slice(0, 10)
			.map((r) => ({
				url: r.url.replace(/^https?:\/\/[^/]+/, ""),
				mb: Number((r.size / 1e6).toFixed(2)),
				doneAt: r.done,
			}));

		const run = {
			index,
			adapter,
			adapterInfo,
			dclMs: dcl,
			valleyBuiltMs: valley,
			startupReadyMs: readyAt,
			firstNonWhiteFrameMs: firstNonWhite,
			firstFrame,
			firstFramePath,
			totalMb: Number((bytes / 1e6).toFixed(2)),
			criticalMb: Number((criticalBytes / 1e6).toFixed(2)),
			resourceCensus,
			pendingResourceCount,
			detailStartMs: detailStartMarker.t,
			detailTerminalMs: detailTerminalMarker.t,
			detailDurationMs: detailTerminalMarker.t - detailStartMarker.t,
			postEntryLongTasks,
			markers,
			diagnostics,
			frames: frames.slice(0, 60),
			largest,
		};
		try {
			validateRun(run);
		} catch (error) {
			await mkdir("artifacts/startup", { recursive: true });
			await writeFile(
				`artifacts/startup/${LABEL}-failed-run-${index + 1}.json`,
				JSON.stringify(run, null, 2),
			);
			throw error;
		}
		return run;
	} finally {
		sampling = false;
		if (sampler !== undefined) await sampler;
		await context.close();
	}
}

if (VALIDATE) {
	await runValidationControl(VALIDATE);
} else {
	const vite = startVite();
	let browser;
	try {
		await waitForServer(`http://127.0.0.1:${PORT}/`, 30_000);
		browser = await chromium.launch({ headless: false, args: WEBGPU_ARGS });
		const runs = [];
		for (let i = 0; i < RUNS; i += 1) {
			runs.push(await oneRun(browser, i));
			process.stderr.write(
				`run ${i + 1}/${RUNS}: dcl ${runs[i].dclMs} ms, valley ${runs[i].valleyBuiltMs} ms, ready ${runs[i].startupReadyMs} ms, first non-white ${runs[i].firstNonWhiteFrameMs} ms, ${runs[i].totalMb} MB\n`,
			);
		}
		await browser.close();

		const p95 = (values) => {
			const s = [...values].sort((a, b) => a - b);
			return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
		};
		const med = (values) => {
			const s = [...values].sort((a, b) => a - b);
			return s[Math.floor(s.length / 2)];
		};
		const summary = {
			label: LABEL,
			url: BASE,
			adapter: runs[0]?.adapter,
			runs: RUNS,
			startupReadyMs: {
				median: med(runs.map((r) => r.startupReadyMs)),
				p95: p95(runs.map((r) => r.startupReadyMs)),
			},
			valleyBuiltMs: {
				median: med(runs.map((r) => r.valleyBuiltMs)),
				p95: p95(runs.map((r) => r.valleyBuiltMs)),
			},
			firstNonWhiteFrameMs: {
				median: med(runs.map((r) => r.firstNonWhiteFrameMs)),
			},
			totalMb: med(runs.map((r) => r.totalMb)),
			criticalMb: med(runs.map((r) => r.criticalMb)),
			maxCriticalMb: Math.max(...runs.map((r) => r.criticalMb)),
			detailDurationMs: {
				median: med(runs.map((r) => r.detailDurationMs)),
				p95: p95(runs.map((r) => r.detailDurationMs)),
			},
			maxPostEntryLongTaskMs: Math.max(
				0,
				...runs.flatMap((r) =>
					r.postEntryLongTasks.map((task) => task.duration),
				),
			),
		};
		if (PROFILE === "phase2" && summary.valleyBuiltMs.p95 > 2500) {
			throw new Error(
				`TN_STARTUP_CRITICAL_TIME: p95 ${String(summary.valleyBuiltMs.p95)} ms exceeds 2500 ms`,
			);
		}
		await mkdir("artifacts/startup", { recursive: true });
		await writeFile(
			`artifacts/startup/${LABEL}.json`,
			JSON.stringify({ summary, runs }, null, 2),
		);
		console.log(`\n## startup ${LABEL} — ${summary.adapter}\n`);
		console.log(
			"| run | DCL | valley built | startup ready | detail | first non-white frame | total MB | critical MB | max long task |",
		);
		console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
		for (const r of runs) {
			console.log(
				`| ${r.index + 1} | ${r.dclMs} | ${r.valleyBuiltMs} | ${r.startupReadyMs} | ${r.detailDurationMs} | ${r.firstNonWhiteFrameMs} | ${r.totalMb} | ${r.criticalMb} | ${Math.max(0, ...r.postEntryLongTasks.map((task) => task.duration)).toFixed(1)} |`,
			);
		}
		console.log(
			`| **p95** | | ${summary.valleyBuiltMs.p95} | ${summary.startupReadyMs.p95} | ${summary.detailDurationMs.p95} | | | | ${summary.maxPostEntryLongTaskMs.toFixed(1)} |`,
		);
		console.log("\nmarkers (run 1):");
		for (const m of runs[0].markers)
			console.log(`  ${String(m.t).padStart(6)} ms  ${m.text}`);
		console.log("\nlargest resources (run 1):");
		for (const l of runs[0].largest)
			console.log(
				`  ${String(l.mb).padStart(7)} MB  done ${l.doneAt} ms  ${l.url}`,
			);
		console.log("\nfirst frames (run 1):");
		for (const f of runs[0].frames.slice(0, 12))
			console.log(
				`  ${String(f.t).padStart(6)} ms  mean ${f.mean.join(",")}  white ${f.whiteRatio}`,
			);
		console.log("\ndiagnostics (run 1):");
		for (const d of runs[0].diagnostics)
			console.log(
				`  ${String(d.t).padStart(6)} ms  ${d.type} ${d.level ?? d.status ?? ""} ${d.text}`,
			);
	} finally {
		await browser?.close();
		vite.kill("SIGTERM");
	}
}
