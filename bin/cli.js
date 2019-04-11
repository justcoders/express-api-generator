#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const util = require('util');
const readline = require('readline');

const program = require('commander');
const ejs = require('ejs');
const mkdirp = require('mkdirp');
const minimatch = require('minimatch');
const sortedObject = require('sorted-object');

const MODE_0666 = parseInt('0666', 8);
const MODE_0755 = parseInt('0755', 8);
const VERSION = require('../package').version;

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');

const _exit = process.exit;

process.exit = exit;

// CLI

around(program, 'optionMissingArgument', (fn, args) => {
  program.outputHelp();
  fn.apply(this, args);
  return { args: [], unknown: [] };
});

before(program, 'outputHelp', () => {
  // track if help was shown for unknown option
  this._helpShown = true
});

before(program, 'unknownOption', () => {
  // allow unknown options if help was shown, to prevent trailing error
  this._allowUnknownOption = this._helpShown;

  // show help if not yet shown
  if (!this._helpShown) {
    program.outputHelp()
  }
});

program
  .name('jc-express-api')
  .version(VERSION, '    --version')
  .usage('[options] [dir]')
  .option('    --git', 'add .gitignore')
  .option('    --docker', 'add Dockerfile')
  .option('-f, --force', 'force on non-empty directory')
  .parse(process.argv);

if (!exit.exited) {
  main()
}

/**
 * Install an around function; AOP.
 */

function around (obj, method, fn) {
  let old = obj[method];

  obj[method] = () => {
    const args = new Array(arguments.length);
    for (let i = 0; i < args.length; i++) args[i] = arguments[i];
    return fn.call(this, old, args);
  }
}

/**
 * Install a before function; AOP.
 */

function before (obj, method, fn) {
  let old = obj[method];

  obj[method] = () => {
    fn.call(this);
    old.apply(this, arguments)
  }
}

/**
 * Prompt for confirmation on STDOUT/STDIN
 */

function confirm (msg, callback) {
  let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question(msg, function (input) {
    rl.close();
    callback(/^y|yes|ok|true$/i.test(input));
  })
}

/**
 * Copy file from template directory.
 */

function copyTemplate (from, to) {
  write(to, fs.readFileSync(path.join(TEMPLATE_DIR, from), 'utf-8'));
}

/**
 * Copy multiple files from template directory.
 */

function copyTemplateMulti (fromDir, toDir, nameGlob) {
  fs.readdirSync(path.join(TEMPLATE_DIR, fromDir))
    .filter(minimatch.filter(nameGlob, { matchBase: true }))
    .forEach((name) => copyTemplate(path.join(fromDir, name), path.join(toDir, name)));
}

/**
 * Create application at the given directory.
 *
 * @param {string} name
 * @param {string} dir
 */

