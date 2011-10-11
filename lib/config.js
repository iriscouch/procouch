// Procouch command-line and config file
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

var fs = require('fs')
  , lib = require('./index')
  , async = require('async')
  , assert = require('assert')
  , optimist = require('optimist')
  , defaultable = require('defaultable')
  ;

module.exports = defaultable(
{ 'argv'   : process.argv
, 'log'    : 'info'
, 'timeout': 15
, 'config' : null
, 'config_path': '/_config/iris_couch/procouch'
}, function(module, exports, DEFS) {

module.exports = { 'start': start
                 }

var ARGV = optimist(DEFS.argv)
                   .usage('Usage: $0 <target> [ <target2>, ... ]')
                   .default('log'    , DEFS.log)
                   .default('timeout', DEFS.timeout)
                   .default('config' , DEFS.config)
                   .boolean(['exit'])
                   //.boolean(['kill', 'force', 'reload'])
                   //.default('couch' , DEFAULT_COUCH)
                   //.default('db'    , DEFAULT_DB)
                   //.default('creds' , DEFAULT_CREDS)
                   .argv;


function start(callback) {
  assert.equal(typeof callback, 'function', 'Requried function callback');

  if(! ARGV.config)
    return build_targets({}, callback);

  fs.readFile(ARGV.config, 'utf8', function(er, data) {
    if(er) return callback(er);

    var config;
    var evaler = Function([], 'return JSON.parse(JSON.stringify( ' + data + ' ))');
    try        { config = evaler();
                 assert.equal(typeof config, 'object', 'Failure to evaluate config file: ' + ARGV.config) }
    catch (er) { return callback(er) }

    return build_targets(config, callback);
  })
}

function build_targets(config, callback) {
  config = defaultable.merge(config, DEFS);

  // Track the ultimate configs for each URL.
  // This is tricky. The priority list runs like this (1=lowest priority).
  // 1. Received config object
  // 2. Nested objects for a URL inside the config object
  // 3. Server-side configs from the URL's /_config/iris_couch/procouch
  // 4. Nested objects for db names inside the URL object
  var target_configs = {};
  function set_config(url, cfg) {
    url = lib.normal(url);
    if(url in target_configs)
      throw new Error('Overlapping configuration for URL: ' + url);
    target_configs[url] = cfg;
  }

  try {
    lib.splice(config, lib.is_url, function(base_config, sub_configs) {
      Object.keys(sub_configs).forEach(function(url) {
        lib.splice(sub_configs[url], /^\//, function(url_config, db_configs) {
          url_config = defaultable.merge(url_config, base_config);
          set_config(url, url_config);

          Object.keys(db_configs).forEach(function(db_name) {
            var db_config = db_configs[db_name];
            // Do not merge yet; just remember the parent config for later.
            db_config._parent = url_config;
            set_config(url+'/'+db_name, db_config);
          })
        })
      })
    })
  } catch (er) { return callback(er) }

  // Establish the targets to check.
  var targets = ARGV._.slice(2);
  if(targets.length == 0)
    targets = config.urls || Object.keys(config).filter(lib.is_url);
  targets = targets.map(lib.normal);

  return callback(null, targets);
}

}) // defaultable
