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
  //, log4js = require('log4js')
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

function build_targets(initial_config, callback) {
  initial_config = defaultable.merge(initial_config, DEFS);
  //console.error('build_targets: ' + lib.JS(initial_config));

  // Track the ultimate configs for each URL.
  // This is tricky. The priority list runs like this (1=lowest priority).
  // 1. Received config object
  // 2. Nested objects for a URL inside the config object
  // 3. Server-side configs from the URL's /_config/iris_couch/procouch
  // 4. Nested objects for db names inside the URL object
  var target_configs = {};
  function set_config(url, cfg, skip_check) {
    //console.error('config: ' + url);
    url = lib.normal(url);
    if(!skip_check && (url in target_configs))
      throw new Error('Overlapping configuration for URL: ' + url);
    target_configs[url] = cfg;
  }

  var base_config;
  try {
    lib.splice(initial_config, lib.is_url, function(top_config, sub_configs) {
      base_config = top_config;
      //console.error('base_config = ' + lib.JS(base_config));

      Object.keys(sub_configs).forEach(function(url) {
        lib.splice(sub_configs[url], /^\//, function(url_config, db_configs) {
          //url_config = defaultable.merge(url_config, base_config);
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
    targets = initial_config.urls || Object.keys(initial_config).filter(lib.is_url);
  targets = lib.nodupes(targets);

  //console.error('Learn configs: ' + lib.JS(targets));
  return async.map(targets, learn_config, function(er, targets) {
    if(er)
      return callback(er);
    targets = lib.flatten([targets]).filter(function(T) { return ! T.skip });
    return callback(null, targets);
  })

  function learn_config(target, cb) {
    lib.req_json({'uri':target}, function(er, resp, body) {
      if(er)
        return cb(er);

      if('db_name' in body)
        return cb(null, make_db_config(target));
      else if(body.couchdb == 'Welcome')
        return couch_configs(target);
      else
        return cb(new Error('Unknown target: ' + target));

      function make_db_config(url) {
        url = lib.normal(url);
        var cfg = target_configs[target] || {};

        var parent = cfg._parent;
        delete cfg._parent;
        if(parent)
          cfg = defaultable.merge(cfg, parent);
        cfg = defaultable.merge(cfg, base_config);

        cfg.uri = url;
        return cfg;
      }

      function couch_configs(couch_url) {
        // Target is a couch. Check for a config.
        couch_url = lib.normal(couch_url);
        var couch_config = target_configs[couch_url] || {};
        assert.equal(typeof couch_config._parent, 'undefined', 'Database config points to a couch: ' + couch_url);

        // Fetch the remote configuration and learn its DBs' configs.
        lib.req_json({'uri':couch_url + DEFS.config_path}, function(er, resp, server_config) {
          if(er)
            return cb(er);

          if(resp.statusCode == 404 || server_config.error == 'not_found')
            server_config = {};

          lib.splice(server_config, /^\//, function(remote_config, db_configs) {
            // Set the remote config with a lower priority than the local config.
            couch_config = defaultable.merge(couch_config, remote_config);

            var dbs = ('dbs' in couch_config) ? couch_config.dbs : base_config.dbs;
            if(Array.isArray(dbs))
              return to_db_targets(dbs);
            else if(dbs != 'all' && dbs !== undefined)
              return cb(new Error('Unknown .dbs value: ' + lib.JS(dbs)));
            else {
              //console.error('Fetching all DBs: ' + couch_url);
              lib.req_json({'uri':couch_url + '/_all_dbs'}, function(er, resp, body) {
                if(er)
                  return cb(er);
                dbs = body.filter(function(X) { return ! /^_/.test(X) });
                return to_db_targets(dbs);
              })
            }

            function to_db_targets(db_names) {
              var target_urls = [];
              try {
                db_names.forEach(function(db_name) {
                  var db_config = db_configs[db_name] || {};
                  db_config._parent = couch_config;

                  var url = couch_url + '/' + db_name;
                  set_config(url, db_config); // Check for config collisions.
                  target_urls.push(url);
                })
              } catch(er) {
                //console.error('to_db_targets error: ' + er);
                return cb(er);
              }

              return cb(null, target_urls.map(make_db_config));
            }
          }) // splice server_config
        }) // fetch server config
      } // couch_configs
    })
  }
}

}) // defaultable
