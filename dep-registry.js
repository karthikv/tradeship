const fs = require("fs");
const path = require("path");
const repl = require("repl");
const vm = require("vm");
const os = require("os");
const crypto = require("crypto");

const parser = require("./parser");
const { promisify } = require("./common");
const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const writeFile = promisify(fs.writeFile);

const identRegex = /^[$a-z_][0-9a-z_$]*$/i;
const propsScript = new vm.Script(
  "const object = require(id);" +
    "props = Object.keys(object);" +
    "hasDefault = Boolean(object.__esModule) && Boolean(object.default);"
);

class DepRegistry {
  /* public interface */

  static populate() {
    if (this.promise) {
      return this.promise;
    }
    if (this.instance) {
      return Promise.resolve(this.instance);
    }

    const instance = new DepRegistry();
    this.promise = instance.populate().then(() => {
      this.instance = instance;
      return instance;
    });
    return this.promise;
  }

  constructor() {
    // registry[id] is a dep that has the given id
    this.registry = {};

    // deps[name] is a dep that corresponds to the identifier name
    this.deps = {};
  }

  search(name) {
    return this.deps[name];
  }

  /* private interface */

  populate() {
    return this
      .findPkgMeta()
      .then(() => this.readCache())
      .then(cache => {
        repl._builtinLibs.forEach(id => {
          const entry = this.register(cache, id, process.version);
          if (entry) {
            this.populateIdents(entry, id);
            this.populatePropsDefaults(entry, id);
          }
        });

        const dependencies = Object.assign(
          {},
          this.meta.devDependencies,
          this.meta.dependencies
        );

        for (const id in dependencies) {
          const entry = this.register(cache, id, dependencies[id]);
          if (entry) {
            this.populateIdents(entry, id);
            this.populatePropsDefaults(
              entry,
              path.join(this.dir, "node_modules", id)
            );
          }
        }

        return this.populateDir(cache, this.dir);
      })
      .then(() => writeFile(this.cachePath, JSON.stringify(this.registry)))
      .then(() => this.computeDeps());
  }

  findPkgMeta(dir) {
    if (!dir) {
      dir = path.resolve(".");
    }

    return readFile(path.join(dir, "package.json"))
      .catch(err => {
        if (err.code === "ENOENT") {
          if (dir === "/") {
            return null;
          }
          return this.findPkgMeta(path.join(dir, ".."));
        } else {
          throw err;
        }
      })
      .then(json => {
        this.meta = JSON.parse(json);
        this.dir = dir;

        const hash = crypto.createHash("sha256");
        hash.update(dir);
        this.cachePath = path.join(os.tmpdir(), hash.digest("hex"));
      });
  }

  readCache() {
    return readFile(this.cachePath, "utf8")
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
    let base;
    if (id.indexOf("/") === -1) {
      base = id;
    } else {
      base = path.basename(id, path.extname(id));
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
    // extract props of this dep by running Object.keys() in a V8 VM
    const context = { require, id };

    try {
      propsScript.runInNewContext(context);
    } catch (e) {
      // ignore errors from requiring this dep; we just won't populate props
    }

    if (context.props) {
      context.props.forEach(p => entry.props.push(p));
    }
    if (context.hasDefault) {
      // assume all idents are actually defaults
      entry.idents.forEach(i => entry.defaults.push(i));
      entry.idents = [];
    }
  }

  populateDir(cache, dir) {
    return readdir(dir).then(files => {
      const promises = files.map(file => {
        if (file[0] === ".") {
          return Promise.resolve();
        }

        const filePath = path.join(dir, file);
        return stat(filePath).then(s => {
          const ext = path.extname(file);

          if (s.isFile() && (ext === ".js" || ext === ".jsx")) {
            const entry = this.register(cache, filePath, s.mtime.getTime());
            if (entry) {
              return this.populateFile(entry, filePath);
            }
          } else if (
            s.isDirectory() &&
            file !== "node_modules" &&
            file !== "bower_components"
          ) {
            return this.populateDir(cache, filePath);
          }
        });
      });

      return Promise.all(promises);
    });
  }

  populateFile(entry, filePath) {
    return readFile(filePath, "utf8").then(code => {
      const exports = parser.run(code);
      if (exports.hasExports) {
        exports.idents.forEach(i => entry.idents.push(i));
        exports.defaults.forEach(d => entry.defaults.push(d));
        exports.props.forEach(p => entry.props.push(p));
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
    const node = {};
    repl._builtinLibs.forEach(id => node[id] = true);

    for (const id in this.registry) {
      let priority;
      if (node[id]) {
        // node library; lowest priority
        priority = 3;
        // TODO: namespaced deps
      } else if (id.indexOf("/") === -1) {
        // project file; highest priority
        priority = 1;
      } else {
        // package.json dependency; middle priority
        priority = 2;
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
