#!/usr/bin/env node

// Let a globally installed package
// use a locally installed version of itself if available
const importLocal = require("import-local");

if (!importLocal(__filename)) {
  require("../src/cli").run();
}
