const { maxSatisfying, Range } = require("semver");
const { DPM_NAMESPACE, DPM_VERSIONS_KEY } = require("../constants.js");
const PACKAGE_NAME = process.env.PACKAGE_NAME;

function findVersion(versions, versionInPath = "*") {
  if (versionInPath === "latest") {
    versionInPath = "*";
  }
  const range = Range(versionInPath);
  const version = maxSatisfying(versions, range);
  if (version) {
    return version;
  } else {
    return null;
  }
}

async function handleRequest(request) {
  const parsedUrl = new URL(request.url);
  const path = parsedUrl.pathname;

  const versionInPath = path.replace("/", "");

  const versions = await dpm.get(
    `${DPM_NAMESPACE}-${PACKAGE_NAME}-${DPM_VERSIONS_KEY}`,
    "json"
  );

  if (versionInPath === "" || versionInPath === "versions") {
    return new Response(JSON.stringify({ name: PACKAGE_NAME, versions }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  const version = findVersion(versions, versionInPath);

  if (!version) {
    return new Response("Version not found");
  }

  const tarball = await dpm.get(
    `${DPM_NAMESPACE}-${PACKAGE_NAME}-${version}`,
    "stream"
  );

  if (!tarball) {
    return new Response(`Version not found ${version}`);
  }

  return new Response(tarball, {
    headers: {
      "Content-Disposition": `attachment; filename="${PACKAGE_NAME}-v${version}.tgz"`,
      "Content-Type": "application/tar+gzip"
    }
  });
}

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});
