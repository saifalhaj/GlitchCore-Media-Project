// Shared onnxruntime-web loader for the model-backed effects (pose, cutout,
// depth3d). Same config as yolo.ts/depth.ts: wasm path pinned to the installed
// version, HEAD-check → MODEL_UNAVAILABLE, WebGPU with automatic WASM fallback.
//
// Beyond create-time fallback, `runModel` also handles the case where a session
// builds fine on WebGPU but a kernel fails at RUN time (e.g. MoveNet's GatherND
// on the jsep backend): it rebuilds the session on WASM and retries once.

const ORT_VERSION = "1.27.0";

type OrtModule = typeof import("onnxruntime-web");
let ortPromise: Promise<OrtModule> | null = null;

export async function getOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = (async () => {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
      return ort;
    })();
  }
  return ortPromise;
}

export function modelUnavailable(): Error {
  const err = new Error("model unavailable");
  (err as { code?: string }).code = "MODEL_UNAVAILABLE";
  return err;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cached = { session: any; ep: "webgpu" | "wasm" };
const sessions = new Map<string, Promise<Cached>>();

async function create(modelPath: string, ep: "webgpu" | "wasm"): Promise<Cached> {
  const ort = await getOrt();
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: [ep] });
  return { session, ep };
}

function getCached(modelPath: string): Promise<Cached> {
  const existing = sessions.get(modelPath);
  if (existing) return existing;

  const p = (async () => {
    const ort = await getOrt();
    void ort;
    let head: Response;
    try {
      head = await fetch(modelPath, { method: "HEAD" });
    } catch {
      throw modelUnavailable();
    }
    if (!head.ok) throw modelUnavailable();
    try {
      return await create(modelPath, "webgpu");
    } catch {
      try {
        return await create(modelPath, "wasm");
      } catch {
        throw modelUnavailable();
      }
    }
  })();

  sessions.set(modelPath, p);
  p.catch(() => {
    if (sessions.get(modelPath) === p) sessions.delete(modelPath);
  });
  return p;
}

/** The cached InferenceSession (for reading inputNames/outputNames). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadSession(modelPath: string): Promise<any> {
  return (await getCached(modelPath)).session;
}

/** Run a model, falling back from WebGPU to WASM if a kernel fails at run time. */
export async function runModel(
  modelPath: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  feeds: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any>> {
  const c = await getCached(modelPath);
  try {
    return await c.session.run(feeds);
  } catch (e) {
    if (c.ep !== "webgpu") throw e;
    // WebGPU kernel failed mid-run — rebuild on WASM and retry once.
    const wasm = create(modelPath, "wasm");
    sessions.set(modelPath, wasm);
    wasm.catch(() => {
      if (sessions.get(modelPath) === wasm) sessions.delete(modelPath);
    });
    const w = await wasm;
    return await w.session.run(feeds);
  }
}
