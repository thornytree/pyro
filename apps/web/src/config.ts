export interface AppConfig {
  orchestratorUrl: string;
  mapStyleUrl: string;
  useMock: boolean;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy apps/web/.env.example to apps/web/.env and set it.`,
    );
  }
  return value;
}

export function loadConfig(env: Env): AppConfig {
  const useMock = env.VITE_USE_MOCK === "true";
  return {
    // The orchestrator URL is only needed when we actually call it.
    orchestratorUrl: useMock
      ? (env.VITE_ORCHESTRATOR_URL ?? "")
      : required(env, "VITE_ORCHESTRATOR_URL").replace(/\/+$/, ""),
    mapStyleUrl: required(env, "VITE_MAP_STYLE_URL"),
    useMock,
  };
}
