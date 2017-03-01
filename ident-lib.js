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
const propsScript = new vm.Script("props = Object.keys(require(dep));");

module.exports = class IdentLib {
  static populate() {
    if (this.instance) {
      return Promise.resolve(this.instance);
    }

    const idents = {};
    const props = {};

    // TODO: should we get props for standard libraries?
    repl._builtinLibs.forEach(lib => {
      this.populateDepIdents(idents, lib);
      this.populateDepProps(props, lib);
    });

    return this
      .findPkgMeta()
      .then(([meta, root]) => {
        if (meta) {
          const deps = Object.keys(meta.dependencies)
            .concat(Object.keys(meta.devDependencies));
          deps.forEach(dep => {
            this.populateDepIdents(idents, dep);
            this.populateDepProps(props, dep, root);
          });
        }

        return this.populateDir({ idents, props, dir: root });
      })
      .then(() => {
        this.instance = new IdentLib(idents, props);
        return this.instance;
      });
  }

  static findPkgMeta(dir) {
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

  static populateDepIdents(idents, dep) {
    let base;
    if (dep.indexOf("/") === -1) {
      base = dep;
    } else {
      base = path.basename(dep, path.extname(dep));
    }

    if (identRegex.test(base)) {
      idents[base] = dep;
    }

    const camelCase = base
      .split(/\W+/g)
      .filter(p => p !== "")
      .map((p, i) => i === 0 ? p : p[0].toUpperCase() + p.slice(1))
      .join("");

    if (camelCase.length > 0) {
      const classCase = camelCase[0].toUpperCase() + camelCase.slice(1);
      // TODO: handle case of multiple matches for same ident?
      idents[camelCase] = dep;
      idents[classCase] = dep;
    }
  }

  static populateDepProps(props, dep, root) {
    // extract props of this dep by running Object.keys() in a V8 VM
    const context = {
      require,
      dep: root ? path.join(root, "node_modules", dep) : dep
    };
    propsScript.runInNewContext(context);
    if (context.props) {
      context.props.forEach(k => props[k] = dep);
    }
  }

  static populateDir({ idents, props, dir }) {
    return readdir(dir).then(files => {
      const promises = files.map(file => {
        if (file[0] === ".") {
          return Promise.resolve();
        }

        const filePath = path.join(dir, file);
        return stat(filePath).then(s => {
          const ext = path.extname(file);
          if (s.isFile() && (ext === ".js" || ext === ".jsx")) {
            return this.populateFile({ idents, props, filePath });
          } else if (
            s.isDirectory() &&
            file !== "node_modules" &&
            file !== "bower_components"
          ) {
            return this.populateDir({ idents, props, dir: filePath });
          }
        });
      });

      return Promise.all(promises);
    });
  }

  static populateFile({ idents, props, filePath }) {
    return readFile(filePath, "utf8").then(code => {
      const exports = parser.run(code);
      if (exports.hasExports) {
        exports.idents.forEach(i => idents[i] = filePath);
        exports.props.forEach(p => props[p] = filePath);
        this.populateDepIdents(idents, filePath);
      }
    });
  }

  constructor(idents, props) {
    this.idents = idents;
    this.props = props;
  }

  search(ident) {
    if (this.idents[ident]) {
      return { dep: this.idents[ident], isProp: false };
    }
    return { dep: this.props[ident], isProp: true };
  }
};
