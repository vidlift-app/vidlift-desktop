// One line about this computer from the core's hardware probe (/api/setup's
// `profile`, apps/worker/hardware.py). Kept apart from bootstrap.ts so it can
// be tested without Electron.

export interface SetupStatus {
  profile?: {
    gpus?: { vendor: string; name: string; vram_mb?: number | null }[];
    torch_device?: string;
    ram_gb?: number | null;
    cpu_cores?: number;
  };
}

/** "NVIDIA GeForce RTX 3070 (8 GB) · AI runs on the NVIDIA GPU" */
export function describeHardware(s: SetupStatus | null): string | null {
  const p = s?.profile;
  if (!p) return null;
  const gpu = p.gpus?.[0];
  const card = gpu ? `${gpu.name}${gpu.vram_mb ? ` (${Math.round(gpu.vram_mb / 1024)} GB)` : ""}` : `${p.cpu_cores ?? "?"}-core CPU`;
  const where = p.torch_device === "cuda" ? "AI runs on the NVIDIA GPU" : p.torch_device === "mps" ? "AI runs on the Apple GPU" : "AI runs on the CPU";
  return `${card} · ${where}`;
}
