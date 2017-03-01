const fs = require("fs");
const path = require("path");
const repl = require("repl");
const vm = require("vm");

const parser = require("./parser");
const { promisify } = require("./common");
const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

const identRegex = /^[$a-z_][0-9a-z_$]*$/i;
const propsScript = new vm.Script("props = Object.keys(require(id));");

const priorities = {
  file: 1,
  pkg: 2,
  node: 3,
  inferred: 4
};

module.exports = class DepRegistry {
  /* public interface */

  static populate() {
    if (this.instance) {
      return Promise.resolve(this.instance);
    }

    const instance = new DepRegistry();
    return instance.populate().then(() => {
      this.instance = instance;
      return instance;
    });
  }

  constructor() {
    this.deps = {};
  }

  search(name) {
    return this.deps[name];
  }

  /* private interface */

  populate() {
    // TODO: should we get props for standard libraries?
    repl._builtinLibs.forEach(id => {
      this.populateIdents(id, priorities.node);
      this.populateProps(id, priorities.node);
    });

    return this.findPkgMeta().then(([meta, root]) => {
      if (meta) {
        const ids = Object.keys(meta.dependencies)
          .concat(Object.keys(meta.devDependencies));
        ids.forEach(id => {
          this.populateIdents(id, priorities.pkg);
          this.populateProps(id, priorities.pkg, root);
        });
      }

      return this.populateDir(root);
    });
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
      .then(json => [JSON.parse(json), dir]);
  }

  populateIdents(id, priority) {
    let base;
    if (id.indexOf("/") === -1) {
      base = id;
    } else {
      base = path.basename(id, path.extname(id));
    }

    if (identRegex.test(base)) {
      this.register({ id, priority, name: base, isProp: false });
    }

    const camelCase = base
      .split(/\W+/g)
      .filter(p => p !== "")
      .map((p, i) => i === 0 ? p : p[0].toUpperCase() + p.slice(1))
      .join("");

    if (camelCase.length > 0) {
      const classCase = camelCase[0].toUpperCase() + camelCase.slice(1);
      // TODO: handle case of multiple matches for same ident?
      this.register({ id, priority, name: camelCase, isProp: false });
      this.register({ id, priority, name: classCase, isProp: false });
    }
  }

  populateProps(id, priority, root = null) {
    // extract props of this dep by running Object.keys() in a V8 VM
    const context = {
      require,
      id: root ? path.join(root, "node_modules", id) : id
    };
    propsScript.runInNewContext(context);
    if (context.props) {
      context.props.forEach(name =>
        this.register({ name, id, priority, isProp: true }));
    }
  }

  populateDir(dir) {
    return readdir(dir).then(files => {
      const promises = files.map(file => {
        if (file[0] === ".") {
          return Promise.resolve();
        }

        const filePath = path.join(dir, file);
        return stat(filePath).then(s => {
          const ext = path.extname(file);
          if (s.isFile() && (ext === ".js" || ext === ".jsx")) {
            return this.populateFile(filePath);
          } else if (
            s.isDirectory() &&
            file !== "node_modules" &&
            file !== "bower_components"
          ) {
            return this.populateDir(filePath);
          }
        });
      });

      return Promise.all(promises);
    });
  }

  populateFile(filePath) {
    return readFile(filePath, "utf8").then(code => {
      const exports = parser.run(code);
      if (exports.hasExports) {
        exports.idents.forEach(name => this.register({
          name,
          id: filePath,
          priority: priorities.file,
          isProp: false
        }));
        exports.props.forEach(name => this.register({
          name,
          id: filePath,
          priority: priorities.file,
          isProp: true
        }));
        this.populateIdents(filePath, priorities.file);
      }
    });
  }

  register({ name, id, priority, isProp }) {
    const dep = this.deps[name];
    if (
      !dep ||
      // idents are prioritized over props
      dep.isProp && !isProp ||
      dep.isProp === isProp && dep.priority < priority
    ) {
      this.deps[name] = { id, priority, isProp };
    }
  }
};
