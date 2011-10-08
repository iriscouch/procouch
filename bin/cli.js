#!/usr/bin/env node
// The procouch command
//
// Copyright 2011 Iris Couch
//
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
//
//        http://www.apache.org/licenses/LICENSE-2.0
//
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

var optimist = require('optimist')
  , OPTS = optimist.default('log'   , 'info')
                   .default('time_C', 1.0)
                   //.boolean(['kill', 'force', 'reload'])
                   //.default('couch' , DEFAULT_COUCH)
                   //.default('db'    , DEFAULT_DB)
                   //.default('creds' , DEFAULT_CREDS)
                   .usage('Usage: $0 <target>')
  , ARGV = OPTS.argv
  , procouch = require('../api')
  , lib = procouch.lib
  ;

//var LOG = procouch.logging.getLogger('view_heater');

/*
console.log('Process.argv:');
console.dir(process.argv);
console.log('\nARGV:');
console.dir(ARGV);
*/

if(process.argv[1] === module.filename || ARGV.$0 === 'procouch')
  main.apply(null, ['manage'].concat(ARGV._));
else
  main.apply(null, [ ARGV.$0.replace(/_couchdb$/, '') ].concat(ARGV._));

function main(command, target) {
  if(!~ COMMANDS.indexOf(command) || !target)
    return OPTS.showHelp();

  console.log('== Main: ' + lib.JS([command, target]));
}

if(false && process.argv[1] === module.filename) {
  var argv = require('optimist').argv;
  var key;

  if(argv.config) {
    var fd = fs.openSync(argv.config, 'r');
    var config = new Buffer(4096);
    var read = fs.readSync(fd, config, 0, 4096);

    assert.ok(read > 0, "Error reading config: " + argv.config);
    assert.ok(read < 4096, "Config file too big: " + argv.config);

    config = config.toString('utf8', 0, read);
    var getter = new Function('obj', 'return (' + config + ')');
    config = getter();

    LOG.info("Config file: " + argv.config);
    for (key in config)
      if(! (key in argv))
        argv[key] = config[key];
  }

  var defaults = { all: false
                 , age: 3 * 60 * 1000 // 3 minutes in ms
                 , seq: 100
                 , compact: 2000
                 , level: 'debug'
                 }

  for (key in defaults)
    if(! (key in argv))
      argv[key] = defaults[key];

  assert.ok(argv.couch, 'Must provide "--couch" parameter');
  assert.ok(argv.db || argv.all, "Must provide --db=some_db or --all");

  if(argv.user && argv.pass) {
    var prefix = encodeURIComponent(argv.user) + ':' + encodeURIComponent(argv.pass);
    argv.couch = argv.couch.replace(/^(https?:\/\/)(.*)$/, "$1" + prefix + '@$2');
  }

  LOG.setLevel(argv.level);

  if(argv.db) {
    // Heat one database.
    argv.db = lib.join(argv.couch, argv.db);
    return heat_db(argv);
  } else if(argv.all) {
    return heat_couch(argv);
  }
}
