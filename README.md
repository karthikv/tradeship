[![tradeship][logo-image]][tradeship-url]

[![Linux Build][travis-image]][travis-url]
[![Windows Build][appveyor-image]][appveyor-url]
[![NPM Version][npm-image]][npm-url]

tradeship statically analyzes your code for identifiers that aren't defined and
finds the appropriate dependencies to import. It also removes imports that
aren't used. tradeship is meant to be used as an editor plugin that manages your
imports.

![tradeship](http://g.recordit.co/OlDKhJc9LI.gif)

## Features
- Imports dependencies from node.js standard libraries, npm packages listed in
  package.json, and other files within your project directory.
- Imports **properties** that are exported by dependencies using destructuring
  syntax (e.g. `const { readFile } = require("fs");`).
- Automatically identifies the style of your code and makes the imports match
  (e.g. single vs. double quotes, semicolons vs. no semicolons, var vs. let vs.
  const, etc.)
- Statically analyzes files within your project directory to determine their
  exports for use in other files.
- Supports both CommonJS and ES6 modules. Can output `require()` or `import`
  syntax.
- Supports JSX identifiers and ensures React is in scope when using JSX.

## Installation
Install tradeship using npm or yarn. It's recommended to either install
tradeship globally or make the local installation available on your path (e.g.
by adding `export PATH=node_modules/.bin:$PATH` to your shell configuration),
since editor plugins make use of the `tradeship` executable.

```sh
$ npm install -g tradeship
# or use yarn:
$ yarn global add tradeship
```

Then, install the editor plugin of your choice:

- Vim: [`tradeship-vim`](https://github.com/karthikv/tradeship-vim)
- Atom: [`tradeship-atom`](https://github.com/karthikv/tradeship-atom)
- Sublime: [`tradeship-sublime`](https://github.com/karthikv/tradeship-sublime)
- Emacs: [`tradeship-emacs`](https://github.com/karthikv/tradeship-emacs)

Each editor plugin has instructions on how to run tradeship on the current file
being edited. You can also configure each plugin to run tradeship on save. See
the respective links above for more information.

The first time tradeship runs in a project directory with many JavaScript files,
it'll take some time to parse and cache dependencies. Future runs will be much
faster. If you'd like to use tradeship in a large project, it's recommended to
run it once on the command-line, as shown below, so you can see the progress as
it populates the cache:

```sh
tradeship [path]
```

Replace `[path]` with any path to a JavaScript file in your project directory.
Note that this won't modify the file in any way; it'll just print the new code
to stdout. See the [Command Line Interface](#command-line-interface-cli) section
for details.

## Configuration
tradeship doesn't need any configuration to work out of the box. By design,
almost nothing is configurable, as tradeship automatically infers style from
your code. There is, however, one configuration option that you may want to
tweak: environments.

To correctly find identifiers that aren't defined, tradeship needs to know what
global variables are available. It does this through environments, where each
environment defines a set of global variables that come with it. tradeship
piggybacks on [eslint's configuration
system](http://eslint.org/docs/user-guide/configuring) to avoid introducing
another configuration file and format.

In eslint, you specify the enviornments you want in your configuration file,
generally at the root of your project directory. tradeship searches for an
eslint configuration file (either `.eslintrc.js`, `.eslintrc.yaml`,
`.eslintrc.yml`, `.eslintrc.json`, `.eslintrc`, or an `eslintConfig` object in
`package.json`) within the code's directory or successive parent directories.

When it finds one, it looks at the `env` object to determine the active
environments. An example configuration object is:

```js
{
  "env": {
    "browser": true,
    "es6": true
  }
}
```

Each key is an environment name, and the corresponding value is whether that
enviornment is active. See eslint's guide to [specifying
environments](http://eslint.org/docs/user-guide/configuring#specifying-environments)
for more details about the available environments.

If there's no configuration file, `tradeship` assumes the environemnts
`browser`, `node`, and `es6`, bringing in globals from the browser (e.g.
`window` and `document`), from node.js (e.g. `process` and `__dirname`), and from ES6 (e.g. `Set` and `Map`).

Note that tradeship makes all the node.js standard libraries available for
import if and only if the `node` environment is active.

## Command Line Interface (CLI)
Using an editor plugin (see section above) is the easiest way to get started
with tradeship, but you can also use the command line interface (which all
editor plugins use internally).

```sh
tradeship [options] [path]
```

Reads the code given at `[path]`. Outputs new code to stdout, adding missing
dependencies and removing unused ones. The `[options]` are as follows:

- `-s` or `--stdin`: Read contents from stdin as opposed to `[path]`. `[path]`
  is still required so that tradeship can resolve relative imports and find
  available npm packages, but it need not exist as a file; you can even just
  provide a directory.

- `-w` or `--write`: Write output back to `[path]` (be careful!).

- `-h` or `--help`: Print help.

- `-v` or `--version`: Print version.

The full help text is below:

```
Usage: tradeship [options] [path]
Automatically imports missing JS dependencies and removes unused ones.

Options:
-s, --stdin    read contents from stdin
-w, --write    write output to source file (careful!)
-h, --help     print help
-v, --version  print version

Arguments:
[path]  Relative imports and available npm packages will be determined
        from this path. If not --stdin, input code will be read from this
        path. If --write, new code will be written to this path.
```

## Node.js Interface
tradeship exposes a simple node.js API if you'd like to use it programatically:

```js
const tradeship = require("tradeship");
tradeship.import(dir, code).then(newCode => {
  // do something with newCode
});
```

`dir` is the directory used to resolve relative imports and find available npm
packages (generally the directory where the `code` comes from). `code` is the
actual JavaScript code. `tradeship.import()` returns a promise that, when
resolved, gives the resulting new code.

## How it works
`tradeship` analyzes dependencies from three sources: node.js standard
libraries, package.json dependencies, and other files within your project
directory.

For each depedency it finds, tradeship:

- **Determines potential import names**:

  An import name is a variable name you might see in code that refers to the
  dependency. For instance, the import name `fs` would refer to the `fs` node.js
  standard library. The import name `React` would refer to the `react` npm
  package.

  For node.js standard libraries and package.json packages, if the library/package
  name is itself a valid JavaScript identifier, it and its capitalized version are
  potential import names (e.g. `react` and `React` for the `react` npm package).
  If the library/package name has non-word characters or underscores, it is split
  on `[\W_]+` and the parts are joined, both in camel and class case, to get two
  more import names (`childProcess` and `ChildProcess` for the `child_process`
  node.js standard library).

  For project files, the code is statically analyzed to find an import name. For
  instance, if you write `module.exports = SomeExport;`, `SomeExport` will be an
  import name. This is one simple case; there are many others that tradeship
  parses, including those with ES6 `export` syntax. In addition to the analyzed
  import name, tradeship also uses the file path's base name as an import name,
  using the same logic as defined for node.js standard library names above.

- **Determines properties**:

  These are JavaScript object properties that are exported by the dependency. For
  instance, `readFile` is a property of the `fs` node.js standard library.
  `Component` is a property of the `react` npm package. The import name of
  properties is equivalent to the property name.

  For node.js standard libraries and package.json packages, the library is loaded
  within a separate node.js procss, and properties are extracted using
  `Object.keys()`.

  For project files, the code is statically analyzed to find properties. For
  instance, if you write `exports.someProperty = ...;`, `someProperty` will be
  a parsed property. This is one simple case; there are many otehrs that tradeship
  parses, including those with ES6 `export` syntax.

Then, tradeship analyzes your code for identifiers that aren't defined. Each
identifier is a potential import name, and tradeship searches for the
corresponding dependency or property. If it finds a match, it adds the
appropriate import to the code. If multiple dependencies or properties match
a given import name, tradeship prioritizes them as follows:

1. Project file depenedency (highest priority)
1. package.json dependency
1. Node.js standard library dependency
1. Project file property
1. package.json property
1. Node.js standard library property (lowest priority)

tradeship groups all node.js and package.json dependencies together, sorted
lexicographically. It then adds a blank line and all project file dependencies,
also sorted lexicographically.

tradeship finds all imports that aren't used and removes them.

## License
[MIT](https://github.com/karthikv/tradeship/blob/master/LICENSE.md)

[tradeship-url]: https://github.com/karthikv/tradeship
[logo-image]: https://raw.githubusercontent.com/karthikv/tradeship/master/logo.png
[travis-image]: https://img.shields.io/travis/karthikv/tradeship/master.svg?label=linux
[travis-url]: https://travis-ci.org/karthikv/tradeship
[appveyor-image]: https://img.shields.io/appveyor/ci/karthikv/tradeship/master.svg?label=windows
[appveyor-url]: https://ci.appveyor.com/project/karthikv/tradeship
[npm-image]: https://img.shields.io/npm/v/tradeship.svg
[npm-url]: https://npmjs.org/package/tradeship
