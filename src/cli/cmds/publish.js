const axios = require("axios");
const FormData = require("form-data");
const { createReadStream } = require("fs");
const webpack = require("webpack");
const Listr = require("listr");
const { resolve, join } = require("path");
const { Perf, responseHandler } = require("../../utils");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const chalk = require("chalk");

const {
  CF_API_URL,
  DPM_NAMESPACE,
  DPM_VERSIONS_KEY
} = require("../../constants.js");

const perf = new Perf();

module.exports = async ({ folder }) => {
  perf.start();
  const { name, version } = require(join(folder, "package.json"));

  const { CF_ID, CF_EMAIL, CF_KEY } = process.env;
  axios.defaults.baseURL = `${CF_API_URL}/accounts/${CF_ID}`;
  axios.defaults.headers.common["X-Auth-Email"] = CF_EMAIL;
  axios.defaults.headers.common["X-Auth-Key"] = CF_KEY;
  axios.defaults.validateStatus = () => true;

  const config = {
    package: {
      name,
      version
    },
    kv: {
      namespace: DPM_NAMESPACE,
      versionsKey: `${DPM_NAMESPACE}-${name}-${DPM_VERSIONS_KEY}`
    }
  };

  // INIT
  // ==========
  // 1 Create a new dpm namespace
  // 2 If namespace existed get `versions`
  // 3 if versions doesn't exist, set its value to [];, otherwise store locally its value
  // 2 create worker/publish worker with binding to dpm namespace
  const init = new Listr([
    {
      title: "Initializing DPM",
      task: (ctx, main) =>
        new Listr([
          {
            title: "Fetching KV Namespaces",
            task: ctx => {
              return new Promise(async (resolve, reject) => {
                const {
                  data: { errors, result }
                } = await axios({
                  url: `/storage/kv/namespaces`
                });
                if (errors.length) {
                  return reject(errors);
                }

                ctx.namespace = result.find(
                  ns => ns.title === ctx.config.kv.namespace
                );
                resolve(ctx.namespace);
              });
            }
          },
          {
            title: "Initialize DPM Namespace",
            task: (ctx, task) => {
              if (ctx.namespace) {
                task.skip("DPM Namespace already initialized");
                return Promise.resolve(ctx.namespace);
              }

              return new Promise(async (resolve, reject) => {
                const {
                  data: { errors, result }
                } = await axios({
                  method: "post",
                  url: `/storage/kv/namespaces`,
                  data: { title: ctx.config.kv.namespace }
                });

                if (errors.length) {
                  return reject(errors);
                }
                ctx.namespace = result;
                resolve(ctx.namespac);
              });
            }
          },
          {
            title: `Fetching versions`,
            task: ctx => {
              return new Promise(async (resolve, reject) => {
                const { data } = await axios({
                  url: `/storage/kv/namespaces/${ctx.namespace.id}/values/${
                    ctx.config.kv.versionsKey
                  }`
                });

                ctx.versions = {};

                if (data.errors && data.errors.length) {
                  // If key not found (error code 10009) don't do reject
                  if (data.errors[0].code != "10009") {
                    return reject(data.errors);
                  }
                  ctx.versions.toInitialize = true;
                }

                if (
                  Array.isArray(data) &&
                  data.find(v => v === ctx.config.package.version)
                ) {
                  return reject(
                    new Error(
                      `Versions ${ctx.config.package.version} already published`
                    )
                  );
                }
                ctx.versions.data = data;
                resolve(ctx.versions);
              });
            }
          },
          {
            title: `Initializing versions`,
            task: (ctx, task) => {
              if (!ctx.versions.toInitialize) {
                task.skip(
                  `${ctx.config.package.name} versions already initialized`
                );
                return Promise.resolve();
              }

              return new Promise(async (resolve, reject) => {
                const { data } = await axios({
                  method: "put",
                  url: `/storage/kv/namespaces/${ctx.namespace.id}/values/${
                    ctx.config.kv.versionsKey
                  }`,
                  data: []
                });

                if (data.errors && data.errors.length) {
                  return reject(data.errors[0]);
                }

                ctx.versions = { data: [] };
                resolve(ctx.versions);
              });
            }
          },
          {
            title: "Compiling DPM Worker",
            task: (ctx, task) => {
              // createDynamicConfig passing name
              const compiler = webpack({
                entry: resolve(__dirname, "../../worker/script.js"),
                mode: "production",
                optimization: {
                  minimize: true
                },
                performance: {
                  hints: false
                },
                output: {
                  path: resolve(__dirname, "../../.tmp"),
                  filename: "bundle.js"
                },
                plugins: [
                  new webpack.DefinePlugin({
                    "process.env.PACKAGE_NAME": JSON.stringify(
                      ctx.config.package.name
                    )
                  })
                ]
              });

              return new Promise((resolve, reject) => {
                compiler.run((err, stats) => {
                  if (err) {
                    return reject(err);
                  }
                  return resolve(stats);
                });
              });
            }
          },
          {
            title: `Deploying DPM Worker`,
            task: ctx => {
              const formData = new FormData();
              formData.append(
                "script",
                createReadStream(resolve(__dirname, "../../.tmp/bundle.js"))
              );
              formData.append(
                "metadata",
                JSON.stringify({
                  body_part: "script",
                  bindings: [
                    {
                      type: "kv_namespace",
                      name: "dpm",
                      namespace_id: ctx.namespace.id
                    }
                  ]
                })
              );
              return axios({
                method: "put",
                url: `/workers/scripts/${ctx.config.package.name}`,
                headers: {
                  "Content-Type": `multipart/form-data; boundary=${
                    formData._boundary
                  }`
                },
                data: formData
              }).then(responseHandler());
            }
          },
          {
            title: "Retrieving zoneless subdomain",
            task: ctx => {
              return new Promise(async (resolve, reject) => {
                const {
                  data: { errors, result }
                } = await axios({
                  url: `/workers/subdomain`
                });
                if (errors.length) {
                  return reject(errors);
                }
                ctx.subdomain = result.subdomain;
                resolve(ctx.subdomain);
              });
            }
          },
          {
            title: `Promote deployment`,
            task: () =>
              axios({
                method: "post",
                url: `workers/scripts/${ctx.config.package.name}/subdomain`,
                headers: {
                  "Content-Type": "application/json"
                },
                data: { enabled: true }
              }).then(responseHandler())
          }
        ])
    }
  ]);

  const { namespace, versions, subdomain } = await init.run({ config });

  const packaging = new Listr([
    {
      title: "Packaging",
      task: async (ctx, task) => {
        const { stdout, stderr } = await execAsync(`yarn pack --cwd ${folder}`);
        if (stderr) {
          return Promise.reject(stderr);
        }
        ctx.build = stdout.match(/"(.*?)"/)[1];
        return Promise.resolve(stdout);
      }
    }
  ]);

  const { build } = await packaging.run({ config });

  // PUBLISH
  // ===================================================
  // 0 Check if kv namespace exist (if not => INIT)
  // 1 - get dists from KV
  // 2 - check if current version is already in dist => error
  // 3 - publish
  //      - create a tarball named: name@version via pika-pack (https://www.pikapkg.com/blog/introducing-pika-pack/)
  //      - push version to dist
  //      - write dist & version to kv
  const publishing = new Listr([
    {
      title: "Publishing",
      task: () =>
        new Listr([
          {
            title: "Tarball",
            task: ctx => {
              return new Promise(async (resolve, reject) => {
                const { data } = await axios({
                  method: "put",
                  headers: {
                    "Content-Type": "application/tar+gzip"
                  },
                  url: `/storage/kv/namespaces/${
                    ctx.namespace.id
                  }/values/${DPM_NAMESPACE}-${ctx.config.package.name}-${
                    ctx.config.package.version
                  }`,
                  data: createReadStream(ctx.build)
                });

                if (data.errors && data.errors.length) {
                  return reject(data.errors[0]);
                }

                resolve();
              });
            }
          },
          {
            title: "Versions",
            task: ctx => {
              return new Promise(async (resolve, reject) => {
                const { data } = await axios({
                  method: "put",
                  headers: {
                    "Content-Type": "application/json"
                  },
                  url: `/storage/kv/namespaces/${ctx.namespace.id}/values/${
                    ctx.config.kv.versionsKey
                  }`,
                  data: versions.data.concat(ctx.config.package.version)
                });

                if (data.errors && data.errors.length) {
                  return reject(data.errors[0]);
                }

                resolve();
              });
            }
          }
        ])
    }
  ]);

  await publishing.run({ config, namespace, build });

  perf.end();
  const deployStats = `[${perf.duration()}]`;
  const deployUrl = `[https://${
    config.package.name
  }.${subdomain}.workers.dev/${version}]`;

  console.log(
    `✨ Published ${config.package.name}@${version} ${chalk.grey(
      deployUrl
    )} ${chalk.grey(deployStats)}`
  );
};
