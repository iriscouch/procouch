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
  , log4js = require('log4js')
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


var TARGETS = null;

function get_target(url) {
  if(url != '_base')
    url = lib.normal(url);
  return TARGETS[url] || {}
}

function set_target(url, config, skip_check) {
  if(url != '_base')
    url = lib.normal(url);

  if(!skip_check && (url in TARGETS))
    throw new Error('Overlapping configuration for URL: ' + url);

  TARGETS[url] = config;
}

// Set up the initial, base configuration.
use_base_config(DEFS);

function use_base_config(config) {
  TARGETS = {};
  config = defaultable.merge(config, DEFS);

  //console.error('Using base config: ' + lib.JS(config));
  lib.splice(config, lib.is_url, function(top_config, sub_configs) {
    delete top_config.argv;
    set_target('_base', top_config);

    Object.keys(sub_configs).forEach(function(url) {
      lib.splice(sub_configs[url], /^\//, function(url_config, db_configs) {
        //url_config = defaultable.merge(url_config, base_config);
        set_target(url, url_config);

        Object.keys(db_configs).forEach(function(db_name) {
          var db_config = db_configs[db_name];
          // Do not merge yet; just remember the parent config for later.
          db_config._parent = url_config;
          set_target(url+'/'+db_name, db_config);
        })
      })
    })
  })
}


function start(callback) {
  assert.equal(typeof callback, 'function', 'Requried function callback');

  if(! ARGV.config)
    return do_config('{}');

  /* TODO
  else if(lib.is_url(ARGV.config))
    lib.request(ARGV.config, function(er, resp, body) {
      if(er)
        return callback(er);
      return do_config(body);
    })
  */

  else
    fs.readFile(ARGV.config, 'utf8', function(er, data) {
      if(er)
        return callback(er);
      return do_config(data);
    })

  function do_config(config_content) {
    var config;
    var evaler = Function([], 'return JSON.parse(JSON.stringify( ' + config_content + ' ))');
    try        { config = evaler();
                 assert.equal(typeof config, 'object', 'Failure to evaluate config file: ' + ARGV.config);
                 use_base_config(config) }
    catch (er) { return callback(er) }
    return build_targets(callback);
  }
}

function build_targets(callback) {
  var base_config = get_target('_base');
  //console.error('build_targets: ' + lib.JS(base_config));

  // This is tricky. The priority list runs like this (1=lowest priority).
  // 1. Base config
  // 2. Nested objects for a URL inside the config object
  // 3. Server-side configs from the URL's /_config/iris_couch/procouch
  // 4. Nested objects for db names inside the URL object

  // Establish the targets to check.
  var targets;
  targets = (ARGV._.length > 2) ? ARGV._.slice(2) : (base_config.urls || Object.keys(base_config).filter(lib.is_url));
  targets = lib.nodupes(targets.map(lib.normal));

  //console.error('Learn configs: ' + lib.JS(targets));
  return async.map(targets, learn_config, function(er, targets) {
    if(er)
      return callback(er);
    targets = lib.flatten([targets]).filter(function(T) { return ! T.skip });
    return callback(null, targets);
  })

  function learn_config(target_url, cb) {
    lib.req_json({'uri':target_url}, function(er, resp, body) {
      if(er)
        return cb(er);

      if('db_name' in body)
        return cb(null, make_db_config(target_url));
      else if(body.couchdb == 'Welcome')
        return couch_configs(target_url);
      else
        return cb(new Error('Unknown target: ' + target_url));

      function make_db_config(url) {
        url = lib.normal(url);
        var cfg = get_target(url);
        //var cfg = target_configs[target] || {};

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
        var couch_config = get_target(couch_url);
        assert.equal(typeof couch_config._parent, 'undefined', 'Database config points to a couch: ' + couch_url);

        //console.error('Fetching remote configuration: ' + couch_url);
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
              var url, db_config;
              for (var a = 0; a < db_names.length; a++) {
                url = couch_url + '/' + db_names[a];

                db_config = db_configs[ db_names[a] ] || {};
                db_config._parent = couch_config;

                try       { set_target(url, db_config) }
                catch(er) { return cb(er)              }
                target_urls.push(url);
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
