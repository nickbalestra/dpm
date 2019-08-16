const dotenv = require("dotenv").config;
const { resolve } = require("path");
const yargs = require("yargs");
const publishHandler = require("./cmds/publish");

dotenv({
  path: resolve(process.cwd(), ".dpmrc")
});

async function run() {
  yargs
    .scriptName("dpm")
    .command(
      "publish [folder]",
      "Publish the component in the folder on the edge",
      yargs =>
        yargs
          .option("folder", {
            describe: "the local path to the component",
            default: "."
          })
          .coerce("folder", path =>
            path === "." || !path ? process.cwd() : resolve(process.cwd(), path)
          ),
      publishHandler
    )
    .fail(function(msg, err) {
      console.error("\nError details:");
      console.error(err);
      process.exit(1);
    }).argv;
}

module.exports = { run };
