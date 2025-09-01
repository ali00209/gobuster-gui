const { app, BrowserWindow, ipcMain, clipboard, dialog } = require("electron");
const path = require("path");
const fs = require("fs").promises;
const { spawn } = require("child_process");
const { execSync } = require("child_process");

let mainWindow;
let currentProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 880,
    minHeight: 640,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  mainWindow.loadFile("index.html");
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  // mainWindow.webContents.openDevTools(); // open openDevTools on start
}

app.on("ready", createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

ipcMain.handle("read-config", async (event, filePath) => {
  try {
    if (
      await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false)
    ) {
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data);
    }
    return {
      theme: "darkly",
      seclists_path: "/usr/share/seclists/",
      default_threads: 10,
      default_output_dir: require("os").homedir(),
      font_size: "medium",
      auto_save_output: false,
      clear_output_on_start: true,
    };
  } catch (e) {
    throw new Error("Failed to read config: " + e.message);
  }
});

ipcMain.handle("write-config", async (event, filePath, config) => {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
  } catch (e) {
    throw new Error("Failed to write config: " + e.message);
  }
});

ipcMain.handle("load-wordlists", async (event, seclistsPath) => {
  const wordlists = [];
  async function walkDir(dir) {
    try {
      const files = await fs.readdir(dir, { withFileTypes: true });
      for (const file of files) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
          await walkDir(fullPath);
        } else if (file.name.endsWith(".txt")) {
          wordlists.push(fullPath);
        }
      }
    } catch (e) {
      console.error("Error walking directory:", e);
    }
  }
  if (
    await fs
      .access(seclistsPath)
      .then(() => true)
      .catch(() => false)
  ) {
    await walkDir(seclistsPath);
  }
  return wordlists.sort();
});

ipcMain.handle("load-favorites", async (event, filePath) => {
  try {
    if (
      await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false)
    ) {
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data).filter((p) =>
        fs
          .accessSync(p)
          .then(() => true)
          .catch(() => false),
      );
    }
    return [];
  } catch (e) {
    return [];
  }
});

ipcMain.handle("write-favorites", async (event, filePath, favorites) => {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(favorites, null, 2));
  } catch (e) {
    throw new Error("Failed to write favorites: " + e.message);
  }
});

ipcMain.handle("read-presets", async (event, filePath) => {
  try {
    if (
      await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false)
    ) {
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data);
    }
    return {};
  } catch (e) {
    throw new Error("Failed to read presets: " + e.message);
  }
});

ipcMain.handle("write-presets", async (event, filePath, presets) => {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(presets, null, 2));
  } catch (e) {
    throw new Error("Failed to write presets: " + e.message);
  }
});

ipcMain.handle("file-exists", async (event, filePath) => {
  return await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
});

ipcMain.handle("dir-exists", async (event, dirPath) => {
  return await fs
    .access(dirPath)
    .then(() => true)
    .catch(() => false);
});

ipcMain.handle("check-gobuster", async () => {
  try {
    execSync("gobuster version", { stdio: "ignore" });
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle("validate-gobuster", async () => {
  try {
    const gobusterPath = execSync("which gobuster").toString().trim();
    if (!gobusterPath) return "[Warning] Gobuster not found in PATH. Install it to run scans.";
    try {
      const output = execSync(`${gobusterPath} version`).toString();
      return output;
    } catch (e) {
      return `Found gobuster at ${gobusterPath}.`;
    }
  } catch (e) {
    return "[Warning] Gobuster not found in PATH. Install it to run scans.";
  }
});

ipcMain.handle("copy-to-clipboard", (event, text) => {
  clipboard.writeText(text);
});

ipcMain.on("start-run", (event, cmd) => {
  currentProcess = spawn(cmd[0], cmd.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
  currentProcess.stdout.on("data", (data) => {
    mainWindow.webContents.send("run-output", data.toString());
  });
  currentProcess.stderr.on("data", (data) => {
    mainWindow.webContents.send("run-output", data.toString());
  });
  currentProcess.on("close", (code) => {
    mainWindow.webContents.send("run-complete", code);
    currentProcess = null;
  });
});

ipcMain.handle("stop-run", async () => {
  if (currentProcess) {
    currentProcess.kill("SIGTERM");
    try {
      await new Promise((resolve, reject) => {
        currentProcess.on("close", () => resolve());
        setTimeout(() => reject(new Error("Timeout")), 2000);
      });
    } catch (e) {
      currentProcess.kill("SIGKILL");
    }
    currentProcess = null;
  }
});

ipcMain.handle("open-file-dialog", async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options || { properties: ["openFile"] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("open-directory-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("save-file-dialog", async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options || {});
  return result.canceled ? null : result.filePath;
});
