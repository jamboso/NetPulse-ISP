import { Client } from "ssh2";
import { createHash } from "node:crypto";

export type RouterSshOutput = {
  stream: "stdout" | "stderr";
  text: string;
};

type RunRouterSshCommandOptions = {
  host: string;
  port: number;
  username: string;
  password: string;
  hostKeyFingerprint: string;
  command: string;
  onOutput: (output: RouterSshOutput) => void;
  signal?: AbortSignal;
};

const CONNECT_TIMEOUT_MS = 8_000;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

export function sshHostKeyFingerprint(hostKey: Buffer): string {
  return `SHA256:${createHash("sha256").update(hostKey).digest("base64").replace(/=+$/u, "")}`;
}

/**
 * Reads the presented host key without authenticating. The caller must present
 * and confirm this fingerprint before it is persisted for command execution.
 */
export function captureRouterSshHostKey(options: Pick<RunRouterSshCommandOptions, "host" | "port">): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let captured = false;
    const timeout = setTimeout(() => {
      if (!captured) {
        client.end();
        reject(new Error("SSH host-key check timed out after 8 seconds."));
      }
    }, CONNECT_TIMEOUT_MS);

    client.on("error", (error) => {
      if (!captured) {
        clearTimeout(timeout);
        reject(new Error(`SSH host-key check failed: ${error.message}`));
      }
    });
    client.connect({
      host: options.host,
      port: options.port,
      readyTimeout: CONNECT_TIMEOUT_MS,
      hostVerifier: (hostKey: Buffer) => {
        captured = true;
        clearTimeout(timeout);
        resolve(sshHostKeyFingerprint(hostKey));
        // Reject the untrusted server before any username/password is sent.
        return false;
      },
    });
  });
}

/**
 * Executes one remote command through SSH. The command is passed to ssh2's
 * remote channel directly; it is never interpolated into a local shell.
 */
export function runRouterSshCommand(options: RunRouterSshCommandOptions): Promise<{ exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    let outputBytes = 0;
    let commandTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (error?: Error, exitCode: number | null = null) => {
      if (settled) return;
      settled = true;
      if (commandTimer) clearTimeout(commandTimer);
      options.signal?.removeEventListener("abort", abort);
      client.end();
      if (error) reject(error);
      else resolve({ exitCode });
    };

    const abort = () => finish(new Error("Console command cancelled."));
    if (options.signal?.aborted) return abort();
    options.signal?.addEventListener("abort", abort, { once: true });

    client.on("ready", () => {
      client.exec(options.command, { pty: false }, (error, stream) => {
        if (error) {
          finish(new Error(`Could not start remote command: ${error.message}`));
          return;
        }

        commandTimer = setTimeout(() => {
          stream.close();
          finish(new Error("Console command timed out after 30 seconds."));
        }, COMMAND_TIMEOUT_MS);

        const write = (kind: RouterSshOutput["stream"], chunk: Buffer) => {
          outputBytes += chunk.length;
          if (outputBytes > MAX_OUTPUT_BYTES) {
            stream.close();
            finish(new Error("Console output exceeded the 64 KB safety limit."));
            return;
          }
          options.onOutput({ stream: kind, text: chunk.toString("utf8") });
        };

        stream.on("data", (chunk: Buffer) => write("stdout", chunk));
        stream.stderr.on("data", (chunk: Buffer) => write("stderr", chunk));
        stream.on("close", (code: number | null) => finish(undefined, code));
      });
    });
    client.on("error", (error) => finish(new Error(`SSH connection failed: ${error.message}`)));
    client.connect({
      host: options.host,
      port: options.port,
      username: options.username,
      password: options.password,
      readyTimeout: CONNECT_TIMEOUT_MS,
      keepaliveInterval: 0,
      hostVerifier: (hostKey: Buffer) => sshHostKeyFingerprint(hostKey) === options.hostKeyFingerprint,
    });
  });
}