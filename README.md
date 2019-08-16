DPM CLI
-------

Distributed package manager POC.

This CLI allow to publish npm compatible packages on the edge, removing the need of a centrilized registry like npm.

**Publishing packages** will have the same flow/API as when using `npm` or `yarn`:

```
dpm publish .
```

**Installing packages** from our edge will be 100% compatible with the existing package manager solution (ie: npm, yarn) and will be a matter of:

```
yarn add package-name.domain.com/^1.1.1
# or npm install package-name.domain.com/^1.1.1
```



## Architecture

- Behind the scene each package will be handled by a worker attached to a specific route, ie: package-name.nb.workers.dev (currently for semplicity relyin on zoneless workers to set a subdomain)
- The worker contains logic able to resolve semver path, ie `/^1.1.1` or `/1.1.x` and return a matching available version
- Tarballs are stored in KV with key: `dpm-package-name-version` and value the tarball src
- The KV will also store a special key `dpm-package-name-versions` containing an array with all the available versions

## Notes
- at the moment not all the commands available in npm or yarn cli are included/supported (ie: pack,..)
- no metainformation can be retrieved by the package endpoint, this could be included when no path is passed, see https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md
- when using url, yarn cache on them, making semver url ineffective. The solution could be to have a single worker serve all the packages, and "imitate" a npm registry, so that its url could be added to yarnrc/npmrc, ecc
- ipfs has been explored and for the moment is not a viable solution, as while ipfs provide permanent paths, doesn't assure persistency, forcing  to run a node with our assets pinned (to avoid ipfs garbace collection)

