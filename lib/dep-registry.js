"use strict";

const { spawn } = require("child_process");
const crypto = require("crypto");
const https = require("https");
const os = require("os");
const path = require("path");
const qs = require("querystring");
const repl = require("repl");
const util = require("util");

const {
  debug,
  pkgRegex,
  readFile,
  readdir,
  stat,
  tryJSONParse,
  writeFile
} = require("./common");
const parser = require("./parser");
const ProgressBar = require("../patches/progress.js");

const identRegex = /^[$a-z_][0-9a-z_$]*$/i;
const nonWordRegex = /[\W_]+/g;
const propsScript = [
  'const object = require("%s");',
  "const json = JSON.stringify({",
  "  props: Object.keys(object),",
  "  hasDefault: Boolean(object.__esModule) && Boolean(object.default)",
  "});",
  "console.log(json);"
].join("");

const isNodeID = {};
repl._builtinLibs.forEach(id => isNodeID[id] = true);

const cacheVersion = "v1";

class DepRegistry {
  /* public interface */

  static populate(dir, meta) {
    if (this.promises && this.promises[dir]) {
      return this.promises[dir].then(instance => instance.copy(meta.env));
    }

    const instance = new DepRegistry(meta.env);
    this.promises = this.promises || {};
    this.promises[dir] = instance.populate(meta).then(() => instance);
    return this.promises[dir];
  }

  constructor(env = null, registry = null, deps = null) {
    this.env = env;

    // registry[id] is an entry that has the given id
    this.registry = registry || {};

    // deps[name] is a dep that corresponds to the identifier name
    this.deps = deps || {};
  }

  search(name) {
    const dep = this.deps[name];
    if (dep && !this.env.node && isNodeID[dep.id]) {
      return null;
    }
    return dep;
  }

  /* private interface */

  copy(env) {
    return new DepRegistry(env, this.registry, this.deps);
  }

  populate(meta) {
    const hash = crypto.createHash("sha256");
    hash.update(meta.root || "-");
    const cachePath = path.join(
      os.tmpdir(),
      `tradeship-dir-${hash.digest("hex")}`
    );

    return Promise
      .all([this.readCache(cachePath), this.findSourceFiles(meta.root)])
      .then(([cache, sourceFiles]) => {
        this.registry._version = cache._version;
        sourceFiles = sourceFiles || [];

        const dependencies = Object.assign(
          {},
          meta.devDependencies,
          meta.dependencies
        );
        const total = repl._builtinLibs.length +
          Object.keys(dependencies).length +
          sourceFiles.length;
        const progress = new ProgressBar(
          "Populating dependencies [:bar] :percent :current/:total",
          {
            total,
            incomplete: " ",
            width: Math.min(total, 40),
            clear: true
          }
        );

        const promises = [];
        const tick = () => progress.tick();
        const entriesByID = {};

        repl._builtinLibs.forEach(id => {
          const entry = this.register(cache, id, process.version);
          if (entry) {
            this.populateIdents(entry, id);
            promises.push(this.populatePropsDefaults(entry, id).then(tick));
            entriesByID[id] = entry;
          } else {
            progress.tick();
          }
        });

        for (const id in dependencies) {
          const entry = this.register(cache, id, dependencies[id]);
          if (entry) {
            this.populateIdents(entry, id);
            const absPath = path.join(meta.root, "node_modules", id);

            promises.push(
              this.populatePropsDefaults(entry, absPath).then(tick)
            );
            entriesByID[id] = entry;
          } else {
            progress.tick();
          }
        }

        promises.push(this.populateDockIdents(entriesByID));

        sourceFiles.forEach(sf => {
          const entry = this.register(cache, sf.path, sf.version);
          if (entry) {
            promises.push(this.populateFile(entry, sf.path).then(tick));
          } else {
            progress.tick();
          }
        });

        return Promise.all(promises);
      })
      .then(() => writeFile(cachePath, JSON.stringify(this.registry)))
      .then(() => this.computeDeps());
  }

  readCache(cachePath) {
    return readFile(cachePath, "utf8")
      .catch(err => {
        if (err.code === "ENOENT") {
          return null;
        }
        throw err;
      })
      .then(contents => {
        const cache = tryJSONParse(contents, {});
        if (cache._version !== cacheVersion) {
          // reset cache, setting the new version
          return { _version: cacheVersion };
        }
        return cache;
      });
  }

  populateIdents(entry, id) {
    const ext = path.extname(id);
    let base;
    if (ext === ".js" || ext === ".jsx") {
      base = path.basename(id, ext);
    } else {
      base = path.basename(id);
    }

    if (identRegex.test(base)) {
      entry.idents.push(base);
    }

    const camelCase = base
      .split(nonWordRegex)
      .filter(p => p !== "")
      .map((p, i) => i === 0 ? p : p[0].toUpperCase() + p.slice(1))
      .join("");

    if (camelCase.length > 0) {
      if (camelCase !== base) {
        entry.idents.push(camelCase);
      }

      const classCase = camelCase[0].toUpperCase() + camelCase.slice(1);
      entry.idents.push(classCase);
    }
  }

