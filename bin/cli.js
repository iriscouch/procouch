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

var procouch = require('../api')
  , config = require('../lib/config')
  , lib = procouch.lib
  ;

var LOG = procouch.logging.getLogger('procouch');
LOG.setLevel(process.env.procouch_log || 'info');

LOG.debug('Process.argv: ' + lib.JS(process.argv));
//console.log('\nARGV:');
//console.dir(ARGV);

if(process.argv[1] === module.filename || config.ARGV.$0 === 'procouch')
  main();

function main() {
  var targets = config.targets();

  if(targets.length < 0)
    return config.usage();

  console.log('== Main: ' + lib.JS({targets:targets}));
}
