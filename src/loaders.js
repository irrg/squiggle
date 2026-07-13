import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export async function loadCommands(commandsDir, commandPrefix = "") {
  const files = fs.readdirSync(commandsDir);
  return Promise.all(
    files.map(async (file) => {
      const commandModule = await import(
        pathToFileURL(path.join(commandsDir, file)).href
      );
      const commandName = commandModule.commandName || file.split(".")[0];
      return {
        name: `${commandPrefix}${commandName}`,
        description: commandModule.description || "No description provided",
        init: commandModule.init,
        options: commandModule.options || [],
      };
    }),
  );
}

// Guards interval-driven workers from overlapping when a run outlasts the interval
export function nonOverlapping(fn) {
  let running = false;
  return async (...args) => {
    if (running) return;
    running = true;
    try {
      return await fn(...args);
    } finally {
      running = false;
    }
  };
}

export async function loadWorkers(workersDir) {
  const files = fs.readdirSync(workersDir);
  const workers = await Promise.all(
    files.map(async (file) => {
      const workerModule = await import(
        pathToFileURL(path.join(workersDir, file)).href
      );
      if (
        typeof workerModule.interval !== "number" ||
        workerModule.interval <= 0
      ) {
        console.error(
          `Worker ${file} has invalid interval: ${workerModule.interval}`,
        );
        return null;
      }
      return {
        name: file,
        run: workerModule.run,
        interval: workerModule.interval,
      };
    }),
  );
  return workers.filter(Boolean);
}