  populatePropsDefaults(entry, id) {
    const escapedID = id.replace(/"/g, '\\"');
    const cmd = spawn("node", ["-e", util.format(propsScript, escapedID)]);

    const promise = new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      cmd.stdout.on("data", chunk => stdout += chunk);
      cmd.stderr.on("data", chunk => stderr += chunk);

      cmd.on("close", code => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(
            `bad code: ${code}; stderr: ${stderr}`,
            code,
            stderr
          ));
        }
      });
      cmd.on("error", err => reject(err));
    });

    return promise.then(
      json => {
        const { props, hasDefault } = tryJSONParse(json, {});

        if (props) {
          props.forEach(p => entry.props.push(p));
        }
        if (hasDefault) {
          entry.useDefault = true;
        }
      },
      // ignore errors from requiring this dep; we just won't populate props
      err => debug("Couldn't populate props for %s: %O", path.basename(id), err)
    );
  }

  populateDockIdents(entriesByID) {
    const ids = Object.keys(entriesByID);
    if (ids.length === 0) {
      return Promise.resolve();
    }

    const options = {
      hostname: "dock.karthikv.net",
      path: `/load?${qs.stringify({ ids: ids.join(",") })}`
    };

    return new Promise((resolve, reject) => {
      const request = https.request(options, response => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", chunk => body += chunk);
        response.on("end", () => resolve(body));
      });

      request.on("error", reject);
      request.end();
    }).then(body => {
      const identMap = tryJSONParse(body, {});
      for (const pkg in identMap) {
        const entry = entriesByID[pkg];
        // take the top three most-frequent idents
        const idents = identMap[pkg].slice(0, 3).concat(entry.idents);
        entry.idents = Array.from(new Set(idents));
      }
    });
  }

  findSourceFiles(dir) {
    if (!dir) {
      return [];
    }

    return readdir(dir).then(files => {
      const sourceFiles = [];
      const promises = files.map(file => {
        if (file[0] === ".") {
          return Promise.resolve();
        }

        const filePath = path.join(dir, file);
        return stat(filePath).then(s => {
          const ext = path.extname(file);

          if (s.isFile() && (ext === ".js" || ext === ".jsx")) {
            sourceFiles.push({
              path: filePath,
              version: s.mtime.getTime()
            });
          } else if (
            s.isDirectory() &&
            file !== "node_modules" &&
            file !== "bower_components"
          ) {
            return this
              .findSourceFiles(filePath)
              .then(s => sourceFiles.push(...s));
          }
        });
      });

      return Promise.all(promises).then(() => sourceFiles);
    });
  }

  populateFile(entry, filePath) {
    return readFile(filePath, "utf8")
      .then(code => parser.run(path.dirname(filePath), code).catch(err => {
        debug("Parsing failed for %s: %O", filePath, err);
        return null;
      }))
      .then(exported => {
        if (!exported || !exported.hasExports) {
          return;
        }

        this.populateIdents(entry, filePath);
        exported.idents.forEach(i => entry.idents.push(i));
        exported.props.forEach(p => entry.props.push(p));

        if (exported.hasDefault) {
          entry.useDefault = true;
        }
      });
  }

  register(cache, id, version) {
    if (!cache[id] || cache[id].version !== version) {
      const entry = {
        version,
        idents: [],
        props: [],
        useDefault: false
      };
      this.registry[id] = entry;
      return entry;
    } else {
      this.registry[id] = cache[id];
      // don't return entry; the cached data is valid
      return null;
    }
  }

  computeDeps() {
    for (const id in this.registry) {
      if (id === "_version") {
        continue;
      }

      let priority;
      if (isNodeID[id]) {
        // node library; lowest priority
        priority = 1;
      } else if (pkgRegex.test(id)) {
        // package.json dependency; middle priority
        priority = 2;
      } else {
        // project file; highest priority
        priority = 3;
      }

      const { idents, props, useDefault } = this.registry[id];
      idents.forEach(name => this.associate({
        name,
        id,
        priority,
        type: useDefault ? types.default : types.ident
      }));
      props.forEach(name => this.associate({
        name,
        id,
        priority,
        type: types.prop
      }));
    }
  }

  associate({ name, id, priority, type }) {
    const dep = this.deps[name];
    if (
      !dep ||
      dep.priority < priority ||
      // idents and defaults are prioritized over props
      dep.priority === priority &&
        dep.type === types.prop &&
        type !== types.prop
    ) {
      this.deps[name] = { id, priority, type };
    }
  }
}

DepRegistry.types = {
  ident: 1,
  default: 2,
  prop: 3
};
const types = DepRegistry.types;

module.exports = DepRegistry;
