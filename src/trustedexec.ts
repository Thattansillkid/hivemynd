// Where to find the external programs H!V3MYND runs, by full path, so a program of the
// same name placed earlier on PATH (or in the working directory) is never picked up.

/** The nvidia-smi locations NVIDIA's drivers install to; null if none exists. */
export function nvidiaSmiPath(platform: string, env: Record<string, string | undefined>, exists: (p: string) => boolean): string | null {
  const candidates = platform === 'win32'
    ? [
      `${env.SystemRoot || env.windir || 'C:\\Windows'}\\System32\\nvidia-smi.exe`,
      `${env.ProgramW6432 || env.ProgramFiles || 'C:\\Program Files'}\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe`,
    ]
    : ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi', '/opt/nvidia/bin/nvidia-smi'];
  return candidates.find((p) => exists(p)) ?? null;
}
