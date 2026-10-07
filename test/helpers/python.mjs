import { spawnSync } from "node:child_process";
import fs from "node:fs";

/**
 * Locate a usable Python 3 executable.
 * Priority:
 * 1. process.env.GF_PYTHON
 * 2. C:/Program Files/Python312/python.exe
 * 3. python on PATH (rejecting WindowsApps aliases and verifying --version)
 * @returns {string | null} Absolute path to python executable or null
 */
export function findPython() {
  const candidates = [];

  if (process.env.GF_PYTHON) {
    candidates.push(process.env.GF_PYTHON);
  }

  candidates.push("C:/Program Files/Python312/python.exe");

  // Check PATH candidates
  try {
    const whereResult = spawnSync(
      process.platform === "win32" ? "where.exe" : "which",
      ["python"],
      { encoding: "utf8" }
    );
    if (whereResult.status === 0 && whereResult.stdout) {
      const paths = whereResult.stdout
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      for (const p of paths) {
        if (!/windowsapps/i.test(p)) {
          candidates.push(p);
        }
      }
    }
  } catch {
    // Ignore PATH search errors
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const testRun = spawnSync(candidate, ["--version"], {
          encoding: "utf8",
          timeout: 3000,
        });
        if (testRun.status === 0 && !/windowsapps/i.test(candidate)) {
          return candidate;
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  return null;
}

/**
 * Execute Python code, passing input data via stdin as JSON, and returning parsed JSON from stdout.
 * @param {string} code Python script code to execute
 * @param {unknown} input Data passed via stdin (serialized to JSON if not string)
 * @returns {unknown} Parsed JSON returned by Python on stdout
 */
export function runPythonJson(code, input) {
  const py = findPython();
  if (!py) {
    throw new Error("Python interpreter not found");
  }

  const inputStr = typeof input === "string" ? input : JSON.stringify(input);

  const result = spawnSync(py, ["-c", code], {
    input: inputStr,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    timeout: 30000,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Python execution failed (exit ${result.status}): ${result.stderr || result.stdout}`
    );
  }

  return JSON.parse(result.stdout);
}
