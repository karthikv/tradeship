"use strict";

const path = require("path");
const repl = require("repl");
const os = require("os");
const crypto = require("crypto");
const { NodeVM, VMScript } = require("vm2");

const parser = require("./parser");
const { readFile, writeFile, stat, readdir, pkgRegex } = require("./common");
const ProgressBar = require("./progress-bar");

const identRegex = /^[$a-z_][0-9a-z_$]*$/i;
const propsScript = new VMScript(
  [
    "const object = require(id);",
    "return {",
    "  props: Object.keys(object),",
    "  hasDefault: Boolean(object.__esModule) && Boolean(object.default)",
    "};"
  ].join("\n")
);

const isNodeID = {};
repl._builtinLibs.forEach(id => isNodeID[id] = true);

class DepRegistry {
  /* public interface */

  static populate(config, dir, meta) {
    if (this.promises && this.promises[dir]) {
      return this.promises[dir].then(instance => instance.copy(config));
    }

    const instance = new DepRegistry(config);
    this.promises = this.promises || {};
    this.promises[dir] = instance.populate(meta).then(() => instance);
    return this.promises[dir];
  }

  constructor(config = null, registry = null, deps = null) {
    this.config = config;

    // registry[id] is an entry that has the given id
    this.registry = registry || {};

    // deps[name] is a dep that corresponds to the identifier name
    this.deps = deps || {};
  }

  search(name) {
    const dep = this.deps[name];
    if (dep && !this.config.env.node && isNodeID[dep.id]) {
      return null;
    }
    return dep;
  }

  /* private interface */

  copy(config) {
    return new DepRegistry(config, this.registry, this.deps);
  }

  populate(meta) {
    const hash = crypto.createHash("sha256");
    hash.update(meta ? meta.root : "-");
    const cachePath = path.join(os.tmpdir(), hash.digest("hex"));

    return Promise
      .all([
        this.readCache(cachePath),
        this.findSourceFiles(meta ? meta.root : null)
      ])
      .then(([cache, sourceFiles]) => {
        sourceFiles = sourceFiles || [];
        let dependencies = {};
        if (meta) {
          dependencies = Object.assign(
            {},
            meta.devDependencies,
            meta.dependencies
          );
        }

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

        repl._builtinLibs.forEach(id => {
          const entry = this.register(cache, id, process.version);
          if (entry) {
            this.populateIdents(entry, id);
            this.populatePropsDefaults(entry, id);
          }
          progress.tick();
        });

        for (const id in dependencies) {
          const entry = this.register(cache, id, dependencies[id]);
          if (entry) {
            this.populateIdents(entry, id);
            this.populatePropsDefaults(
              entry,
              path.join(meta.root, "node_modules", id)
            );
          }
          progress.tick();
        }

        const promises = sourceFiles.map(sf => {
          const entry = this.register(cache, sf.path, sf.version);
          if (entry) {
            return this
              .populateFile(entry, sf.path)
              .then(() => progress.tick());
          }
          progress.tick();
        });

        return Promise.all(promises);
      })
      .then(() => writeFile(cachePath, JSON.stringify(this.registry)))
      .then(() => this.computeDeps());
  }

  readCache(cachePath) {
    return readFile(cachePath, "utf8")
      .catch(err => {
        if (err.code !== "ENOENT") {
          throw err;
        }
        return {};
      })
      .then(contents => {
        try {
          return JSON.parse(contents);
        } catch (err) {
          if (
            err.name !== "SyntaxError" || err.message.indexOf("JSON") === -1
          ) {
            throw err;
          }
          return {};
        }
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
      .split(/[\W_]+/g)
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
    const vm = new NodeVM({
      console: "redirect",
      sandbox: { id },
      require: {
        external: true,
        builtin: repl._builtinLibs,
        context: "sandbox"
      },
      wrapper: "none"
    });

    let props;
    let hasDefault;

    try {
      // extract props of this dep by running Object.keys() in a V8 VM
      ({ props, hasDefault } = vm.run(propsScript));
    } catch (e) {
      // ignore errors from requiring this dep; we just won't populate props
      return;
    }

    if (props) {
      props.forEach(p => entry.props.push(p));
    }
    if (hasDefault) {
      // assume all idents are actually defaults
      entry.idents.forEach(i => entry.defaults.push(i));
      entry.idents = [];
    }
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
      .then(code => parser.run(path.dirname(filePath), code))
      .then(exports => {
        if (exports && exports.hasExports) {
          exports.defaults.forEach(d => entry.defaults.push(d));
          exports.props.forEach(p => entry.props.push(p));

          exports.idents.forEach(i => entry.idents.push(i));
          this.populateIdents(entry, filePath);

          if (entry.defaults.length > 0) {
            // assume all idents are actually defaults
            entry.idents.forEach(i => {
              if (entry.defaults.indexOf(i) === -1) {
                entry.defaults.push(i);
              }
            });
            entry.idents = [];
          }
        }
      });
  }

  register(cache, id, version) {
    if (!cache[id] || cache[id].version !== version) {
      const entry = {
        version,
        idents: [],
        defaults: [],
        props: []
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

      const { idents, defaults, props } = this.registry[id];
      idents.forEach(name => this.associate({
        name,
        id,
        priority,
        type: types.ident
      }));
      defaults.forEach(name => this.associate({
        name,
        id,
        priority,
        type: types.default
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
      dep.type === types.prop && type !== types.prop
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
