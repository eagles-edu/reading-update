const fs = require("node:fs");
const path = require("node:path");

function timestampTag(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function createBackupManager(root, label) {
  const backupBase = path.resolve("/home/eagles/dockerz/efast-bu");
  const runRoot = path.resolve(backupBase, `${label}-${timestampTag()}-${process.pid}`);
  const backedUp = new Set();

  function backupBeforeWrite(file) {
    const absolute = path.resolve(file);
    if (backedUp.has(absolute)) return;
    if (!fs.existsSync(absolute)) {
      throw new Error(`Cannot back up missing file: ${absolute}`);
    }

    const relative = path.relative(root, absolute);
    const target = path.resolve(runRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(absolute, target);
    backedUp.add(absolute);
  }

  return {
    backupBeforeWrite,
    runRoot,
  };
}

module.exports = {
  createBackupManager,
};
