import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const temporaryDirectories: string[] = [];
const updateScript = resolve(process.cwd(), "../../deploy/update.sh");
const localCommit = "a".repeat(40);
const candidateCommit = "b".repeat(40);

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "netpulse-update-test-"));
  temporaryDirectories.push(root);
  const appDir = join(root, "app");
  const binDir = join(root, "bin");
  const commandLog = join(root, "commands.log");
  const statusFile = join(root, "status.json");
  const backupDir = join(root, "backups");
  const logFile = join(root, "update.log");
  const updateConfig = join(root, "update.conf");
  const fixtureScript = join(root, "update.sh");

  const mkdir = spawnSync("mkdir", ["-p", join(appDir, ".git"), join(appDir, "deploy"), binDir]);
  if (mkdir.status !== 0) throw new Error("Could not create update-script test fixture.");
  writeFileSync(join(appDir, ".env"), "DATABASE_URL=postgresql://netpulse:test@localhost:5432/netpulse\n");
  writeFileSync(updateConfig, "DATABASE_URL=postgresql://netpulse:test@localhost:5432/netpulse\nNETPULSE_PM2_USER=root\n");
  chmodSync(updateConfig, 0o600);
  // The production script correctly requires root. The test runs an otherwise
  // byte-for-byte copy with only that host privilege guard neutralized because
  // the isolated runner cannot elevate its effective UID.
  const script = readFileSync(updateScript, "utf8").replace(
    '[[ $EUID -ne 0 ]] && die "Run this production updater as root."',
    "true # root privilege is supplied by the isolated test harness",
  ).replace(
    '[[ "$(stat -c \'%U:%a\' "$UPDATE_CONFIG")" == "root:600" ]] || die "Update configuration must be owned by root with mode 600."',
    "true # root-owned configuration is supplied by the isolated test harness",
  ).replace(
    'export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
    "true # fixture keeps fake commands first in PATH",
  );
  if (script.includes('[[ $EUID -ne 0 ]]') || script.includes('stat -c \'%U:%a\'')) {
    throw new Error("Could not prepare root-safe update script fixture.");
  }
  writeFileSync(fixtureScript, script);
  chmodSync(fixtureScript, 0o755);
  writeFileSync(join(appDir, "deploy", "migrate.sh"), "#!/usr/bin/env bash\nprintf 'migrate\\n' >> \"$COMMAND_LOG\"\nexit \"${MIGRATE_EXIT:-0}\"\n");
  chmodSync(join(appDir, "deploy", "migrate.sh"), 0o755);

  const fake = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$(basename "$0") $*" >> "$COMMAND_LOG"
case "$(basename "$0")" in
  git)
    case "$1" in
      status) printf '%s' "\${GIT_DIRTY:-}" ;;
      symbolic-ref) echo main ;;
      config) [[ "$3" == *remote ]] && echo origin || echo refs/heads/production ;;
      fetch) ;;
      rev-parse)
        if [[ "$2" == HEAD ]]; then echo "$LOCAL_COMMIT"
        elif [[ "$2" == FETCH_HEAD ]]; then echo "$CANDIDATE_COMMIT"
        elif [[ "$2" == --short ]]; then echo "\${3:0:7}"
        fi ;;
      merge-base) [[ "\${FAST_FORWARD:-1}" == 1 ]] ;;
      merge) ;;
    esac ;;
  pg_dump)
    for arg in "$@"; do [[ "$arg" == --file=* ]] && printf backup > "\${arg#--file=}"; done
    true ;;
  pg_restore|pnpm|pm2|curl) ;;
esac
`;
  for (const command of ["git", "pg_dump", "pg_restore", "pnpm", "pm2", "curl", "sleep"]) {
    const file = join(binDir, command);
    writeFileSync(file, fake);
    chmodSync(file, 0o755);
  }

  return { root, appDir, binDir, commandLog, statusFile, backupDir, logFile, fixtureScript, updateConfig };
}

function runUpdate(fixture: ReturnType<typeof makeFixture>, env: Record<string, string> = {}) {
  const command = [
    "env",
    `PATH=${fixture.binDir}:${process.env.PATH}`,
    `NETPULSE_DIR=${fixture.appDir}`,
    `NETPULSE_UPDATE_STATUS_FILE=${fixture.statusFile}`,
    `NETPULSE_BACKUP_DIR=${fixture.backupDir}`,
    `NETPULSE_UPDATE_LOCK_FILE=${join(fixture.root, "update.lock")}`,
    `NETPULSE_UPDATE_LOG_FILE=${fixture.logFile}`,
    `NETPULSE_UPDATE_CONFIG_FILE=${fixture.updateConfig}`,
    `COMMAND_LOG=${fixture.commandLog}`,
    `LOCAL_COMMIT=${localCommit}`,
    `CANDIDATE_COMMIT=${candidateCommit}`,
    ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
    "bash",
    fixture.fixtureScript,
    ...(env.NO_TARGET === "1" ? [] : [env.CANDIDATE_COMMIT ?? candidateCommit]),
  ];
  return spawnSync(command[0], command.slice(1), { encoding: "utf8", timeout: 20_000 });
}

function commands(fixture: ReturnType<typeof makeFixture>) {
  try {
    return readFileSync(fixture.commandLog, "utf8");
  } catch {
    return "";
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("safe production update script", () => {
  it("keeps the production updater executable for the sudo launcher", () => {
    expect(statSync(updateScript).mode & 0o111).not.toBe(0);
  });

  it("rejects a direct sudo-style invocation without a confirmed full commit", () => {
    const fixture = makeFixture();
    const result = runUpdate(fixture, { NO_TARGET: "1" });
    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
    expect(commands(fixture)).toBe("");
  });

  it("refuses a dirty tracked checkout before any backup or build", () => {
    const fixture = makeFixture();
    const result = runUpdate(fixture, { GIT_DIRTY: " M artifacts/api-server/src/index.ts" });
    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
    expect(commands(fixture)).toContain("git status");
    expect(commands(fixture)).not.toContain("pg_dump");
    expect(commands(fixture)).not.toContain("pnpm");
    expect(JSON.parse(readFileSync(fixture.statusFile, "utf8"))).toMatchObject({ state: "failed", phase: "preflight" });
  });

  it("records a no-change release without backing up, building, migrating, or restarting", () => {
    const fixture = makeFixture();
    const result = runUpdate(fixture, { CANDIDATE_COMMIT: localCommit });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(commands(fixture)).not.toMatch(/pg_dump|pnpm|migrate|pm2/);
    expect(JSON.parse(readFileSync(fixture.statusFile, "utf8"))).toMatchObject({ state: "no-update" });
  });

  it("stops before PM2 restart when a migration fails", () => {
    const fixture = makeFixture();
    const result = runUpdate(fixture, { MIGRATE_EXIT: "7" });
    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
    expect(commands(fixture)).toContain("pg_dump");
    expect(commands(fixture)).toContain("migrate");
    expect(commands(fixture)).not.toContain("pm2");
    expect(JSON.parse(readFileSync(fixture.statusFile, "utf8"))).toMatchObject({ state: "failed", phase: "migrating" });
  });

  it("backs up, builds, migrates, restarts, and health-checks a fast-forward release", () => {
    const fixture = makeFixture();
    const result = runUpdate(fixture);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(commands(fixture)).toMatch(/pg_dump[\s\S]*pnpm[\s\S]*migrate[\s\S]*pm2[\s\S]*curl/);
    expect(JSON.parse(readFileSync(fixture.statusFile, "utf8"))).toMatchObject({
      state: "succeeded",
      previousCommit: localCommit,
      targetCommit: candidateCommit,
    });
  });
});