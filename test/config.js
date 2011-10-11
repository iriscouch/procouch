// Procouch invocation and config tests
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

var test = require('tap').test
  , config = require('../lib/config')
  , util = require('util'), I = util.inspect
  , request = require('request')
  ;

var LH = 'http://localhost:5984';
var DB = LH + '/procouch_test';

test('Couch is up', function(t) {
  request(LH+'/_session', function(er, resp, body) {
    t.notOk(er, 'Check session');
    t.equal(resp.statusCode, 200, 'Couch is up');
    t.ok(body, 'Session response body');

    var session = JSON.parse(body);
    var userCtx = session.userCtx;
    t.equal(userCtx.name, null, 'Couch admin party name')
    t.equal(userCtx.roles.length, 1, 'Couch admin party role length')
    t.equal(userCtx.roles[0], '_admin', 'Couch admin party roles')

    request({method:'DELETE', uri:DB}, function(er, resp, body) {
      t.notOk(er, 'Delete test DB request')
      t.ok(resp.statusCode == 200 || resp.statusCode == 404, 'Delete old test DB');

      request({method:'PUT', uri:DB}, function(er, resp, body) {
        t.notOk(er);
        t.equal(resp.statusCode, 201, 'Create test DB: ' + JSON.stringify(body));

        t.end();
      })
    })
  })
})

test('Invalid configs', function(t) {
  var bad_pairs = [ [''   , 'db'   ]
                  , ['/'  , '/db'  ]
                  , ['///', 'db'   ]
                  , ['/'  , 'db/'  ]
                  , [''   , 'db///']
                  ];

  t.plan(bad_pairs.length * 2);
  bad_pairs.forEach(function(pair, a) {
    var couch = 'http://localhost:5984' + pair[0];
    var db    = '/' + pair[1];
    var full  = couch + db;

    var cfg = { 'argv': [], 'num':a };
    cfg[couch] = {};
    cfg[couch][db] = {'log':'debug'};
    cfg[full] = {'log':'debug'};

    var mod = config.defaults(cfg);
    mod.start(function(er, resp) {
      t.ok(er, "Overlapping URLs return an error: " + JSON.stringify(pair));
      t.ok(er && er.message.match(/^Overlapping/),
           "Overlapping URLs return a useful error message: " + JSON.stringify(pair));
    })
  })
})

test('Command-line', function(t) {
  t.plan(11 + 4);

  function cfg(args, cb) {
    args = ['node', 'cli.js'].concat(args);
    var mod = config.defaults({'argv':args});
    mod.start(function(er, targets) {
      t.notOk(er, "Establishing targets should not throw")
      targets = targets.filter(function(T) { return T && /\/procouch_test$/.test(T.uri) })
      return cb(targets);
    })
  }

  cfg([], function(targets) {
    t.equal(targets.length, 0, 'No targets specified')
  })

  cfg(['http://localhost:5984/'], function(targets) {
    t.equal(targets.length, 1, 'Couch URLs work')
    t.type(targets[0], 'object', 'Targets returned are objects')
    t.equal(targets[0].uri, 'http://localhost:5984/procouch_test', 'Targets know their URI')
  })

  cfg(['http://localhost:5984/procouch_test'], function(targets) {
    t.equal(targets.length, 1, 'DB URLs work')
    t.type(targets[0], 'object', 'DB targets returned are objects')
    t.equal(targets[0].uri, 'http://localhost:5984/procouch_test', 'DB targets know their URI')
  })

  cfg(['http://localhost:5984', 'http://127.0.0.1:5984'], function(targets) {
    t.equal(targets.length, 2, 'Multiple command-line targets')
    t.type(targets[1], 'object', 'Targets returned are objects')

    function is_ok(uri) { return ( uri == 'http://localhost:5984/procouch_test'
                                 || uri == 'http://127.0.0.1:5984/procouch_test' ) }

    t.ok(is_ok(targets[0].uri), 'First target knows its URI')
    t.ok(is_ok(targets[1].uri), 'Second target knows its URI')
  })
})