function createAPI (name, dir) {
  console.log();

  // Package
  let pkg = {
    name: name,
    version: '0.0.0',
    private: true,
    scripts: {
      start: 'node ./bin/www'
    },
    dependencies: {
      'debug': '~2.6.9',
      'express': '~4.16.1',
      'morgan': '~1.9.0'
    }
  };

  const www = loadTemplate('www');
  www.locals.name = name;

  const config = loadTemplate('config.js');
  config.locals.name = name;

  if (dir !== '.') {
    mkdir(dir, '.')
  }

  copyTemplate('app.js', path.join(dir, 'app.js'));
  copyTemplate('routes.js', path.join(dir, 'routes.js'));

  // sort dependencies like npm(1)
  pkg.dependencies = sortedObject(pkg.dependencies);

  // write files
  mkdir(dir, 'bin');
  mkdir(dir, 'controllers');
  mkdir(dir, 'middlewares');
  write(path.join(dir, 'bin/www'), www.render(), MODE_0755);
  write(path.join(dir, 'config.js'), config.render());
  write(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  if (program.git) {
    copyTemplate('gitignore', path.join(dir, '.gitignore'));
  }

  if (program.docker) {
    copyTemplate('Dockerfile', path.join(dir, 'Dockerfile'));
  }

  const prompt = launchedFromCmd() ? '>' : '$';

  if (dir !== '.') {
    console.log();
    console.log('   change directory:');
    console.log('     %s cd %s', prompt, dir)
  }

  console.log();
  console.log('   install dependencies:');
  console.log('     %s npm install', prompt);
  console.log();
  console.log('   run the app:');

  if (launchedFromCmd()) {
    console.log('     %s SET DEBUG=%s:* & npm start', prompt, name)
  } else {
    console.log('     %s DEBUG=%s:* npm start', prompt, name)
  }

  console.log();
}

/**
 * Create an app name from a directory path, fitting npm naming requirements.
 *
 * @param {String} pathName
 */

function createAppName (pathName) {
  return path.basename(pathName)
    .replace(/[^A-Za-z0-9.-]+/g, '-')
    .replace(/^[-_.]+|-+$/g, '')
    .toLowerCase()
}

/**
 * Check if the given directory `dir` is empty.
 *
 * @param {String} dir
 * @param {Function} fn
 */

function emptyDirectory (dir, fn) {
  fs.readdir(dir, function (err, files) {
    if (err && err.code !== 'ENOENT') throw err
    fn(!files || !files.length)
  })
}

/**
 * Graceful exit for async STDIO
 */

function exit (code) {
  function done () {
    if (!(draining--)) _exit(code)
  }

  let draining = 0;
  const streams = [process.stdout, process.stderr];

  exit.exited = true;

  streams.forEach((stream) => {
    // submit empty write request and wait for completion
    draining += 1;
    stream.write('', done);
  });

  done()
}

/**
 * Determine if launched from cmd.exe
 */

function launchedFromCmd () {
  return process.platform === 'win32' && process.env._ === undefined;
}

/**
 * Load template file.
 */

function loadTemplate (name) {
  const contents = fs.readFileSync(path.join(__dirname, '..', 'templates', (name + '.ejs')), 'utf-8');
  const locals = Object.create(null);

  function render () {
    return ejs.render(contents, locals, {
      escape: util.inspect
    })
  }

  return {
    locals: locals,
    render: render
  }
}

/**
 * Main program.
 */

function main () {
  // Path
  const destinationPath = program.args.shift() || '.';

  // App name
  const appName = createAppName(path.resolve(destinationPath)) || 'hello-world-api';

  // Generate application
  emptyDirectory(destinationPath, (empty) => {
    if (empty || program.force) {
      createAPI(appName, destinationPath)
    } else {
      confirm('destination is not empty, continue? [y/N] ', (ok)=> {
        if (ok) {
          process.stdin.destroy();
          createAPI(appName, destinationPath)
        } else {
          console.error('aborting');
          exit(1)
        }
      })
    }
  })
}

/**
 * Make the given dir relative to base.
 *
 * @param {string} base
 * @param {string} dir
 */

function mkdir (base, dir) {
  const loc = path.join(base, dir);

  console.log('   \x1b[36mcreate\x1b[0m : ' + loc + path.sep);
  mkdirp.sync(loc, MODE_0755)
}

/**
 * Generate a callback function for commander to warn about renamed option.
 *
 * @param {String} originalName
 * @param {String} newName
 */

function renamedOption (originalName, newName) {
  return (val) => {
    warning(util.format("option `%s' has been renamed to `%s'", originalName, newName));
    return val
  }
}

/**
 * Display a warning similar to how errors are displayed by commander.
 *
 * @param {String} message
 */

function warning (message) {
  console.error();
  message.split('\n').forEach((line) => console.error('  warning: %s', line));
  console.error()
}

/**
 * echo str > file.
 *
 * @param {String} file
 * @param {String} str
 * @param {String} mode
 */

function write (file, str, mode) {
  fs.writeFileSync(file, str, { mode: mode || MODE_0666 });
  console.log('   \x1b[36mcreate\x1b[0m : ' + file)
}
