const fs = require("node:fs/promises");
const path = require("node:path");

function encodeUriPath(uriPath) {
  return uriPath
    .split("/")
    .map((segment) => {
      let decodedSegment;

      try {
        decodedSegment = decodeURIComponent(segment);
      } catch {
        decodedSegment = segment;
      }

      return encodeURIComponent(decodedSegment).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      );
    })
    .join("/");
}

function isWithinDirectory(directory, candidate) {
  const relativePath = path.relative(directory, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function normalizeArtifactUri(uri, workspaceRoot) {
  if (typeof uri !== "string" || uri.length === 0) {
    return uri;
  }

  const uriScheme = uri.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  if (uriScheme && uriScheme !== "file") {
    return uri;
  }

  const codacyRoot = "/codacy";
  const filePrefix = "file://";
  let artifactPath = uri;
  let wasFileUri = false;
  let fileAuthority = "";

  if (uri.startsWith(`${filePrefix}${codacyRoot}/`)) {
    artifactPath = uri.slice(`${filePrefix}${codacyRoot}/`.length);
  } else if (uri.startsWith(`${filePrefix}${codacyRoot}`)) {
    artifactPath = uri
      .slice(`${filePrefix}${codacyRoot}`.length)
      .replace(/^\//, "");
  } else if (uri.startsWith(filePrefix)) {
    try {
      const fileUrl = new URL(uri);
      if (fileUrl.protocol !== "file:") {
        return uri;
      }

      const absolutePath = decodeURIComponent(fileUrl.pathname);
      if (isWithinDirectory(codacyRoot, absolutePath)) {
        artifactPath = path.relative(codacyRoot, absolutePath);
      } else if (
        workspaceRoot &&
        isWithinDirectory(workspaceRoot, absolutePath)
      ) {
        artifactPath = path.relative(workspaceRoot, absolutePath);
      } else {
        wasFileUri = true;
        fileAuthority = fileUrl.host;
        artifactPath = fileUrl.pathname;
      }
    } catch {
      return uri;
    }
  } else if (uri.startsWith("/")) {
    if (isWithinDirectory(codacyRoot, uri)) {
      artifactPath = path.relative(codacyRoot, uri);
    } else if (workspaceRoot && isWithinDirectory(workspaceRoot, uri)) {
      artifactPath = path.relative(workspaceRoot, uri);
    } else {
      artifactPath = uri;
    }
  }

  const normalizedPath = encodeUriPath(artifactPath);
  return wasFileUri
    ? `${filePrefix}${fileAuthority}${normalizedPath}`
    : normalizedPath;
}

function hasInvalidRegion(region) {
  if (!region || typeof region !== "object" || Array.isArray(region)) {
    return false;
  }

  const coordinateFields = ["startLine", "startColumn", "endLine", "endColumn"];
  if (
    coordinateFields.some(
      (field) =>
        Object.hasOwn(region, field) &&
        (!Number.isInteger(region[field]) || region[field] < 1),
    )
  ) {
    return true;
  }

  if (
    Object.hasOwn(region, "endLine") &&
    Object.hasOwn(region, "startLine") &&
    region.endLine < region.startLine
  ) {
    return true;
  }

  if (
    Object.hasOwn(region, "endColumn") &&
    Object.hasOwn(region, "startColumn") &&
    (!Object.hasOwn(region, "endLine") ||
      region.endLine === region.startLine) &&
    region.endColumn < region.startColumn
  ) {
    return true;
  }

  return (
    !Object.hasOwn(region, "startLine") &&
    !Object.hasOwn(region, "charOffset") &&
    !Object.hasOwn(region, "byteOffset")
  );
}

function normalizeSarif(sarif, workspaceRoot) {
  if (!sarif || !Array.isArray(sarif.runs)) {
    throw new TypeError("The SARIF document must contain a runs array.");
  }

  let normalizedUris = 0;
  let removedInvalidRegions = 0;

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === "region" && hasInvalidRegion(child)) {
        delete value[key];
        removedInvalidRegions += 1;
        continue;
      }

      if (key === "artifactLocation" && child && typeof child === "object") {
        const normalizedUri = normalizeArtifactUri(child.uri, workspaceRoot);
        if (normalizedUri !== child.uri) {
          child.uri = normalizedUri;
          normalizedUris += 1;
        }
      }

      visit(child);
    }
  }

  visit(sarif);
  return { normalizedUris, removedInvalidRegions };
}

async function main() {
  const inputPath = process.argv[2] || "results.sarif";
  const absoluteInputPath = path.resolve(inputPath);
  const sarif = JSON.parse(await fs.readFile(absoluteInputPath, "utf8"));
  const changes = normalizeSarif(
    sarif,
    process.env.GITHUB_WORKSPACE || process.cwd(),
  );

  await fs.writeFile(absoluteInputPath, `${JSON.stringify(sarif, null, 2)}\n`);
  console.log(
    `Normalized ${changes.normalizedUris} SARIF artifact URI(s) and removed ${changes.removedInvalidRegions} invalid region(s).`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { normalizeArtifactUri, normalizeSarif };
