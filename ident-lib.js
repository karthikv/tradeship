const fs = require("fs");
const path = require("path");
const repl = require("repl");
const vm = require("vm");

const { promisify } = require("./common");
const readFile = promisify(fs.readFile);

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
    repl._builtinLibs.forEach(lib =>
      this.populateDep({ idents, props, dep: lib }));

    return this.findPkgMeta().then(([meta, root]) => {
      if (meta) {
        const deps = Object.keys(meta.dependencies)
          .concat(Object.keys(meta.devDependencies));
        deps.forEach(dep => this.populateDep({ idents, props, root, dep }));
      }

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

  static populateDep({ idents, props, root, dep }) {
    if (identRegex.test(dep)) {
      idents[dep] = dep;
    }

    const camelCase = dep
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

    // extract props of this dep by running Object.keys() in a V8 VM
    const context = {
      require,
      dep: root ? path.join(root, "node_modules", dep) : dep
    };
    propsScript.runInNewContext(context);
    context.props.forEach(k => props[k] = dep);
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
