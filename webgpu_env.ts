// ── webgpu_env.ts ─────────────────────────────────────────────────────────────
// Environment-aware WebGPU probe. Ed25519 keygen stays on CPU workers; GPU is
// probed for future compute paths and for ops visibility only.
//
// Bun: no built-in navigator.gpu in the runtime (see oven-sh/bun WebGPU issues).
// Local GPU probe (e.g. Intel UHD 620 on Windows) uses Deno with --unstable-webgpu.

import { RUNTIME } from "./runtime.ts";

function readEnv(name: string): string | undefined {
  if (typeof (globalThis as any).Deno !== "undefined") {
    try {
      return (globalThis as any).Deno.env.get(name) ?? undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof process !== "undefined") return (process as any).env?.[name];
  return undefined;
}

function onDenoDeploy(): boolean {
  try {
    return Boolean((globalThis as any).Deno?.env?.get?.("DENO_DEPLOYMENT_ID"));
  } catch {
    return false;
  }
}

export type WebGpuGrindContext = {
  /** User or env asked to evaluate WebGPU. */
  probeRequested: boolean;
  /** Deno desktop / local — not Deploy, not Node/Bun for this probe. */
  runtimeEligible: boolean;
  /** `navigator.gpu.requestAdapter()` succeeded. */
  adapterOk: boolean;
  /** Human-readable status for logs. */
  status: "off" | "deploy_skip" | "unsupported_runtime" | "no_navigator_gpu" | "no_adapter" | "adapter_ok";
  detail?: string;
};

export async function evaluateWebGpuForGrind(cliOrExplicitRequest: boolean): Promise<WebGpuGrindContext> {
  const envRaw = (readEnv("VANITY_USE_WEBGPU") ?? "").trim().toLowerCase();
  if (envRaw === "0" || envRaw === "false" || envRaw === "off") {
    return { probeRequested: false, runtimeEligible: false, adapterOk: false, status: "off", detail: "VANITY_USE_WEBGPU disabled" };
  }
  const envOn = envRaw === "1" || envRaw === "true" || envRaw === "yes" || envRaw === "auto";
  const probeRequested = cliOrExplicitRequest || envOn;
  if (!probeRequested) {
    return { probeRequested: false, runtimeEligible: false, adapterOk: false, status: "off", detail: "set --use-webgpu or VANITY_USE_WEBGPU=1|auto" };
  }
  if (RUNTIME !== "deno") {
    return { probeRequested: true, runtimeEligible: false, adapterOk: false, status: "unsupported_runtime", detail: RUNTIME };
  }
  if (onDenoDeploy()) {
    return { probeRequested: true, runtimeEligible: false, adapterOk: false, status: "deploy_skip", detail: "no WebGPU on Deno Deploy isolates" };
  }
  try {
    const gpu = (globalThis as any).navigator?.gpu;
    if (!gpu?.requestAdapter) {
      return { probeRequested: true, runtimeEligible: true, adapterOk: false, status: "no_navigator_gpu", detail: "run with --unstable-webgpu if supported" };
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return { probeRequested: true, runtimeEligible: true, adapterOk: false, status: "no_adapter", detail: "no suitable GPU adapter" };
    }
    return { probeRequested: true, runtimeEligible: true, adapterOk: true, status: "adapter_ok", detail: "adapter" };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { probeRequested: true, runtimeEligible: true, adapterOk: false, status: "no_adapter", detail: msg };
  }
}
